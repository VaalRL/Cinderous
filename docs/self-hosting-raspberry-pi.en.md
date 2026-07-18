> 🌐 **繁體中文** · [繁體中文版本](./self-hosting-raspberry-pi.md)

# Self-Hosting a Cinderous Relay on a Raspberry Pi (node-relay)

Run a Cinderous relay on your own Raspberry Pi (or any machine with Node 22+). It runs the **exact same `RelayCore` as the Cloudflare version**; the only difference is that the shell is swapped out for Node.js + local SQLite.

> **The key point**: self-hosting means **fully escaping the Cloudflare free-tier limits** (no 100,000 requests/day, no 13,000 GB-s of duration), with the only cost being electricity (about 2–5W). The relay **only forwards ciphertext**, and it cannot see your plaintext or private key — self-hosting actually gives you better privacy.

---

## 1. Requirements

- A Raspberry Pi (Pi 3 / Pi 4 / Pi Zero 2 all work; more than enough for a small circle of friends) or any Linux machine.
- **Node.js 22 or later** (node-relay uses Node's built-in `node:sqlite`, which requires 22+).
- `pnpm` (`npm i -g pnpm`).
- A way to be reachable from the outside (see §5, the crux of home networks).

Install Node 22 (Raspberry Pi OS / Debian):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # should show v22.x or later
```

---

## 2. Quick Start

```bash
git clone https://github.com/VaalRL/Nostr-buddy.git cinder
cd cinder
pnpm install
# Build and start node-relay (defaults: ws://0.0.0.0:8787, NIP-42 auth enabled, SQLite stored at cinder-relay.db)
pnpm --filter @cinderous/relay node-relay
```

When you see this line, it's up:

```
Cinderous node-relay：ws://0.0.0.0:8787（DB=cinder-relay.db, requireAuth=true）
```

Local self-test (open another terminal):

```bash
# Connect with wscat (npm i -g wscat); once connected you'll receive a ["AUTH", "<challenge>"] (the NIP-42 challenge)
wscat -c ws://localhost:8787
```

---

## 3. Configuration (Environment Variables)

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8787` | Listening port. |
| `DB_PATH` | `cinder-relay.db` | Path to the SQLite file for offline messages (an absolute path is recommended). |
| `REQUIRE_AUTH` | enabled | Set `REQUIRE_AUTH=0` to disable NIP-42 auth (**not recommended** — turning it off lets anyone pull other people's encrypted inbox metadata, and the cloud snapshot ciphertext (ADR-0071) also loses its "return to the author only" gate; see ADR-0057). |
| `MAX_PER_RECIPIENT` | `500` | Maximum number of offline messages per recipient (prevents flooding). |

Example:

```bash
PORT=9000 DB_PATH=/home/pi/cinder/relay.db pnpm --filter @cinderous/relay node-relay
```

---

## 4. Being Reachable from the Outside (the Crux of Home Networks)

Clients need to connect to you over **encrypted `wss://`**. A home network sits behind NAT, so there are two paths:

### Option A (recommended): Cloudflare Tunnel — no port forwarding, no wrangling your own certificate

`cloudflared` tunnels your local service through to a public HTTPS/WSS endpoint (with TLS built in):

```bash
# Install cloudflared (arm64 Pi)
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o cloudflared
sudo install cloudflared /usr/local/bin/

# Quick ad-hoc tunnel (for testing): prints a https://xxxx.trycloudflare.com
cloudflared tunnel --url http://localhost:8787
```

Take the URL you get and replace `https` with `wss`, and that's your relay address: `wss://xxxx.trycloudflare.com`.
For long-term production use, set up a **named tunnel + your own domain** (`cloudflared tunnel login` → `create` → bind DNS), and the URL will be stable.

### Option B: Port forwarding + reverse proxy for TLS

1. Have your router forward an external port to the Pi's `8787`.
2. Use a reverse proxy such as Caddy to automatically obtain a Let's Encrypt certificate and proxy `wss://relay.your-domain` to `localhost:8787`:

```
relay.your-domain {
    reverse_proxy localhost:8787
}
```

(You need a domain pointing at your home IP; a dynamic IP can be paired with dynamic DNS.)

---

## 5. Using Your Node in Cinderous

Cinderous has multi-relay routing built in (ADR-0034): the ID you share carries a relay hint, `npub…@wss://…`.

- When you log in, set the relay URL to yours: `wss://relay.your-domain` (or the trycloudflare URL).
- The ID you share with friends then becomes `npub…@wss://relay.your-domain`, and as soon as someone adds it they'll connect to your node.
- It's fine if a friend is on a different relay — multi-relay routing will connect to each other's relay to send and receive, and your node is just one of them.

---

## 6. Running 24/7 (systemd)

Build once, then keep it running with systemd (auto-start on boot, auto-restart on crash):

```bash
pnpm --filter @cinderous/relay build:node-relay   # produces relay/dist/node-relay.js
```

`/etc/systemd/system/cinder-relay.service`:

```ini
[Unit]
Description=Cinderous node-relay
After=network-online.target

[Service]
Environment=PORT=8787
Environment=DB_PATH=/home/pi/cinder/relay.db
WorkingDirectory=/home/pi/cinder/relay
ExecStart=/usr/bin/node dist/node-relay.js
Restart=always
User=pi

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now cinder-relay
sudo systemctl status cinder-relay
journalctl -u cinder-relay -f   # watch live logs
```

(`cloudflared` can likewise be made into a persistent service; for a named tunnel use `cloudflared service install`.)

---

## 7. Differences from the Cloudflare Version

| | Cloudflare (worker.ts) | Raspberry Pi (node-relay.ts) |
| --- | --- | --- |
| Core | The same `RelayCore` | The same `RelayCore` |
| Persistence layer | SQLite built into the DO | Node `node:sqlite` file |
| Expiry cleanup | DO `alarm()` hourly | `setInterval` hourly |
| Hibernation | Hibernation API saves duration | Not needed (your own hardware, only electricity cost) |
| Quota | Free tier: 100,000 requests / 13,000 GB-s | **None** — limited by your Pi's capacity |

---

## 8. Security and Privacy

- The relay **only forwards ciphertext** (NIP-59 Gift Wrap) and ephemeral state; it cannot see plaintext, and it holds no private key.
- Keep `requireAuth` enabled: only the owner (who can sign for their own pubkey) can pull their own encrypted inbox (ADR-0057).
- The database `relay.db` contains only ciphertext and expiry times; even so, it's best to keep it on a machine you trust and to restrict the file permissions.

If you have questions, or you'd like node-relay packaged into an easier one-click installer, just report back to the maintainers.

> **Don't want to deal with home-network port forwarding/TLS?** The same node-relay can also be deployed with one click to a PaaS like Zeabur (automatic HTTPS/wss, a stable domain, no port forwarding) — see [`doc./self-hosting-zeabur.en.md`](./self-hosting-zeabur.en.md).
