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
- The private key and DB should be encrypted at rest: DB → SQLCipher (ADR-0020), private key → OS keystore (B5, **not yet implemented**).
- **Residual (current state)**: the desktop GUI packaging (Tauri phase B) and the OS keystore are not yet complete; in browser demo/development mode, the identity is stored in localStorage (**not encrypted at rest**) — **only the official desktop build provides at-rest protection**.

### Forward secrecy / post-compromise security (across adversaries)
- **Static ECDH, no FS/PCS**: a single private key leak can decrypt **all past and future** offline messages. See the decision in **ADR-0028**: real-time traffic uses DTLS (which already provides PFS); FS/PCS for offline messages will be handled uniformly by MLS in the future.
  **This is currently the most significant known cryptographic limitation, and an audit should examine it first.**

## Known Limitations (for audit focus)

1. **No forward secrecy for offline messages** (ADR-0028) — highest priority.
2. **No key rotation/revocation**: the private key is the identity, so a leak means permanent impersonation risk (PRD §4).
3. **At-rest encryption only in the official desktop build**: Web/development mode localStorage is unencrypted; the OS keystore (B5) is not yet in place.
4. **Display names are not verified or propagated**: the npub is the sole authoritative identifier; names are purely local and can be duplicated (a Zooko trade-off).
5. **No public TURN (ADR-0243)**: regular users get STUN only. Two consequences — (a) a direct P2P connection reveals your IP to the contact; (b) **calls fail under symmetric NAT / strict firewalls** (live media can only go P2P or TURN, with no text-relay fallback; **files fall back to the relay, and text/nudge already ride the relay — unaffected**). Enterprises/self-hosters can configure `turnServers`+`forceTurn` (ADR-0048). **Explicitly documented, not a silent failure**; a public TURN is a cost decision (Cloudflare TURN is a candidate). When used, TURN sees both peers' IPs and call timing/volume (not content, which stays E2E encrypted) — one more metadata-visible party, avoidable by self-hosting.
6. **Group member list consistency** relies on in-band control messages and multi-device convergence; **authorization has been hardened** (post-review, as supplemented in ADR-0027): joining a group requires you to be on the list and the creator not to be blocked, `admin` is forced to be a verified sender, adding/removing is restricted to admins, and sending requires membership. A malicious admin still has member-level control within their own group (by design); a stranger can start a group that includes you (the same as the "stranger DM" model) but cannot pollute your contacts or impersonate an admin. Calls also honor the block list.
7. **Timing metadata**: online/activity times are observable to the relay (jitter has been added, traffic padding has not).
8. **Replay/clock**: ephemeral events use a `created_at` window + event-id deduplication to prevent replay (PRD §9); cross-device ordering does not trust `created_at` alone.
9. **Dependency trust**: third-party libraries such as `nostr-tools`, `@noble/*`, `qrcode-generator`, `rusqlite`, and `tokio-tungstenite`; supply-chain risk is mitigated by pinning versions in the lockfile.

## Suggested Third-Party Audit Scope

- The cryptographic paths in `packages/core`: Gift Wrap wrapping/unwrapping, NIP-44 usage, signature verification, group fan-out, one-time key generation, and nonce uniqueness.
- Key lifecycle: generation, storage (SQLCipher/OS keystore), and the impact of missing backups.
- Abuse protection: PoW, rate/size limits, NIP-42 AUTH (relay, at deployment).
- The implementation correctness of each item in the "Known Limitations" above, and whether any can be bypassed.
