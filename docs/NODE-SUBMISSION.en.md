> 🌐 **繁體中文** · [繁體中文版本](./NODE-SUBMISSION.md)

# Submit Your Node to the Official Network (ADR-0092)

Anyone can **self-host and use** a Cinderous node (see the self-host docs, ADR-0075). This document describes the **application process** for getting into the **official automatic seat-assignment pool** (i.e., the maintainer's signed relay list, ADR-0039)—it is **pull-based, verifiable, and has no gatekeeping backend**.

> To be clear up front: staying out of the pool does **not** make your node unusable—people who enter the URL manually, or contacts who set it as their home (learned automatically via a relay hint), can still use it. Joining the pool only makes it possible for **new users who don't know you** to be automatically assigned to your node.

## Application = Self-Declaration (what you do)

1. **Run your node reliably** for a while (a few weeks recommended), with a dedicated domain and valid TLS.
2. **Expose a self-declaration**: sign a `CinderNodeDeclaration` with your node-operator key (`signNodeAttestation` from `@cinderous/core`), and place it in the relay's NIP-11 `cinder_node` field (future, with ADR-0089) or publish it as a self-signed event (kind 10038). Contents:
   ```json
   {
     "url": "wss://relay.your-domain",
     "contact": "op@your-domain or npub",
     "region": "EU",
     "software": "cinder-relay",
     "attests": ["ephemeral", "nip40-ttl", "no-plaintext-log", "no-censor"],
     "updatedAt": 1710000000
   }
   ```
3. **Hand the URL to a maintainer** (issue/PR/contact). No forms to fill out, no private material to upload—**the maintainer's tooling will go pull it**.

## Review = Machine-Verified Behavior (what the maintainer does)

The maintainer tooling (`relay/bootstrap/conformance.ts`) runs a **black-box conformance probe** against your node:
- `probeLive`: REQ→EOSE liveness
- `probeEphemeralNotStored`: Ephemeral events (20000–29999) are forwarded but **not stored** (unqueryable afterward)
- `probeRejectsExpired`: NIP-40 expired events are **not returned**
- Rolling uptime record

Results are turned into **graded admission** by `evaluateAdmission`:

| Status | Condition | Effect |
| --- | --- | --- |
| Not listed | liveness failed | — |
| Trial (`accepting:false`) | conformance not passed, or uptime insufficient/unknown | listed for resilience/manual use, **no automatic assignment of new users** |
| Admitted (`weight:1`) | conformance passed + uptime ≥ 95% | automatic assignment (low weight) |
| Admitted (`weight:2`) | conformance passed + uptime ≥ 99% | automatic assignment (higher weight) |

The decision and its rationale are recorded in the **maintainer-signed `relays.json`** (publicly verifiable, tamper-resistant). If something goes wrong → `draining` → `retired`, and existing users are automatically migrated away.

## Honest Boundaries

- **Only behavior is verified**: whether you secretly log metadata happens on your machine and is **technically unauditable**. Cinderous's privacy is **structural** (E2E Gift Wrap + TTL + P2P + multiple relays), and it already assumes relays are adversarial—so the review standard is "**is it stable, is its behavior correct, is it accountable**," not "can it be trusted."
- Self-declaration is **not a guarantee of honesty**; it only provides an accountable identity.
- Joining the pool is **quality control for the newcomer UX**, not a gate on communication; the community can always route around it (manual/hint).
