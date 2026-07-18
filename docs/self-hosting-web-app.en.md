> 🌐 **繁體中文** · [繁體中文版本](./self-hosting-web-app.md)

# Self-Hosting the Cinderous Web App (browser app, on a subdomain separate from your main site)

Deploy Cinderous's **browser app** to your own domain: put a "Sign in" entry point on your main site, and clicking it jumps to the app subdomain. From there everything runs with the browser as the interface, and **keys and identity are all stored on the user's own device** (encrypted). The core messaging experience is identical to the desktop version — because it runs the **same** React + `@cinderous/engine`, just taking the browser path when `isTauri()` detects `false`.

> **Remember one thing first (the security boundary)**: for an end-to-end encrypted client-side app, **the server that ships the JS effectively holds the keys**. That is why this guide insists on two things: **keep the app and the main site on different origins (subdomains)**, and **serve the app origin over HTTPS with a strict CSP throughout**. See `docs/adr/0147-self-hosted-web-app-separate-origin.md` and `0090` for the rationale.

---

## 1. How it works

```
User ──HTTPS──▶ www.example.com (main site, purely static, zero tracking)
                     │ "Sign in" = a single cross-origin link
                     ▼
User ──HTTPS──▶ app.example.com (browser app = the web build of apps/desktop)
                     │
                     └──wss://──▶ your (or the default) relay, which only forwards ciphertext
```

- The **main site** and the **app** are on **different subdomains (origins)**: even if the main site is compromised, it cannot replace the app's JS (the keys live in the memory of the app origin). The main site's "Sign in" is just an `<a href="https://app.example.com/">`.
- **Keys stay on the device**: in browser mode the nsec is wrapped locally with an Argon2id local password and stored in `localStorage` (plaintext never touches disk, ADR-0112), and the local password is **mandatory** (ADR-0122). The relay only forwards ciphertext — it never sees plaintext or the private key.

---

## 2. Prerequisites

- A domain whose DNS you can configure (the examples below use `example.com`).
- Any **static hosting** (Cloudflare Pages / Netlify / Vercel / GitHub Pages / nginx, …) that can bind a custom subdomain, provide HTTPS, and **set response headers (CSP)**.
- A relay: use the default `wss://cinder-relay.cinderous1.workers.dev`, or self-host one (see `docs/self-hosting-zeabur.md` / `self-hosting-raspberry-pi.md`).

---

## 3. Build the browser app

From the repo root:

```bash
pnpm install
pnpm --filter @cinderous/desktop build
```

The output is in **`apps/desktop/dist/`** (`index.html` plus fingerprinted JS/CSS). `index.html` is the **product entry point = the sign-in screen**. (`dist/` will also contain `demo.html` / `webrtc.html`; you can ignore these or leave them unlinked when deploying the product.)

---

## 4. Point at the relay you want to use (only needed for a self-hosted relay)

The default nodes come from `@cinderous/engine`'s `ANCHOR_RELAYS`. To steer users to **your own** relay, pick one of three (no changes to core logic needed):

1. **Add a parameter to the main site's sign-in link** (least effort): `https://app.example.com/?relay=wss://relay.example.com` — `?relay=` takes precedence over local memory, so users connect to your node the moment they arrive.
2. **Change the default before building**: edit `@cinderous/engine`'s `ANCHOR_RELAYS`, then build.
3. **Let users enter it themselves**: the "Use another relay" option on the sign-in screen.

---

## 5. Deploy to the app subdomain (HTTPS)

Publish `apps/desktop/dist/` to **`app.example.com`** (**separate** from the main site `www.example.com`). Each static host works differently, but the common points are: **set the build output directory to `apps/desktop/dist`**, and **bind `app.example.com` with HTTPS enabled**.

### Recommended CSP (set as a response header on the app origin)

Allow only your own resources and your relay, and block third-party scripts to shrink the surface for "injecting malicious JS":

```
Content-Security-Policy:
  default-src 'self';
  connect-src 'self' wss://relay.example.com;
  img-src 'self' data: blob:;
  media-src 'self' blob:;
  style-src 'self' 'unsafe-inline';
  base-uri 'none';
  object-src 'none';
  frame-ancestors 'none'
```

- Set `connect-src` to **the relay you actually connect to** (your self-hosted URL if self-hosting; `wss://cinder-relay.cinderous1.workers.dev` if using the default node). If you allow users to enter any relay themselves, you need to loosen this to `connect-src wss:` — **a trade-off**: flexibility comes at the cost of a larger connection surface, so for self-hosted setups we recommend pinning to your own relay.
- WebRTC calls go over P2P and do not need to be opened up separately in `connect-src` (browser RTC is not restricted by `connect-src`); if you need TURN, adjust according to your TURN configuration.

### Concrete settings for each host

Concrete settings for three common static hosts. Common points: the monorepo uses a pnpm workspace, so **keep the build root at the repo root** (it needs the root lockfile and `packages/*`) and set the **output directory to `apps/desktop/dist`**. Replace `wss://relay.example.com` in the CSP below with **your actual relay**.

> **Don't specify the pnpm version twice**: all three use corepack to automatically install the correct version based on `package.json`'s `packageManager` (`pnpm@10.33.0`) — **do not** additionally set a pnpm version in the platform settings, or "multiple pnpm versions specified" will stall the install step (the same pitfall this project's CI ran into).

The `_headers` / `netlify.toml` / `vercel.json` files below are all **deployment-specific** (they contain your relay URL) — keep them in **your own fork / deployment** and do not PR them back to the shared repo (the shared repo stays independent of any relay domain).

**Cloudflare Pages**
- Link the repo → set Framework preset to **None**.
- Build command: `pnpm --filter @cinderous/desktop build` (CF installs first automatically)
- Build output directory: `apps/desktop/dist`; Root directory: the repo root (`/`).
- CSP: in your fork, add `apps/desktop/public/_headers` (Vite copies it into `dist`; create `public/` if it doesn't exist):
  ```
  /*
    Content-Security-Policy: default-src 'self'; connect-src 'self' wss://relay.example.com; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'
  ```
- Custom domain: add `app.example.com`.

**Netlify**
- In your fork, add a `netlify.toml` at the repo root:
  ```toml
  [build]
    command = "pnpm --filter @cinderous/desktop build"
    publish = "apps/desktop/dist"

  [[headers]]
    for = "/*"
    [headers.values]
      Content-Security-Policy = "default-src 'self'; connect-src 'self' wss://relay.example.com; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'"
  ```
- Custom domain: add `app.example.com` under Domain settings.

**Vercel**
- Project settings: Framework Preset **Other**, Build Command `pnpm --filter @cinderous/desktop build`, Output Directory `apps/desktop/dist`, Install Command `pnpm install`.
- In your fork, add a `vercel.json` at the repo root:
  ```json
  {
    "headers": [
      {
        "source": "/(.*)",
        "headers": [
          { "key": "Content-Security-Policy", "value": "default-src 'self'; connect-src 'self' wss://relay.example.com; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'" }
        ]
      }
    ]
  }
  ```
- Custom domain: add `app.example.com` under Project → Domains.

---

## 6. The main-site side

The main site is just an ordinary static site (you can use `apps/website` directly, or your own). **The only thing you must do** is place a link that points to the app:

```html
<a href="https://app.example.com/?relay=wss://relay.example.com">Sign in / Get started</a>
```

**Do not** embed the app via an iframe within the main-site origin, and do not stuff the app build into the same origin as the main site — that would expose the main site's attack surface to the key boundary (exactly what ADR-0090 / 0147 aim to avoid).

---

## 7. Two things you must tell your users

1. **The local password is mandatory, and please back up the nsec**: the browser has no OS keychain. If a user "clears site data" or the browser evicts its storage, the local (encrypted) identity is **wiped** — the only way to recover it is to have first written down the **nsec / encrypted backup code** under "Settings → Identity backup".
2. **This is a web-delivered E2E app**: every load trusts the JS served by `app.example.com`. For stronger guarantees (signed binary + OS keychain), guide users to switch to the **native desktop version**.

---

## 8. Acceptance checklist

- [ ] `app.example.com` and the main site `www.example.com` are on **different origins**.
- [ ] The app origin uses **HTTPS** and has a **strict CSP** set (`connect-src` contains only your relay).
- [ ] Opening `app.example.com` shows the sign-in screen, and you can create an identity and connect to the relay (DevTools → Network shows `wss://` connected).
- [ ] Create an identity, then reload the page → it goes to the **unlock screen** (proving the local password wrapping works and keys are stored on the device).
- [ ] The main site's "Sign in" link jumps to the app subdomain (and automatically connects to the right node if `?relay=` is included).
- [ ] The manual / first-run screen reminds users to **back up their nsec**.
