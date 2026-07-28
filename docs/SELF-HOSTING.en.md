> 🌐 **繁體中文** · [繁體中文版本](./SELF-HOSTING.md)

# Self-Hosting Cinderous (Single Entry Point)

This is the **overview entry point** for self-hosting — one page to understand "which deployment methods exist, how they differ, and which one to pick," then click through to the corresponding detailed docs.

Self-hosting falls into two categories:

- **A. Self-host a relay node (relay)** — add a campfire to this forest. A relay **only forwards ciphertext**; it cannot see the content of your messages, nor who is talking to whom. This is what most people want.
- **B. Self-host the web client (web app)** — deploy the browser version to your own domain. This is for advanced / organizational use.

---

## A. Self-host a relay node (relay)

The same `RelayCore`, four shells to choose from; **a relay always only forwards ciphertext**.

| Method | Difficulty | TLS (`wss://`) | Free tier / limits | Best for |
| --- | --- | --- | --- | --- |
| **Cloudflare Worker** | ★☆☆ least effort | Automatic on the platform | Free tier: ~100k requests/day, duration cap | Getting online fastest, low traffic |
| **Zeabur (PaaS container)** | ★☆☆ | Automatic on the platform | No hard free-tier limits, fixed domain | Escaping free-tier limits without touching TLS/opening ports |
| **Docker / VPS** | ★★☆ | Bring your own (reverse proxy) | Determined by your host | Already have a VPS, want full autonomy |
| **Raspberry Pi / home machine** | ★★★ | Bring your own (open ports + TLS + dynamic IP) | Electricity only (~2–5W) | Maximum autonomy, maximum privacy |

### How to do each method

- **Cloudflare Worker** (the Worker in `relay/`): `pnpm dlx wrangler login` → `wrangler deploy`, obtaining `wss://<worker>.<your-subdomain>.workers.dev`. See [the README's "Setting up a relay on Cloudflare Workers"](../README.en.md) and [`relay/wrangler.toml`](../relay/wrangler.toml). For deploying and registering multiple anchors, see [`MAINTAINER-ACTIVATION.md`](./MAINTAINER-ACTIVATION.en.md).
- **Zeabur (PaaS)**: the platform terminates HTTPS/WSS at the edge, and the container only runs the plain `ws://` `node-relay`. See [`self-hosting-zeabur.md`](./self-hosting-zeabur.en.md).
- **Docker / VPS**: `relay/Dockerfile` is ready (`node-relay` + built-in SQLite, `DB_PATH=/data/…`); mount your own volume and put TLS in front with a reverse proxy (Caddy/Nginx). Refer to [`self-hosting-zeabur.md`](./self-hosting-zeabur.en.md) (same container) and [`self-hosting-raspberry-pi.md`](./self-hosting-raspberry-pi.en.md) (systemd / environment variables).
- **Raspberry Pi / home machine**: any Node 22+ machine works (`node-relay` uses the built-in `node:sqlite`). See [`self-hosting-raspberry-pi.md`](./self-hosting-raspberry-pi.en.md).

### After deployment

- Your node is **immediately usable**: people who fill in the address manually, or set it as a home contact, can all connect to it.
- To be **automatically included in the official selection pool** (added to the maintainer signed relay list) → see [`NODE-SUBMISSION.md`](./NODE-SUBMISSION.en.md) (pull-based, verifiable, no censorship backend).

### Configuration (environment variable reference)

**Everything here is optional** — the relay runs fine with none of it set. Both hosts (the
Cloudflare Worker and `node-relay`) use the same names; only the *place* differs: the Worker reads
`[vars]` in `wrangler.toml` (secrets via `wrangler secret put`), containers and self-hosted setups
read ordinary environment variables.

| Variable | Default | Purpose | Applies to |
| --- | --- | --- | --- |
| `MAX_TTL_DAYS` | `7` | Retention cap for offline messages, in days. A sender's longer expiration tag gets clamped — **the operator's cap is always authoritative** (ADR-0160/0065). | Both |
| `MAX_FILE_MB` | unset | Set to ≥1 to accept file chunks (`FILE_WRAP` 1060). **Unset means the whole class is rejected**, which is zero storage risk for a public node (ADR-0162/0244). | Both |
| `MAX_EVENTS_PER_MINUTE` | `120` | Per-pubkey events-per-minute cap; set `0` to disable (ADR-0235 H1). | `node-relay` only |
| `REQUIRE_AUTH` | On | Set `0` to disable NIP-42 auth. **Strongly discouraged** — see the platform guides. | `node-relay` only |
| `PORT` / `DB_PATH` | `8787` / `cinder-relay.db` | Listen port and SQLite file path. | `node-relay` only |
| `TURN_KEY_ID` / `TURN_API_TOKEN` / `TURN_TTL_SECONDS` | unset | Public TURN fallback (ADR-0243). Unset means `GET /turn` returns 204 and clients fall back to plain STUN. **Set a usage cap on the Cloudflare side** — TURN is billed by bandwidth. | Worker only |

> **`MAX_PER_RECIPIENT` (500 per recipient) is a compile-time constant, not an environment
> variable** — setting it has no effect. Earlier docs listed it as configurable; that was wrong.

### Node identity and the sponsorship entry (NIP-11)

Your relay answers an HTTP GET carrying `Accept: application/nostr+json` with a
**NIP-11 Relay Information Document** (ADR-0260). **Without that header it still returns the plain
text `Cinderous relay`**, so health checks are unaffected.

All of the following are optional, and **fields you leave unset simply do not appear** in the document:

| Variable | Notes |
| --- | --- |
| `RELAY_NAME` | Node name (defaults to `Cinderous relay`). |
| `RELAY_DESCRIPTION` | One-line description. |
| `RELAY_CONTACT` | Contact (email or npub). **Set this if you want to be listed in the seat pool** — one of the admission criteria is that someone can be reached when things break (`NODE-SUBMISSION.en.md`). |
| `RELAY_PUBKEY` | Operator public key (hex). |
| `NODE_ATTESTATION` | Your node self-declaration event signed with your operator key (JSON string), for the maintainer tooling to fetch and verify (ADR-0092). |

**Sponsorship entry (ADR-0089, all optional)** — fill these in and desktop users connected to your
node see a small, dismissible "Support this node" card in the corner:

| Variable | Example |
| --- | --- |
| `DONATE_GITHUB_SPONSORS` | `https://github.com/sponsors/yourname` |
| `DONATE_BUY_ME_A_COFFEE` | `https://buymeacoffee.com/yourname` |
| `DONATE_LIBERAPAY` | `https://liberapay.com/yourname` |
| `DONATE_LIGHTNING` | `you@domain` or `lnurl1…` |

Rules and boundaries:

- The three web platforms accept **`https://` only**; `http://` is discarded by the client (these
  pages ask for payment details).
- **Fill in none of them and no card is shown** — there is no empty card.
- The client only shows it for the user's **home relay**, **never on mobile** (app store policy),
  and never for enterprise identities.
- The card states plainly that this is **self-reported by your node**, **not an official
  endorsement**, and that it **never pays automatically** — clicking only opens an external link in
  the system browser or wallet. The app handles no money and takes no cut (PRD §12).

Worker example (`wrangler.toml`):

```toml
[vars]
RELAY_NAME = "My campfire"
RELAY_CONTACT = "op@example.com"
DONATE_GITHUB_SPONSORS = "https://github.com/sponsors/yourname"
```

Container / self-hosted example:

```bash
RELAY_NAME="My campfire" RELAY_CONTACT="op@example.com" \
DONATE_LIGHTNING="op@example.com" pnpm --filter @cinderous/relay node-relay
```

### Users can ask you to erase their data (NIP-62)

The relay supports **NIP-62 Request to Vanish** (ADR-0260): when a user publishes a kind 62 event
signed with their own key, your node **immediately** deletes the events they authored, the offline
messages addressed to them, and their encrypted cloud snapshot — without waiting for the TTL.

- This is **automatic**. You do not have to do anything, and there is **no** backend for overriding it.
- The request must name your relay (`relay` tag) or `ALL_RELAYS`; requests aimed at another relay do nothing.
- What this means for operators: "delete my data" is a **protocol-level guarantee**, not a promise
  in your privacy policy that users have to take on trust.

---

## B. Self-host the web client (web app)

Deploy Cinderous's **browser version** to your own domain (keys and identity still stored on the user's local device, encrypted). **Security boundary**: for a client-side E2E app, "the server that serves the JS effectively holds the keys," so you must keep the **app and the official site on separate origins + HTTPS end to end + a strict CSP**. See [`self-hosting-web-app.md`](./self-hosting-web-app.en.md) (per ADR-0147/0090).

---

## Related docs

- Maintainer signing-pool activation: [`MAINTAINER-ACTIVATION.md`](./MAINTAINER-ACTIVATION.en.md)
- Third-party node submission: [`NODE-SUBMISSION.md`](./NODE-SUBMISSION.en.md)
- Decision background: ADR-0005 (self-built Worker relay), 0075 (containerized self-hosting), 0039 (anchor / signed relay list), 0147 (web app on a separate origin)
