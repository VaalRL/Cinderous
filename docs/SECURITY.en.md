> 🌐 **繁體中文** · [繁體中文版本](./SECURITY.md)

# Security Policy & Self-Assessment

> This document is the internal security self-assessment and vulnerability disclosure policy for **Phase F4**, laying the groundwork for a future third-party audit.
> The authoritative threat model is defined in `PRD.md §6`; the encryption design is in `PRD.md §7` and `ARCHITECTURE.md §5`;
> the rationale for each decision is in `docs/adr/`.

## ⚠️ Audit Status

**The end-to-end encryption and key handling in this project have not yet undergone an independent third-party audit.** Do not rely on this software in high-risk, life-safety-critical situations. Security researchers are welcome to review it (AGPL-3.0, source publicly available).

## Reporting Vulnerabilities

- Please do **not** disclose security vulnerabilities by opening a public issue.
- Please report privately through GitHub **Security Advisories**, or contact the maintainers through a private channel.
- Please include: the scope of impact, reproduction steps, the affected version/commit, and (if you have one) a suggested direction for a fix.
- We will do our best to acknowledge and fix the issue within a reasonable time, and to coordinate disclosure after a fix is available.

## Cryptographic Primitives Inventory (SSOT: `packages/core`)

| Aspect | Choice | Notes |
| --- | --- | --- |
| Identity/signatures | secp256k1 + BIP-340 Schnorr (`@noble/curves`) | NIP-01; ADR-0004 |
| Content encryption | NIP-44 v2 (versioned AEAD, via `nostr-tools`) | Replaces the insecure NIP-04; ADR-0007 |
| Metadata hiding | NIP-17 + NIP-59 Gift Wrap (kind 14→13→1059) | Against a relay that only inspects events: hides the **sender** (one-time key); recipient pubkey is plaintext for routing. ⚠️ Against a relay that correlates "connection identity ↔ traffic," both the sender (publish connection = real npub) and the contact set (presence subscription) are attributable (ADR-0237); ADR-0002 |
| Real-time channel | WebRTC DTLS (P2P, with forward secrecy) | File/voice/call media does not pass through the relay |
| At-rest storage | SQLCipher (`sqlcipher` feature) | Native desktop DB encryption; ADR-0020 |
| Randomness | `@noble/hashes` `randomBytes` / WebCrypto | groupId, one-time keys, nonce |

## Threat Model Inventory (mapped to PRD §6: adversary → implemented mitigation → residual risk)

### Relay operators / subpoena-able hosting providers
- **Content**: always NIP-44 ciphertext; the relay only sees ciphertext. ✅
- **Social graph (message layer)**: direct messages, reactions, retractions, ephemeral messages, and **groups** all go through NIP-59 Gift Wrap (the outer author is a one-time key), so **a relay that only inspects events** cannot reconstruct "who **messages** whom." ✅ (Groups are also pairwise fan-out; see ADR-0027)
- **🔴 Residual — connection attribution defeats event-layer sender hiding (ADR-0237)**: NIP-42 AUTH (anti-scraping) binds every connection to your real npub, and publishing rides the same authed connection — a relay that correlates "authed identity ↔ published events" (zero cost; it already holds `authState`) sees "real-A's connection published a Gift Wrap addressed to #p" = the **send edge**, even though the outer author is a one-time key. So event-layer sender hiding holds only against a relay that does not correlate connections. Mitigation: self-hosting (the adversary is yourself); a full fix needs transport anonymity — see ADR-0237.
- **🔴 Residual — presence subscriptions leak your contact set**: to receive contacts' online status, the client AUTHs under its real identity and subscribes to `{kinds:[20000], authors:[contact list]}` — this REQ **hands your contact set straight to your home relay**. The message-layer graph is hidden by Gift Wrap; the presence layer is not. Mitigations: P2P presence offload (ADR-0088e) and self-hosting (the leak is to your own node); a full fix requires wrapping presence too (publishes × contacts, hitting free-tier capacity) and is deferred — see PRD §6 and `docs/relay-metadata-observability.md` M7.
- **Residual — timing/size**: online **timing** (heartbeats) and event **size/time** are observable. Mitigations: heartbeats are only broadcast to mutually consented contacts, with added **jitter** (ADR-0006 F5), and music is folded into the heartbeat to reduce events; traffic padding is not implemented.

### Passive network eavesdroppers
- Connection times and traffic sizes are observable (the same timing residual as above). TLS/WSS is handled by the deployment layer (the relay is on Cloudflare).

### Malicious contacts (already friends)
- **De-anonymization**: a direct WebRTC connection reveals your IP to the peer. Mitigation: a TURN server can be injected (`rtcConfig`) to mask it; direct connections are disabled by default for untrusted contacts (product layer). **Residual**: no mandatory TURN by default.
- **Harassment/spam**: adding a friend requires mutual consent, and there is a block list (their Gift Wrap is no longer decrypted locally). ADR-0014.
- **Screenshots/reposts**: explicitly out of scope (retraction/ephemeral messages are soft, not enforced).

### Device thieves
- The private key and DB are encrypted at rest: DB → SQLCipher (ADR-0020), private key → **OS keystore (B5, implemented, ADR-0053)** — the desktop build holds the nsec via `keyring` (Windows Credential Manager / macOS Keychain / Linux Secret Service); any legacy plaintext nsec left in localStorage is **migrated into the keystore and wiped** on startup (`key_set`/`key_get`/`key_delete`).
- **The device key** (the basis for ADR-0322 revocation — a separate key from the identity private key) goes into the OS keystore on desktop as well (ADR-0323, 2026-08-04; legacy plaintext copies are migrated in and wiped on startup). The Android native shell uses `AndroidKeyStore` (a non-exportable AES-256-GCM key wraps it; only ciphertext lands in SharedPreferences) — ⚠ **only TEE/StrongBox-backed keys count as hardware protection; on models with a software-only Keystore it counts merely as "encrypted"**, and the settings page distinguishes the two. The browser (including the mobile web preview) wraps it with a **non-extractable WebCrypto key held in IndexedDB** — 🔴 **that stops a script trying to steal the key, but not a full copy of the browser profile** (the wrapping key is held by the browser, with no user secret involved), so "remove device" may still be ineffective against someone holding the whole profile. The settings page states which tier this machine is actually on (ADR-0297 §6 red line).
- 🔴 **Residual — the Android APK is debug-signed and debuggable (ADR-0335)**: the shipped APK is
  signed with Android's default debug certificate and carries `android:debuggable="true"`.
  ⇒ **Anyone who can attach adb can hook into the app's process and read its memory**, which during
  a session necessarily holds the nsec (the storage DEK is derived from it) and the forward-secrecy
  EK private keys. **Do not use it for conversations you actually care about on a rooted device, or
  one with USB debugging left on.** Fix = a release keystore + `assembleRelease` (see `OPERATOR-TODO`).
  ⚠ This has been true since the first Android release; it is not a new regression, merely one that
  had never been written down.
- **Residual (current state)**: in the official desktop build, at-rest = private key (OS keystore) + DB (SQLCipher). In browser demo/development mode, app data is encrypted at rest with an nsec-derived DEK (ADR-0112); the nsec itself is either **wrapped with a user password** on disk (passlock) or **not persisted** (when no password is set). The **desktop build is not yet code-signed** (SmartScreen warning) — a distribution-side residual, not an at-rest gap.

### Forward secrecy / post-compromise security (across adversaries)
**Status changed as of 2026-08-01** — this section previously read "Static ECDH, no FS/PCS", which is no longer complete:

- **The default path is still static ECDH with no FS/PCS**: a single private key leak can decrypt **all past and future** offline messages. Nothing changes for users who have not enabled forward secrecy (i.e. the default).
- **But forward secrecy is implemented and exposed as an experimental option** (design in ADR-0238, user-facing in ADR-0245, experimental rollout in **ADR-0306**): a rotating encryption subkey (EK); senders retarget the Gift Wrap to the recipient's current EK, and the recipient deletes the old EK private key after a 7-day grace period, so previously recorded ciphertext stays unreadable even if the nsec is stolen later.
  - **Off by default**, with a persistent "not yet externally audited" disclosure in settings and a confirmation on enable.
  - **Must not be claimed in parity form** (ADR-0306 D2.2): not in the feature list, comparison table, or marketing copy.
  - **Granularity is per manual rotation, not per message**; a per-message ratchet is deferred (ADR-0236 / **ADR-0303**).
- **PCS (post-compromise security) is still absent**: EK rotation does not provide automatic recovery from a compromise.
- ⇒ **The audit priority is unchanged but the target has moved**: not "is there FS" but **"is this 420-line FS implementation correct"** — see the recommended audit scope below.

⚠ **This section previously cited ADR-0028 ("keep static ECDH, leave FS to MLS") as its sole basis. That is outdated.** ADR-0236 (revised 2026-07-23) replaced it with "near-term path = rotating encryption subkey", which ADR-0245 / 0306 then implemented and shipped.
  **This is currently the most significant known cryptographic limitation, and an audit should examine it first.**

## Known Limitations (for audit focus)

1. ~~**No forward secrecy for offline messages** (ADR-0028) — highest priority.~~
   🔵 **Revised 2026-08-01**: **forward secrecy is implemented, off by default, and exposed as an experimental option** (ADR-0245 / 0306). Still highest priority, but **the question moved from "is it there" to "is it correct"**:
   - **Not audited by any external party** — this is exactly why this document exists, and the part that most needs review.
   - **PCS is still absent**: EK rotation gives no automatic recovery from compromise.
   - **Granularity is per manual rotation**, not per message; strength depends on how often the user rotates.
   - **The first message's FS is bounded by the signed-prekey rotation cadence**, not absolute (ADR-0303 §5.2, verified against the X3DH specification).
   - **Groups**: coverage depends on whether the sender knows each member's EK. Since ADR-0326 a group message carries the sender's current EK in the **seal layer** (encrypted inside the wrap, invisible to the relay), so one message from a member is enough. ⚠ **Members who never post still get no forward secrecy**, and anyone's **first** message never does.
   - **Multi-device**: EK private keys sync between the user's own devices via the encrypted cloud snapshot and device pairing; the **written-down rescue code deliberately excludes EKs** (ADR-0245 §2) ⇒ signing in on a brand-new device with the rescue code leaves **the entire EK-encrypted portion of the relay window unreadable** (a known and deliberate trade-off).
2. **No rotation/revocation of the *identity* key**: the private key is the identity, so a leak means permanent impersonation risk (PRD §4).
   🔵 **Added 2026-08-05**: **device revocation is implemented** (ADR-0322/0323) — a removed device cannot obtain subsequently rotated encryption subkeys. ⚠ **Do not conflate the two**:
   - What it buys: **lost/stolen device, an old phone that was never wiped, a work laptop after leaving** — cases where someone holds *a device*, not the nsec.
   - What it does **not** buy: a remedy for a full nsec leak. The nsec remains the signing root of the device directory, so this yields **detection** (two differing directories at the same version is evidence) rather than prevention; the real answer is still identity rotation (ADR-0052).
   - Its effectiveness is bounded by the **device-key protection tier** (ADR-0323): the browser only reaches `encrypted`, so someone copying the whole profile may still bypass it. The settings page states which tier the machine is actually on.
3. **At-rest encryption (in place)**: official desktop build = private key via OS keystore (B5, ADR-0053, implemented) + DB via SQLCipher; Web/development mode = app data encrypted with an nsec-derived DEK (ADR-0112), nsec password-wrapped (passlock) or not persisted. Residual = the desktop build is not yet code-signed (distribution-side, not at-rest).
4. **Display names are not verified or propagated**: the npub is the sole authoritative identifier; names are purely local and can be duplicated (a Zooko trade-off).
5. **No public TURN (ADR-0243)**: regular users get STUN only. Two consequences — (a) a direct P2P connection reveals your IP to the contact; (b) **calls fail under symmetric NAT / strict firewalls** (live media can only go P2P or TURN, with no text-relay fallback; **files fall back to the relay, and text/nudge already ride the relay — unaffected**). Enterprises/self-hosters can configure `turnServers`+`forceTurn` (ADR-0048). **Explicitly documented, not a silent failure**; a public TURN is a cost decision (Cloudflare TURN is a candidate). When used, TURN sees both peers' IPs and call timing/volume (not content, which stays E2E encrypted) — one more metadata-visible party, avoidable by self-hosting.
6. **Group member list consistency** relies on in-band control messages and multi-device convergence; **authorization has been hardened** (post-review, as supplemented in ADR-0027): joining a group requires you to be on the list and the creator not to be blocked, `admin` is forced to be a verified sender, adding/removing is restricted to admins, and sending requires membership. A malicious admin still has member-level control within their own group (by design); a stranger can start a group that includes you (the same as the "stranger DM" model) but cannot pollute your contacts or impersonate an admin. Calls also honor the block list.
7. **Timing metadata**: online/activity times are observable to the relay (jitter has been added, traffic padding has not).
8. **Replay/clock**: ephemeral events use a `created_at` window + event-id deduplication to prevent replay (PRD §9); cross-device ordering does not trust `created_at` alone.
9. **Dependency trust**: third-party libraries such as `nostr-tools`, `@noble/*`, `qrcode-generator`, `rusqlite`, and `tokio-tungstenite`; supply-chain risk is mitigated by pinning versions in the lockfile.

## Inherent Limitations of the Implementation Language (TypeScript; ADR-0307)

The cryptographic implementation stays as **a single TypeScript codebase** (no Rust/WASM, no per-platform rewrites; decision and rationale in **ADR-0307**). That decision carries two costs that are **real and do not go away**, and auditors should factor them in:

- **Constant-time execution cannot be guaranteed.** JS engines make no constant-time guarantees. The primitives themselves are delegated to the already-audited `@noble` (whose implementations target constant time), ~~but whether our own layer (the 420 lines of composition) branches on secret values in hot paths has not been verified~~ → **✅ verified line by line (2026-08-03, ADR-0307 §5)**: `nip44.ts`, `giftwrap.ts`, `keys.ts` and the rest of `subkey.ts` are **clean** (every branch is on plaintext tags, timestamps, or public strings); **one finding** — `openWrapWithEks` tries `[current EK, …grace-period EKs, IK]` in order, so **the iteration count depends on which key succeeds** ⇒ it leaks **the peer's FS state** (not key material). ⚠ Amplification path: **read receipts** (one extra decryption round → receipt sent slightly later → the delta is observable over the network). **Low severity but real**, and **not attributable to the language** (the same try-next-key loop in Rust would behave identically — it is an algorithmic structure). ⚠ **Still unverified**: whether `@scure/base`'s bech32 is constant time (`nsecEncode` / `nsecDecode` pass the private key through it; not on the message hot path, but still private-key handling).
- **Reliable memory zeroization is not achievable.** JS cannot guarantee erasure; secrets may linger in memory after GC.
  ⚠ **Switching to WASM would not fix this**: keys are read from JS-side storage (`at-rest.ts`'s DEK and `passlock-web.ts` are both in TS) ⇒ the key has already been in JS memory, so moving only the ratchet into WASM cannot erase those copies (ADR-0307 §3-b).
  **The right fix is ADR-0297's L2 device-bound keys** (TPM / Secure Enclave / StrongBox, where the key never leaves the chip), and **we are currently at L0/L1** — see the tiering and per-platform status in ADR-0297 §2.

⇒ A precedent for selective native offload already exists: `apps/desktop/src-tauri/src/passlock.rs` moves the **Argon2id KDF** to the native layer, with a comment stating the reason as "avoiding JS-side timing/memory weaknesses"; browsers and mobile use the JS implementation in `packages/core/src/passlock-web.ts`. **That asymmetry is deliberate and accepted**, and any future primitive that is similarly unsuited to JS should be handled the same way.

## Suggested Third-Party Audit Scope

> 🔵 **Primary target (added 2026-08-01): the 420 lines of forward secrecy.**
> The scope has been measured (ADR-0302 §6.2): `nip44.ts` 28 + `giftwrap.ts` 221 + `subkey.ts` 119 + `keys.ts` 52.
> **We do not implement a single cryptographic primitive ourselves** (ADR-0004 / 0007; `nip44.ts` is a 28-line
> thin wrapper delegating to the already-audited `nostr-tools/nip44` / `@noble`) ⇒ **the target is the binding
> and state machine around already-audited primitives, not the primitives themselves** — this is a
> **protocol/composition review, not a primitive review**. Five things to look at:
>
> 1. **NIP-44 binding**: conversation-key derivation and use; whether the same key is ever misused.
> 2. **Gift Wrap three-layer sealing**: field leakage across rumor/seal/wrap; whether outer tags leak inner data.
> 3. **EK rotation state machine**: grace window and deletion discipline, downgrade detection, TOFU pinning,
>    `readEkAnnounce` rejection conditions, and the four-state capability parse
>    (`fs` / `retired` / `unknown` / `absent`, ADR-0306 D3.3c).
> 4. **Randomness sources**: one-time key and nonce generation.
> 5. **Multi-device EK sync**: both paths — cloud-snapshot merge and device pairing (see the exit table in ADR-0245 §2).
>
> ⚠ Honest note: line count ≠ price. A 420-line protocol review can still cost more than a routine
> review of several thousand lines.

- The cryptographic paths in `packages/core`: Gift Wrap wrapping/unwrapping, NIP-44 usage, signature verification, group fan-out, one-time key generation, and nonce uniqueness.
- Key lifecycle: generation, storage (SQLCipher/OS keystore), and the impact of missing backups.
- Abuse protection: PoW, rate/size limits, NIP-42 AUTH (relay, at deployment).
- The implementation correctness of each item in the "Known Limitations" above, and whether any can be bypassed.
