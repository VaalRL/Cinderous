> 🌐 **繁體中文** · [繁體中文版本](./MAINTAINER-ACTIVATION.md)

# Activating the Maintainer Role (Lighting Up the Signed Relay Pool)

> This is an **operations manual**: it turns on the currently **implemented but dormant** "maintainer signed relay list" mechanism (ADR-0039 / 0092),
> so that third-party self-hosted nodes can be automatically admitted into the official slot-selection pool. Dormant state today: `MAINTAINER_PUBKEY` is empty,
> `relay/bootstrap/relays.json` is empty, and the GitHub secret `MAINTAINER_NSEC` is unset.

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

## ② Set the nsec as a GitHub Actions secret

GitHub → repo → **Settings → Secrets and variables → Actions → New repository secret**
- Name: `MAINTAINER_NSEC`
- Value: the contents of the `maintainer.nsec` file (`nsec1…`)

`.github/workflows/relay-health.yml` already reads `secrets.MAINTAINER_NSEC`; when it is unset, it only updates the plaintext list and does not sign
(`relay/bootstrap/health-check.ts`). Once set, **back up that file offline and delete it from your machine**.

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

Then the hourly `relay-health.yml`: probe → `evaluateAdmission` sets `accepting`/`weight` → if an nsec is present, it signs and
**publishes in-band** (`publishEvent`) to healthy relays, which clients learn as soon as they connect.

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

- Actions → "Relay Health Check" → **Run workflow** (or wait for the top-of-hour cron).
- The log should show: `✅ <url>`, `signed relay list event (kind 10037)`, `📡 published to <url>`.
- The bot will commit the updated `relays.json` (with `accepting`/`weight`) and `health-history.json`.
- Use a **rebuilt** client to confirm that automatic slot selection at login is pre-filled from the signed relay list.

---

## The maintainer's day-to-day afterwards

- **Humans manage joins/retirements**: add a URL to `relays.json` (the machine probes and grades it automatically); to retire, set the entry's `status`
  to `draining` → `retired`, and existing users migrate away automatically.
- **The machine manages quality**: uptime/consistency update hourly (`health-history.json` rolling window ≈30 days).
- **Third-party applications** (see `docs/NODE-SUBMISSION.md`) = submit a URL via issue/PR; once you add the URL to `relays.json` it enters the probe pipeline.

## Key rotation

Changing `MAINTAINER_PUBKEY` requires **rebuilding all clients** (compile-time constant), and keeping the old and new lists coexisting during the transition. Plan the process in advance to
avoid turning clients into islands during an emergency rotation.

## References

- ADR-0039 (hybrid bootstrap routing / signed list trust root), ADR-0092 (node submission and graded admission), ADR-0069 (automatic slot selection I4)
- Code: `relay/bootstrap/{genkey,health-check,conformance}.ts`, `packages/core/src/bootstrap.ts`
  (`signRelayList`/`verifyRelayList`/`evaluateAdmission`), `packages/engine/src/bootstrap-config.ts`
- Pipeline: `.github/workflows/relay-health.yml`
