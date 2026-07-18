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

---

## B. Self-host the web client (web app)

Deploy Cinderous's **browser version** to your own domain (keys and identity still stored on the user's local device, encrypted). **Security boundary**: for a client-side E2E app, "the server that serves the JS effectively holds the keys," so you must keep the **app and the official site on separate origins + HTTPS end to end + a strict CSP**. See [`self-hosting-web-app.md`](./self-hosting-web-app.en.md) (per ADR-0147/0090).

---

## Related docs

- Maintainer signing-pool activation: [`MAINTAINER-ACTIVATION.md`](./MAINTAINER-ACTIVATION.en.md)
- Third-party node submission: [`NODE-SUBMISSION.md`](./NODE-SUBMISSION.en.md)
- Decision background: ADR-0005 (self-built Worker relay), 0075 (containerized self-hosting), 0039 (anchor / signed relay list), 0147 (web app on a separate origin)
