> 🌐 **繁體中文** · [繁體中文版本](./self-hosting-zeabur.md)

# Self-hosting a Cinderous relay on Zeabur (node-relay)

Running a Cinderous relay on a PaaS like [Zeabur](https://zeabur.com) is far less hassle than a home network / Raspberry Pi: **the platform provisions HTTPS automatically (`wss://` works out of the box, no certificate to manage yourself), you get a stable domain, and you can bind a custom domain**. It runs **exactly the same `RelayCore` as the Cloudflare version**, only with the shell swapped for Node.js + local SQLite (the same node-relay as in `docs/self-hosting-raspberry-pi.md`).

> **Why is it better than the Cloudflare version?** It escapes the free-tier limits (no 100,000 requests/day cap, no duration limit); it's less hassle than a Raspberry Pi (no port forwarding, no TLS setup, no dynamic-IP juggling). The relay **only forwards ciphertext** — it can't see your plaintext or your private key.

---

## 1. How it works (understand one thing first)

Cinderous clients connect over `wss://` (encrypted WebSocket). You **don't need to handle TLS inside the container** — Zeabur's gateway terminates HTTPS/WSS at the edge, then forwards to your container as plain `ws://`. So:

```
Client  ──wss://your-service.zeabur.app──▶  Zeabur gateway (TLS)  ──ws://──▶  your container :PORT
```

The container only needs to listen on the `PORT` that Zeabur injects (node-relay reads it automatically); Zeabur handles the rest.

---

## 2. Prerequisites

- A [Zeabur](https://zeabur.com) account (you can sign in with GitHub).
- This repo on a GitHub you can reach (for example, your own fork).
- The repo already ships **`relay/Dockerfile`** and a root **`.dockerignore`** — no need to write your own.

---

## 3. Deployment steps

### 3.1 Create the service

1. Zeabur → create a Project → Add Service → **Deploy from GitHub**, and pick this repo.
2. Because it's a monorepo and you want to use the bundled Dockerfile, set the service's build method to **Dockerfile**:
   - **Dockerfile path**: `relay/Dockerfile`
   - **Build context / Root Directory**: keep it at the **repo root** (`/`) — the pnpm workspace needs the root lockfile and `packages/core`, so it must not be set to `relay/`.

> If Zeabur's UI ties "Root Directory" and "Dockerfile location" together and won't let you set them separately, the simplest workaround is to copy `relay/Dockerfile` to the repo root and name it `Dockerfile`; Zeabur will pick it up automatically (the build context is the root, so everything works).

### 3.2 Add a persistent Volume (important)

Offline messages are stored in a SQLite file, which by default is wiped on container restart/redeploy. Mount a Volume so it survives:

- Service → Volumes → add one, and set the **mount path to `/data`**.
- `relay/Dockerfile` already defaults `DB_PATH=/data/cinder-relay.db`, so it takes effect once mounted — no further changes needed.

> It runs without a Volume too; it just means every redeploy clears "offline messages not yet picked up" (which are only kept for 7 days anyway, so the impact is limited). Mount one if you want it to be reliable.

### 3.3 Environment variables (mostly fine on defaults)

Service → Variables, set only if needed:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | Injected automatically by Zeabur | **Don't set it yourself**; node-relay reads it. |
| `DB_PATH` | `/data/cinder-relay.db` | Set by the Dockerfile; pairs with the Volume in §3.2. |
| `REQUIRE_AUTH` | On | Keep it on. Setting it to `0` disables NIP-42 authentication — anyone could pull other people's encrypted-inbox metadata, and cloud snapshots would lose the "owner-only" gate (ADR-0057/0071), so this is **strongly discouraged**. |
| `MAX_PER_RECIPIENT` | `500` | Offline-message cap per recipient. |

### 3.4 Open a public domain

- Service → Networking → generate a public domain, and you'll get `your-service.zeabur.app`.
- For a proper URL you can bind a **custom domain** (for example `relay.your-domain`) — Zeabur will provision TLS automatically.
- Your relay address is just `https` swapped for `wss`: **`wss://your-service.zeabur.app`**.

### 3.5 Verify

- Open `https://your-service.zeabur.app/` in a browser and you should see the plain text **`Cinderous relay`** (this is also the endpoint the health check hits).
- Going further, you can run `wscat -c wss://your-service.zeabur.app`; once connected you'll receive a `["AUTH", "<challenge>"]` (the NIP-42 challenge) = everything's working.

---

## 4. Using your node in Cinderous

Once you have `wss://your-service.zeabur.app`, there are two ways to use it:

1. **Just for yourself / a small circle**: when logging in to Cinderous, change the relay address to yours (the login field defaults to the official relay, so just replace it). The ID you share automatically becomes `npub…@wss://your-service.zeabur.app`, so a friend connects to your node the moment they add you.
2. **As the app's default relay** (so new users connect to yours automatically): put it in `ANCHOR_RELAYS` in `apps/desktop/src/bootstrap-config.ts` (see `docs/OPERATOR-TODO.md §A`). We recommend at least two anchors on different platforms to avoid a single point of failure (ADR-0039).

> It's fine if a friend is on a different relay — Cinderous's multi-relay routing (ADR-0034) will connect to each other's relay to send and receive, and your node is just one of them.

---

## 5. Costs and things to watch for

- **Wake/always-on**: depending on your plan, Zeabur may have a sleep policy. For a relay to "always be reachable for offline messages" it's best to keep it always-on — make sure your plan won't let it sleep hard (while it sleeps, offline messages still rely on client retries, but immediacy drops).
- **Capacity**: no longer bound by the Cloudflare free tier's request/duration limits; instead it's constrained by your Zeabur plan's resource quota. See `docs/adr/0006` for heartbeat-volume estimates.
- **Privacy**: self-hosting = the message path doesn't go through a third-party cloud. The relay only ever sees ciphertext — never the content or the social graph.

---

## 6. Differences from other deployment methods

| | Cloudflare (worker.ts) | Raspberry Pi (node-relay) | **Zeabur (node-relay)** |
| --- | --- | --- | --- |
| Core | The same `RelayCore` | The same `RelayCore` | The same `RelayCore` |
| Persistence | SQLite built into the DO | Node `node:sqlite` file | Node `node:sqlite` + Volume |
| TLS / `wss://` | Automatic via Cloudflare | Do it yourself (cloudflared/Caddy) | **Automatic via Zeabur** |
| Public domain | `*.workers.dev` | Set up dynamic DNS yourself | **`*.zeabur.app` + custom domain support** |
| No port forwarding | ✅ | ❌ (home networks need port forwarding/hole punching) | ✅ |
| Quota limits | Free tier: 100,000 requests/duration | None (just electricity) | Per your Zeabur plan |

---

> **In one sentence**: Zeabur takes care of nearly all the "self-hosting hassle" (certificates, domains, port forwarding), and the bundled `relay/Dockerfile` is deployable as-is — all you need to do is mount a Volume and open a domain to have your own `wss://` relay.
