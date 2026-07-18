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
| Metadata hiding | NIP-17 + NIP-59 Gift Wrap (kind 14→13→1059) | Hides sender/recipient and the social graph; ADR-0002 |
| Real-time channel | WebRTC DTLS (P2P, with forward secrecy) | File/voice/call media does not pass through the relay |
| At-rest storage | SQLCipher (`sqlcipher` feature) | Native desktop DB encryption; ADR-0020 |
| Randomness | `@noble/hashes` `randomBytes` / WebCrypto | groupId, one-time keys, nonce |

## Threat Model Inventory (mapped to PRD §6: adversary → implemented mitigation → residual risk)

### Relay operators / subpoena-able hosting providers
- **Content**: always NIP-44 ciphertext; the relay only sees ciphertext. ✅
- **Social graph**: direct messages, reactions, retractions, ephemeral messages, and **groups** all go through NIP-59 Gift Wrap (the outer author is a one-time key, and `#p` points to the recipient's ephemeral key), so the relay cannot reconstruct "who talks to whom." ✅ (Groups are also pairwise fan-out; see ADR-0027)
- **Residual**: online **timing** (heartbeats) and event **size/time** are observable. Mitigations: heartbeats are only broadcast to mutually consented contacts, with added **jitter** (ADR-0006 F5), and music is folded into the heartbeat to reduce events; traffic padding is not implemented.

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
5. **No mandatory TURN**: by default, P2P may reveal your IP to a contact.
6. **Group member list consistency** relies on in-band control messages and multi-device convergence; **authorization has been hardened** (post-review, as supplemented in ADR-0027): joining a group requires you to be on the list and the creator not to be blocked, `admin` is forced to be a verified sender, adding/removing is restricted to admins, and sending requires membership. A malicious admin still has member-level control within their own group (by design); a stranger can start a group that includes you (the same as the "stranger DM" model) but cannot pollute your contacts or impersonate an admin. Calls also honor the block list.
7. **Timing metadata**: online/activity times are observable to the relay (jitter has been added, traffic padding has not).
8. **Replay/clock**: ephemeral events use a `created_at` window + event-id deduplication to prevent replay (PRD §9); cross-device ordering does not trust `created_at` alone.
9. **Dependency trust**: third-party libraries such as `nostr-tools`, `@noble/*`, `qrcode-generator`, `rusqlite`, and `tokio-tungstenite`; supply-chain risk is mitigated by pinning versions in the lockfile.

## Suggested Third-Party Audit Scope

- The cryptographic paths in `packages/core`: Gift Wrap wrapping/unwrapping, NIP-44 usage, signature verification, group fan-out, one-time key generation, and nonce uniqueness.
- Key lifecycle: generation, storage (SQLCipher/OS keystore), and the impact of missing backups.
- Abuse protection: PoW, rate/size limits, NIP-42 AUTH (relay, at deployment).
- The implementation correctness of each item in the "Known Limitations" above, and whether any can be bypassed.
