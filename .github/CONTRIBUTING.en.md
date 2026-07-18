> 🌐 **繁體中文** · [繁體中文版本](./CONTRIBUTING.md)

# Contributing to Cinderous

Welcome, community developers. Cinderous is a **decentralized, end-to-end encrypted** instant messenger (Nostr + WebRTC), AGPL-3.0. This document is the developer's entry point—whether you want to **plug in your own frontend**, **add a language**, **build an extension**, or **contribute to the core**, start here.

> General users should see [`docs/使用手冊_User-Guide.md`](../docs/User-Guide.en.md).

---

## Three-Layer Architecture (understand this first)

Cinderous deliberately splits "protocol/encryption," "communication engine," and "UI" into three workspace packages, so you only touch the layer you need:

```
Your frontend (React / RN / Vue / any framework)        ← build the UI, consume ChatBackend
  ▲
@cinderous/engine   communication backend (ChatBackend implementation) + storage abstraction   ← reuse directly
  ▲
@cinderous/core     keys/signatures/NIP-44/59/groups/WebRTC signaling     ← zero UI dependency
@cinderous/i18n     translations (pure functions)
```

| Package | Responsibility | Will you touch it? |
| --- | --- | --- |
| `@cinderous/core` | Nostr events/signatures/encryption/protocol primitives (SSOT) | Reuse, don't modify |
| `@cinderous/i18n` | Translations; supports runtime locale packs (K3) | When adding a language |
| `@cinderous/engine` | `ChatBackend` contract + `RelayChatBackend`/`BrowserChatBackend` + `AppStorage`/`LocalStorage`; device switch/migration/snapshot/extension seam | When building a backend |
| `apps/desktop` | Tauri + React desktop frontend | Reference template |
| `apps/mobile` | react-native-web frontend (already consumes engine; proof of cross-frontend reuse) | Reference template |
| `relay` | Cloudflare Worker / Node self-hosted relay | When self-hosting |

---

## Development Environment

Requirements: **Node 22+**, **pnpm 10+** (Rust tests also require the stable toolchain).

```bash
git clone https://github.com/VaalRL/Nostr-buddy.git cinder && cd cinder
pnpm install          # install workspace dependencies
pnpm -r test          # all TS tests (core / engine / relay / desktop / mobile / i18n)
pnpm -r typecheck     # all type checks
```

Run the desktop frontend (browser development, no Tauri needed):

```bash
pnpm --filter @cinderous/relay build:dev && pnpm --filter @cinderous/relay dev   # local real relay (ws://localhost:8787)
pnpm --filter @cinderous/desktop dev                                          # frontend; open /?relay=ws://localhost:8787
```

---

## What do you want to do?

### A. Plug in your own frontend

The most common community scenario. Full tutorial: **[`docs/前端開發指南_Frontend-Guide.md`](../docs/前端開發指南_Frontend-Guide.md)**. The three-line version:

```ts
import { RelayChatBackend, webSocketConnector, LocalStorage, type ChatBackend } from "@cinderous/engine";
const backend: ChatBackend = new RelayChatBackend(new LocalStorage(""), webSocketConnector("wss://…"), "名稱", { relayUrl: "wss://…", connectorFor: webSocketConnector });
backend.start({ onContacts: render, onMessage: append, onTyping: t, onNudge: n }); // you only handle the UI
```

`apps/mobile/src/chat.ts` is the minimal working template for "a non-desktop frontend consuming the same engine."

### B. Add a language (K3)

No need to modify the core—register at runtime:

```ts
import { registerLocale, availableLocales } from "@cinderous/i18n";
registerLocale("ja", { /* complete Messages object */ });
// afterwards translate("ja", key) takes effect; uncovered keys fall back to the default locale
```

Or add the language directly to `packages/i18n/src/messages.ts` to make it a built-in locale (submit a PR).

### C. Change the theme / color scheme

The desktop UI is already tokenized: override the single `--accent` CSS variable and the whole thing follows (the rest is derived via `color-mix`), with light/dark switched by the `data-theme` attribute. A custom frontend is entirely free—`ChatBackend` is not bound to any CSS.

### D. Build an extension (K4, experimental)

`@cinderous/engine` reserves an in-process, first-party extension registration seam:

```ts
import { registerExtension, listExtensions } from "@cinderous/engine";
registerExtension({ id: "my.renderer", name: "自訂訊染" /* …your capabilities */ });
```

> ⚠️ **The mechanism for loading third-party/remote code is not yet implemented**—it involves sandboxing and trust boundaries, and will be finalized by a K4-specific ADR. For now it is only for composing your own code; do not load untrusted parties.

### E. Contribute to the core / fix bugs / add features

See the "Contribution Guidelines" below.

---

## Contribution Guidelines (PR bar)

This project has a strong **decision-record culture**; please read before you act:

1. **Read first** [`PRD.md`](../PRD.md) (product spec), [`ARCHITECTURE.md`](../ARCHITECTURE.md) (module boundaries), [`docs/adr/`](../docs/adr) (why decisions were made this way).
2. **Architecture/design-level decisions must add an ADR** (module boundaries, encryption/protocol choices, data flow, privacy trade-offs, external dependencies, etc.)—for the format see [`docs/adr/0000-template.md`](../docs/adr/0000-template.md), and update the index. Once an ADR is "Accepted" it must not be altered; if a decision changes, add a new one and mark the old one as superseded.
3. **Feature code follows TDD** (Red → Green → Refactor); tests are documentation.
4. **Before a PR**, `pnpm -r typecheck` and `pnpm -r test` must be all green; if you touched Rust, `cargo test` too.
5. **Privacy first**: plaintext and private keys must not leave the device; the relay only forwards ciphertext and Ephemeral state, and does not persist online status.
6. **Fix First**: prefer fixing/extending existing designs; do not create `v2`/`new_*`/`*_enhanced` parallel paths.
7. If you change module boundaries, the Nostr event contract, or the WebRTC flow, **update `ARCHITECTURE.md` in sync**.

For engineering details, also see [`AGENTS.md`](../AGENTS.md) and [`CLAUDE.md`](../CLAUDE.md).

---

## License (important)

Cinderous is **AGPL-3.0**. Your freedom to fork, modify, and distribute is protected—**but** as soon as you **distribute** a modified version, or **stand it up as a network service for others to use**, you **must release your source code under AGPL** (including your frontend). This means you **cannot build a closed-source/commercial custom client**: for the open ecosystem it is a protection, and for those wanting to go closed-source it is a hard barrier. Submitting a PR means you agree to release your contribution under AGPL-3.0.

---

## Self-Hosting a Relay

Want to run your own relay? See [`docs/self-hosting-zeabur.md`](../docs/self-hosting-zeabur.en.md) (one-click PaaS, automatic wss) or [`docs/self-hosting-raspberry-pi.md`](../docs/self-hosting-raspberry-pi.en.md) (home/Raspberry Pi).

If you have questions, open an issue. Your first PR is welcome.
