> 🌐 **繁體中文** · [繁體中文版本](./MAINTAINER-ACTIVATION.md)

# Activating the Maintainer Role (Lighting Up the Signed Relay Pool)

> This is an **operations manual** for running the "maintainer signed relay list" mechanism
> (ADR-0039 / 0092), which lets third-party self-hosted nodes be admitted into the official
> slot-selection pool.
>
> **Current state (2026-09-18)**: `MAINTAINER_PUBKEY` has been set since 2026-07-18,
> `relays.json` holds two anchors, and the mechanism is live. Steps (1) and (3) below are for
> **first-time setup only**; for day-to-day work go straight to the offline signing section
> and "Day-to-day maintainer work".

## ⚠️ Read first: this key is the "trust root"

`MAINTAINER_NSEC` is the trust root of the entire fault-tolerance topology — **whoever holds it can sign a relay list that "clients will adopt automatically"**.
A leak means an attacker can sign a malicious list → clients connect to the attacker's relay (metadata harvesting / eclipse). Treat it like a **root CA key**:

- **Dedicated**: never share it with any personal identity or messaging key.
- **Generate offline, back up offline**: the only online copy is the GitHub Actions secret.
- **Never** commit it, never paste it into chat/screenshots, never print it to logs.

The system's privacy is **structural** (E2E Gift Wrap + TTL + P2P + multi-relay, which already assumes relays are adversaries),
so admission review only verifies **behavior** (stability, correct forwarding, accountability), not "whether it can be trusted".

---

## ① Generate the maintainer key (local, output never goes into chat)

```bash
pnpm --filter @cinderous/relay genkey:maintainer
```

Behavior (`relay/bootstrap/genkey.ts`):
- **Public key hex** → printed to the terminal (public, filled into code in the next step).
- **Private key nsec** → **written only to the local file** `./maintainer.nsec` (`chmod 600`, already gitignored), **never printed to stdout**.

Options: `MAINTAINER_NSEC_OUT=/path` to customize the output path; `MAINTAINER_NSEC_FORCE=1` to overwrite an existing file.

> You may also generate it with any standard Nostr key tool you trust (ideally offline). Two representations are needed:
> `MAINTAINER_PUBKEY` = 32-byte x-only public key **hex (64 characters)**; `MAINTAINER_NSEC` = **`nsec1…`**.

## ② Offline signing (ADR-0239)

🔴 **Never set `MAINTAINER_NSEC` as a GitHub Actions secret.** This document used to say you
should; that is exactly the anti-pattern ADR-0239 removed. Any poisoned transitive dependency
in CI could read the trust root of the entire failover topology. `relay-health.yml` no longer
holds or injects that secret (see line 23 of that file).

The key stays on your machine. CI only probes and updates the plaintext list; **you sign and
publish locally**:

```bash
# 1. Fetch the runtime probe history (CI keeps it on the relay-health-state branch, not main)
git fetch origin relay-health-state
git show FETCH_HEAD:health-history.json > relay/bootstrap/health-history.json

# 2. Sign the already-committed plaintext list offline and publish it in-band
MAINTAINER_NSEC="$(cat /path/to/maintainer.nsec)" \
  pnpm --filter @cinderous/relay bootstrap:sign
```

`--sign-only` does not re-probe. It signs whatever `relays.json` currently holds into a
kind 10037 event and pushes it to healthy relays, where clients pick it up on connect.
Without `MAINTAINER_NSEC` it fails loudly rather than skipping silently.

**When to run it**: after `relays.json` changes (a node admitted, retired, or reweighted).
CI changes the plaintext list but **will not sign for you**, so skipping this step means
clients never see the new list.

## ③ Fill the public key into the code (= light up the trust root)

`packages/engine/src/bootstrap-config.ts`:

```ts
export const MAINTAINER_PUBKEY = "<your 64-character hex public key>";
```

Both desktop (`apps/desktop/src/App.tsx`) and mobile (`apps/mobile/src/backend.ts`) will pass
`maintainerPubkey` to the backend **when it is non-empty**; only then does the backend subscribe to `kind 10037` (`RELAY_LIST_KIND`) and adopt lists verified with `verifyRelayList`.

> This step touches the trust root, so it **requires an accompanying ADR** (recording the maintainer public key selection and its consequences).

## ④ Admit the first candidate relay

The candidate source is `relay/bootstrap/relays.json` itself (`listEntries` reads it and probes each one). Add your production node to it:

```json
{
  "relays": ["wss://relay.your-domain"],
  "entries": [{ "url": "wss://relay.your-domain" }],
  "updatedAt": 0
}
```

Then `relay-health.yml` every 6 hours (cron `17 */6 * * *`): probe → `evaluateAdmission` sets
`accepting`/`weight` → commits `relays.json` to main when it changed.

⚠ **CI stops there — it neither signs nor publishes** (ADR-0239). To get the new list to
clients, run the offline signing above yourself.

- If your relay has `requireAuth:true`, the probe will **generate an ephemeral key on the spot** to perform NIP-42 AUTH (`conformance.ts` already handles this).
- ADR-0039 recommends eventually assembling **≥2 anchors** on different domains/platforms to cover single-point risk.

Graded admission (ADR-0092):

| Status | Condition | Effect |
| --- | --- | --- |
| Not listed | liveness failed | — |
| Trial (`accepting:false`) | consistency not passed or uptime insufficient (<12 probes) | added to the list for resilience/manual use, not auto-assigned new accounts |
| Admitted (`weight:1`) | consistency passed + uptime≥95% | auto-assigned (low weight) |
| Admitted (`weight:2`) | consistency passed + uptime≥99% | auto-assigned (higher weight) |

## ⑤ Rebuild and redeploy the clients

`MAINTAINER_PUBKEY` is a **compile-time constant**, so already-shipped older apps will not pick it up automatically — they must be rebuilt:

- Desktop: `pnpm --filter @cinderous/desktop tauri build` → re-publish to Releases
- Official web app: push to trigger a GitHub Pages rebuild (automatic)
- Mobile / CLI: rebuild each separately

## ⑥ Verify it is live

- Actions → "Relay Health Check" → **Run workflow** (or wait for the cron — :17 every 6 hours, ADR-0350).
- The CI log should show `✅ <url>` and
  `未提供 MAINTAINER_NSEC：僅更新明文清單` — **that line is normal**, not a failure.
- `signed relay list event (kind 10037)` and `📡 published to <url>` appear only when **you**
  run the offline signing locally.
- The bot commits to main only when `relays.json` actually changes; `health-history.json`
  (the rolling uptime counters) is runtime state, kept on the `relay-health-state` branch
  and **never on main** (ADR-0350).
- Use a **rebuilt** client to confirm that automatic slot selection at login is pre-filled from the signed relay list.

---

## The maintainer's day-to-day afterwards

- **Humans manage joins/retirements**: add a URL to `relays.json` (the machine probes and grades it automatically); to retire, set the entry's `status`
  to `draining` → `retired`, and existing users migrate away automatically.
- **The machine manages quality**: uptime/consistency update every 6 hours (30-day rolling
  window = 4 probes/day × 30, derived from `PROBES_PER_DAY` in `relay/bootstrap/uptime.ts`).
  ⚠ To run a full probe locally you must fetch the state first, or it fails outright (that is
  deliberate — an empty history downgrades admitted relays to probation, and with the key
  present it would sign and publish that):
  ```
  git fetch origin relay-health-state
  git show FETCH_HEAD:health-history.json > relay/bootstrap/health-history.json
  ```
- **Third-party applications** (see `docs/NODE-SUBMISSION.md`) = submit a URL via issue/PR; once you add the URL to `relays.json` it enters the probe pipeline.

## Key rotation

### 🔴 The current key is due for rotation (ADR-0239 follow-up 2)

`MAINTAINER_NSEC` was a GitHub Actions secret from **2026-07-03 until 2026-07-23**, and the
public key currently pinned in clients, `6efd2603…`, was committed on **2026-07-18** — inside
that window.

ADR-0239 states that a key which entered CI in any form must be **treated as exposed and
rotated once**. For those twenty days, any poisoned transitive dependency could have read it,
and it is the **only** trust anchor pinned in every client: holding it means signing a relay
list that clients adopt automatically (eclipse / metadata harvesting). There is no evidence it
was taken, but absence of evidence is not evidence of absence.

### Rotation procedure

`MAINTAINER_PUBKEY` is a **compile-time constant**, so already-shipped clients will not pick up
a new one. Order matters:

1. **Generate the new key** locally and offline:
   `pnpm --filter @cinderous/relay genkey:maintainer`
   (the nsec is written to a file, never printed; keep the old key for now).
2. **Commit the new public key** to `packages/engine/src/bootstrap-config.ts`, with an ADR
   recording the rotation and why.
3. **Rebuild and ship every client** (desktop, web, mobile, CLI). Until then, older clients
   only trust the old key.
4. **Wait for the new build to spread** before retiring the old key. During that period
   **sign the same list with both keys** — old clients can only verify the old signature, and
   retiring it early turns them into islands that receive no list updates at all, including
   "this relay has retired".
5. Once the old key has no remaining use, destroy every copy of it.

⚠ Step 4 is not automated. While both keys are live, every `relays.json` change needs the
offline signing run once per key.

## References

- ADR-0039 (hybrid bootstrap routing / signed list trust root), ADR-0092 (node submission and graded admission), ADR-0069 (automatic slot selection I4)
- Code: `relay/bootstrap/{genkey,health-check,conformance}.ts`, `packages/core/src/bootstrap.ts`
  (`signRelayList`/`verifyRelayList`/`evaluateAdmission`), `packages/engine/src/bootstrap-config.ts`
- Pipeline: `.github/workflows/relay-health.yml`
