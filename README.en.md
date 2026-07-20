> 🌐 **繁體中文** · [繁體中文版本](./README.md)

# Cinderous

> **Life is short, connect buddies.**

> A decentralized instant messenger with no central database. It fuses the **Nostr protocol** with **WebRTC** to faithfully recreate the classic interaction experience of early MSN Messenger (nudges, music status, offline messages), with "zero server maintenance cost" as its operating goal.

**🔥 Website: <https://vaalrl.github.io/Cinderous/>** · **🌐 Open in browser (web app): <https://cinderous.cinderous1.workers.dev>** · **💻 Download desktop: [GitHub Releases](https://github.com/VaalRL/Cinderous/releases)**

## Introduction

Cinderous achieves extreme privacy and low latency through a dual-track hybrid network of "state signaling" and "bulk data transfer":

- **Zero-knowledge identity**: On first launch, a secp256k1 key pair (Nostr/NIP-01) is generated locally. The public key (`npub`) is your unique network-wide ID—no username or password. Multiple identities (work / personal) can coexist on the same device.
- **Local-first, encryption at rest**: Conversations and private keys stay on the device; data in localStorage / OPFS is **encrypted with a device key (derived from nsec) using AES-256-GCM** (ADR-0112), and the Tauri desktop build additionally entrusts the private key to the OS keychain. Plaintext never leaves for the cloud.
- **End-to-end encrypted**: Messages are encrypted with Nostr **NIP-17/44/59 Gift Wrap** before they leave the device—the relay cannot see the content, nor the sender, nor the social graph.
- **A path for switching devices, local-only by default**: Local-only by default (total device loss = end of identity); optional recovery paths are also provided—local password remember (Argon2id), device pairing migration (P2P encrypted end to end), encrypted cloud backup, and a backup code (NIP-49). Throughout, everything remains ciphertext, and plaintext / private keys never leak out.

## Technical Architecture Summary

Dual-track hybrid network (dynamically switching by connection state):

| Engine | Technology | Role |
| --- | --- | --- |
| **Engine A: State & Signaling** | Nostr protocol (Cloudflare Workers; SQLite-backed Durable Objects) | Offline message buffering, online status broadcasting, WebRTC initial SDP signaling exchange |
| **Engine B: Bulk Data Transfer** | WebRTC direct connection (P2P) | Real-time interaction: nudges (Nudge), animation delivery, large file transfer—bypassing the relay to achieve millisecond-level latency |

The data lifecycle relies on **NIP-40** (7-day expiration) and **Ephemeral Events** (Kind 20000-29999, pure in-memory forwarding, not written to the database), ensuring that Cloudflare's permanent free tier is never exhausted.

### Client Platforms

- **Desktop (first priority)**: Rust **Tauri** + **React/TypeScript**, packageable into Windows (MSI / NSIS) / macOS / Linux installers; the private key is entrusted to the OS keychain, with a background WebSocket long-lived connection and native file access (company storage vault, etc.). **The same React UI can also run directly in the browser** (development and web runtime environments), landing on encrypted localStorage / OPFS—this is not abandoning the web, but bringing "plaintext never touches disk" to the browser (ADR-0112).
- **Mobile (planned)**: currently **React Native Web** (sharing **the same `RelayChatBackend`** engine as desktop, so features are highly aligned); **native Android / iOS apps have not shipped yet** and are on the [roadmap](https://vaalrl.github.io/Cinderous/) — native packaging (Expo / RN), OS keychain, native notifications, and background push remain to be wired (iOS also needs a macOS build).
- **Relay**: Cloudflare Worker (Durable Objects fan-out), with a Node version also available for self-hosting in a container.

For the full technical specification see [`PRD.md`](./PRD.md), and for module boundaries and data flows see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Project Structure

```text
.
├── apps/
│   ├── desktop/        # Tauri + React + TypeScript（第一優先平台）
│   │   ├── src/        # React/TS 前端 UI 與瀏覽器 demo（demo.html / webrtc.html）
│   │   └── src-tauri/  # Rust：SQLite、Nostr WebSocket、WebRTC、金鑰管理
│   └── mobile/         # React Native + SQLite（輔助平台，預留）
├── packages/
│   └── core/           # 共用 TS：Nostr 事件、secp256k1 簽章、NIP-44/17/59、型別、Kind 常數
├── relay/              # Cloudflare Worker（Nostr 中繼站；Durable Objects 扇出，離線留言預留 DO SQLite）
├── docs/adr/           # 架構決策紀錄（ADR）
└── claude/             # AI 協作規範與開發指南
```

## Current Implementation Status

Everything from the core protocol to the desktop / mobile clients and **enterprise mode** is **already implemented and passing tests** (pnpm monorepo, TypeScript strict, TDD throughout). Summary below (see the more than 180 decision records under [`docs/adr/`](./docs/adr) for details):

**Core Communication**
- Nostr relay: heartbeat / online status, Ephemeral fan-out, offline messages (NIP-17/44/59 Gift Wrap + NIP-40 expiration)
- WebRTC: real P2P (`RTCPeerConnection` / ICE / TURN) voice / video calls, data-channel chunked file transfer, dual-track fallback and automatic rerouting
- Multi-device: QR / pairing migration (P2P, AES-256-GCM), encrypted cloud backup (opt-in), backup code (NIP-49), multi-identity coexistence

**Instant-Messenger Experience (nostalgic MSN style)**
- Nudge (vibration), typing indicator, now-listening (music status), custom status text, invisible mode, local restore of online status
- Emoji reactions, message unsend, read receipts, @mentions, inline replies / threads, timed messages (self-destructing)
- Groups (create / member management), stickers (built-in + custom), conversation backgrounds, private notes (encrypted), media albums
- Avatar broadcast, local nicknames / tags, per-contact sounds, message requests / blocking / removing contacts

**Enterprise Mode (company accounts)**
- Organization roster (administrator-signed), invite-code onboarding, company account key escrow + offboarding takeover
- Company settings (welcome message / work hours, auto-mute after hours), message retention days, company storage vault (file storage)
- Enterprise members locked to a company seat; manageable on both desktop and mobile (only "owner receiving storage-vault landing to disk" is desktop-only = requires a native file system)

- **Tests**: core 327 / engine 265 / relay 88 / theme 14 / i18n 8 / desktop 406 / mobile 197 (over **1,300** in TS) + Rust, including relay↔client end-to-end integration tests.
- **Observable**: the desktop client can be packaged into an installer (see "Client Platforms" above), and can also run directly in the browser (`/`); there is also an end-to-end `demo.html` and a real-WebRTC `webrtc.html`.
- **Full construction plan** (current status, per-platform to-dos, M6–M9 advanced features, dependency order): see [`docs/ROADMAP.md`](./docs/ROADMAP.md).
- **User guide** (for general users: identity and keys, adding friends, local password, the three paths for switching devices, migration, FAQ): see [`docs/使用手冊_User-Guide.md`](./docs/User-Guide.en.md).
- **Frontend development guide** (for community developers: the three-layer architecture, reusing core/i18n, consuming `ChatBackend` to plug in your own UI, AGPL): see [`docs/前端開發指南_Frontend-Guide.md`](./docs/前端開發指南_Frontend-Guide.md) (ADR-0074).

## Getting Started

Requirements: **Node 22+**, **pnpm 10+** (Rust tests also require the stable toolchain).

```bash
# 1. 取得原始碼並安裝 workspace 相依
git clone https://github.com/VaalRL/Cinderous.git && cd Cinderous
pnpm install

# 2. 驗證環境（全綠代表就緒）
pnpm -r test            # 全部 TS 測試（core / engine / i18n / relay / desktop / mobile）
pnpm -r typecheck       # 全部型別檢查

# 3. 起本機真實 relay，再跑桌面前端（瀏覽器開發、不需 Tauri）
pnpm --filter @cinderous/relay build:dev && pnpm --filter @cinderous/relay dev   # ws://localhost:8787
pnpm --filter @cinderous/desktop dev                                          # 前端；開 /?relay=ws://localhost:8787
```

> **Want to plug in your own frontend, add a language, build an extension, or contribute to the core?** The developer entry point is [`.github/CONTRIBUTING.md`](./.github/CONTRIBUTING.en.md) (three-layer architecture, environment, ways to participate, conventions), and the full tutorial for plugging in a frontend is [`docs/前端開發指南_Frontend-Guide.md`](./docs/前端開發指南_Frontend-Guide.md).

### Common Commands

| Task | Command |
| --- | --- |
| Desktop frontend (nostalgic instant-messenger style) | `pnpm --filter @cinderous/desktop dev`, open `/` (also an end-to-end demo `/demo.html`, real WebRTC `/webrtc.html`) |
| Frontend build | `pnpm --filter @cinderous/desktop build` |
| Shared core tests | `pnpm --filter @cinderous/core test` |
| Relay tests | `pnpm --filter @cinderous/relay test` |
| Local real relay (for development) | `pnpm --filter @cinderous/relay build:dev && pnpm --filter @cinderous/relay dev` (starts `ws://localhost:8787`; open the frontend at `/?relay=ws://localhost:8787` to connect to the real relay) |
| Rust tests | `cargo test` (in `apps/desktop/src-tauri/`) |
| Desktop development (requires the Tauri toolchain) | `pnpm --filter @cinderous/desktop tauri dev` |
| Relay local development / deployment (requires wrangler) | `wrangler dev` / `wrangler deploy` (in `relay/`) |

## 🚀 Hosting a Relay on Cloudflare Workers (Nostr / WebRTC signaling relay)

The relay (`relay/`) is a self-built minimal Nostr relay running on Cloudflare Workers, using a
**Durable Object** to hold all WebSocket connections and perform in-memory fan-out. Its responsibilities are:

- **Online status broadcasting** (heartbeat Kind 20000), **typing indicator** (20001), **music status** (20002);
- **WebRTC SDP / ICE signaling exchange** (NIP-59-wrapped ephemeral events, Kind 21000-21999);
- **Offline message** buffering (NIP-17/59 Gift Wrap + NIP-40 expiration; the `message-store` logic is implemented and tested—per-recipient quota, indexed by `#p`. Persistence: the Cloudflare version uses a SQLite-backed Durable Object (`new_sqlite_classes`), the Node self-hosted version uses built-in SQL).

> Once WebRTC P2P is established, **data such as nudges and file transfers travels entirely peer-to-peer and never passes through the relay**.
> Ephemeral events are only forwarded in memory and never land on disk; the relay cannot see the message plaintext, nor the (Gift Wrap-hidden) social graph.

### Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up)
- Node 22+, pnpm 10+
- **Note**: This relay uses Durable Objects. Durable Objects currently require the **Workers paid plan (about US$5/month)** or meeting Cloudflare's current free-plan conditions—before deploying, please refer to the [official pricing documentation](https://developers.cloudflare.com/durable-objects/platform/pricing/) as the authority.

### Steps

```bash
# 1. 取得原始碼並安裝相依（會建立 workspace 連結，wrangler 打包時需要）
git clone <your-fork-url> cinder && cd cinder
pnpm install

# 2. 登入 Cloudflare（會開瀏覽器授權）
cd relay
pnpm dlx wrangler login

# 3. 本地開發：在 ws://127.0.0.1:8787 起一個本機 relay
pnpm dlx wrangler dev

# 4. 部署到 Cloudflare，取得 wss://cinder-relay.<你的帳號>.workers.dev
pnpm dlx wrangler deploy
```

The deployment configuration is in [`relay/wrangler.toml`](./relay/wrangler.toml): the Worker name, the entry point `src/worker.ts`,
and the Durable Object binding (`RELAY_ROOM` → the `RelayRoom` class and migration). wrangler bundles the
TypeScript directly, with no extra build step required. You can edit `name` in `wrangler.toml` to change it to your own Worker name.

### Connection Test

The relay speaks the standard Nostr `REQ` / `EVENT` / `CLOSE` protocol, usable via `@cinderous/core`'s `RelayClient`:

```ts
import { RelayClient, createHeartbeat, generateSecretKey } from "@cinderous/core";

const ws = new WebSocket("wss://cinder-relay.<你的帳號>.workers.dev");
const sk = generateSecretKey();
const client = new RelayClient(
  { send: (data) => ws.send(data) },
  { onEvent: (subId, event) => console.log("收到", subId, event) },
);

ws.addEventListener("message", (m) => client.receive(m.data));
ws.addEventListener("open", () => {
  client.subscribe("presence", [{ kinds: [20000] }]); // 訂閱上線心跳
  client.publish(createHeartbeat(sk));                 // 廣播自己的心跳
});
```

The desktop/frontend can set this `wss://` address as its connection endpoint (see `apps/desktop/src/relay-source.ts`).

### Capacity and Cost

Ephemeral heartbeats fan out as the number of online users grows; please refer to the capacity estimates in [`docs/adr/0006`](./docs/adr/0006-heartbeat-capacity-and-free-tier.md)
(the free tier can support roughly a few dozen concurrent users, and it lists tunable knobs such as heartbeat interval / coalescing / jitter).

### Adding Offline Messages (DO SQLite, next step)

Offline messages require persistence. The DO is already SQLite-backed (`new_sqlite_classes` in `wrangler.toml`); in `worker.ts` connect
`RelayCore` to a `MessageStore` backed by DO SQLite (the behavior is already defined and tested by `relay/src/message-store.ts`:
NIP-40 expiration, per-recipient quota, indexed by `#p`). For details see
[`docs/adr/0005`](./docs/adr/0005-relay-self-built-worker.md).

## Development Conventions

This project uses AI-assisted development, with the hard rules below (see [`CLAUDE.md`](./CLAUDE.md), [`gemini.md`](./gemini.md), and [`claude/`](./claude) for details):

- **Single Source of Truth (SSOT)**: for product requirements see `PRD.md`, for modules and data flows see `ARCHITECTURE.md`.
- **Architecture First / Search First**: locate the module first, then read the existing implementation, and only then start changing.
- **Fix First**: extend the existing design; do not create `v2`, `new_*`, or `*_enhanced` parallel paths.
- **TDD**: feature code follows Red → Green → Refactor, with tests as documentation.
- **Local-first and low-latency**: no change may break message immediacy or the privacy defaults.

## Contributing

Contributions are welcome! Before sending a PR, please note:

- First read [`PRD.md`](./PRD.md) (product specification), [`ARCHITECTURE.md`](./ARCHITECTURE.md) (modules and data flows), and [`docs/adr/`](./docs/adr) (existing decisions).
- Feature code uses **TDD**; before submitting, make sure `pnpm -r typecheck` and `pnpm -r test` are all green (CI checks this too).
- For decisions on architecture / protocol / privacy trade-offs, please add an ADR (format in [`docs/adr/0000-template.md`](./docs/adr/0000-template.md)).
- Privacy is the first principle: no change may let plaintext or private keys leave the device, or leak the social graph without Gift Wrap concealment.

By submitting, you agree to release your contribution under this project's license (AGPL-3.0).

## Security

This is software that handles end-to-end encryption and private keys. It is still under development and **has not yet undergone a security audit**, so please do not use it in high-risk scenarios.
If you find a security issue, please report it through a private channel and do not open a public issue. For the full security policy, encryption inventory, item-by-item threat model, and **list of known limitations**, see [`docs/SECURITY.md`](./docs/SECURITY.en.md).

## License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**—see [`LICENSE`](./LICENSE) for details.

This means you are free to use, modify, and distribute it; but if you **distribute a modified version, or provide a modified version as a network service (for example, self-hosting this relay)** to others,
you must publish your source code under the same license (AGPL Section 13). This choice is made to ensure that all derivative versions and self-hosted relays remain transparent and auditable to users, carrying through this project's spirit of privacy and decentralization.

Copyright (C) 2026 Cinderous contributors.
