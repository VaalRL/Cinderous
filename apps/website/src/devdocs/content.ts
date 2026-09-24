// 開發者文件的內容（ADR-0368）：給要把應用接到 Cinderous 中繼「車道」的第三方開發者。
//
// ## 🔴 這裡的每一個數字都是中繼站實際在執行的值
//
// 來源是 `relay/src/host-config.ts`、`relay-core.ts`、`message-store.ts` 與 ADR-0366／0367／0369。
// 那些常數一改，這裡要跟著改——文件說 7 天、實際存 2 小時，是第三方開發者最難查的一種錯。
// `Developers.test.tsx` 對其中幾個最關鍵的數字做了比對。
//
// ## 行內標記
//
// 文字裡只有兩種標記，由 `pages/Developers.tsx` 解析：
// - `` `code` `` → `<code>`
// - `[文字](href)` → 連結。`href` 可以是 `doc:`（總覽）、`doc:<slug>`（子頁）、`view:<頁面>`
//   （官網其他頁）、`repo:<路徑>`（GitHub 上的檔案），或一般的 `https://` 網址。
//   站內連結在渲染時才算出來，所以這份內容不依賴網址前綴、也不依賴 `App.tsx`。

import type { Locale } from "@cinderous/i18n";
import type { DevDocSectionId, DevDocSlug } from "./structure.js";

export type Block =
  | { p: string }
  | { code: string }
  | { list: string[] }
  | { table: { head: string[]; rows: string[][] } }
  | { note: string };

export interface DocSection {
  /** 頁內錨點（右側目錄與 `#` 連結用）。 */
  id: string;
  title: string;
  blocks: Block[];
}

export interface DocPage {
  /** 頁面標題；也用在左側導覽。 */
  title: string;
  /** SEO description（50–320 字元）。 */
  description: string;
  lead: string;
  sections: DocSection[];
}

export interface DevDocs {
  /** 左側導覽最上方的標題。 */
  navTitle: string;
  overviewLabel: string;
  sectionTitles: Record<DevDocSectionId, string>;
  tocLabel: string;
  prevLabel: string;
  nextLabel: string;
  pages: Record<"overview" | DevDocSlug, DocPage>;
}

const ANCHOR_1 = "wss://cinder-relay.cinderous1.workers.dev";
const ANCHOR_2 = "wss://cinder-relay.jt0856.workers.dev";
const NIP = (n: string): string => `https://github.com/nostr-protocol/nips/blob/master/${n}.md`;

const QUICK_START_CODE = [
  'import { Relay } from "nostr-tools/relay";',
  'import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";',
  "",
  "const sk = generateSecretKey();",
  `const relay = await Relay.connect("${ANCHOR_1}/app/my-game");`,
  "",
  "// Subscribe with a tag filter — no AUTH needed.",
  'relay.subscribe([{ kinds: [1078], "#t": ["my-game-lobby"] }], {',
  "  onevent(event) {",
  "    console.log(event.pubkey, event.content);",
  "  },",
  "});",
  "",
  "// Publish — also no AUTH needed.",
  "await relay.publish(",
  "  finalizeEvent(",
  '    { kind: 1078, created_at: Math.floor(Date.now() / 1000), tags: [["t", "my-game-lobby"]], content: "hello" },',
  "    sk,",
  "  ),",
  ");",
].join("\n");

const AUTH_CODE = [
  "// Continues the Quick start; also import getPublicKey from \"nostr-tools/pure\".",
  "// The relay sends [\"AUTH\", <challenge>] as soon as you connect.",
  "// Answer it only if you need #p subscriptions (your own inbox).",
  "await relay.auth(async (template) => finalizeEvent(template, sk));",
  "",
  'relay.subscribe([{ kinds: [20078], "#p": [getPublicKey(sk)] }], {',
  "  onevent(invite) {",
  "    /* someone signalled you */",
  "  },",
  "});",
].join("\n");

const NIP11_CODE = [
  "curl -H 'Accept: application/nostr+json' \\",
  "  https://cinder-relay.cinderous1.workers.dev/app/my-game",
].join("\n");

const en: DevDocs = {
  navTitle: "Developer docs",
  overviewLabel: "Overview",
  sectionTitles: {
    start: "Getting started",
    reference: "Relay reference",
    help: "Help and resources",
  },
  tocLabel: "On this page",
  prevLabel: "Previous",
  nextLabel: "Next",
  pages: {
    overview: {
      title: "Build on the Cinderous relay",
      description:
        "Developer docs for third-party apps on the Cinderous Nostr relay: connect to an app lane at /app/<id>, publish and subscribe without sign-up, and learn the retention, rate limits and errors.",
      lead:
        "The Cinderous anchor relays are open to third-party Nostr apps through app lanes: a separate part of the relay with its own storage and rules, reachable at `/app/<your-app-id>`. There is no sign-up, no API key and no payment.",
      sections: [
        {
          id: "what-you-can-build",
          title: "What you can build",
          blocks: [
            { p: "App lanes are designed for apps that need a small, fast, shared meeting point rather than a permanent archive:" },
            {
              list: [
                "Lobbies and presence — who is online right now (ephemeral events, never stored).",
                "Signalling — invitations and WebRTC offers addressed to one player.",
                "Asynchronous shared worlds — action logs that many players append to.",
                "Published game data — decks, loadouts and world snapshots as addressable events.",
              ],
            },
          ],
        },
        {
          id: "how-to-use",
          title: "How to use it",
          blocks: [
            {
              list: [
                "**Connect** to `" + ANCHOR_1 + "/app/<your-app-id>`. Pick an id once and keep it — see [Choosing an app id](doc:app-id).",
                "**Publish** events as usual. No AUTH is needed to write.",
                "**Subscribe** with a tag filter such as `{\"#t\": [\"my-game\"]}` or with `authors`. Filters without any scope are rejected — see [Subscriptions](doc:subscriptions).",
              ],
            },
            { p: "The [Quick start](doc:quick-start) puts these three steps into one working example." },
          ],
        },
        {
          id: "what-it-is-not",
          title: "What it is not",
          blocks: [
            {
              list: [
                "**Not a general-purpose relay for social clients.** Global feeds such as `{\"kinds\":[1]}` are rejected by design, and the root path `/` belongs to the Cinderous messenger itself.",
                "**Not long-term storage.** Everything expires; apps that are not on the known-tenant list keep data for only 2 hours unless they refresh it. See [Retention and storage](doc:retention).",
                "**Not private by default.** Anyone who can form your filter can read your lane's events. Encrypt content yourself if it matters.",
                "**No SLA.** The anchors run on a free tier shared with the Cinderous messenger.",
              ],
            },
          ],
        },
        {
          id: "help",
          title: "Resources and help",
          blocks: [
            {
              p: "If a connection is refused, the relay tells you why in a `NOTICE` and a close reason before closing — see [Error messages](doc:errors). Design background lives in the [resources](doc:resources) page, and questions go to [GitHub issues](repo:issues).",
            },
          ],
        },
      ],
    },

    "quick-start": {
      title: "Quick start",
      description:
        "A working example of connecting a JavaScript app to a Cinderous app lane with nostr-tools: open the lane, subscribe with a tag filter and publish an event, with no sign-up or AUTH.",
      lead: "Connect, subscribe and publish in about twenty lines. The example uses nostr-tools, but any NIP-01 client works.",
      sections: [
        {
          id: "example",
          title: "Example",
          blocks: [{ code: QUICK_START_CODE }],
        },
        {
          id: "what-happened",
          title: "What just happened",
          blocks: [
            {
              list: [
                "`/app/my-game` routed you into an app lane, not into the Cinderous messenger. The lane has its own storage.",
                "The relay sent an `AUTH` challenge on connect. You can ignore it; it only matters for `#p` subscriptions ([Authentication](doc:authentication)).",
                "Kind `1078` is a regular event, so it is stored for a while and new subscribers will see it. Kinds 20000–29999 are only relayed live ([Retention and storage](doc:retention)).",
              ],
            },
          ],
        },
        {
          id: "next-steps",
          title: "Next steps",
          blocks: [
            {
              list: [
                "Pick a stable app id: [Choosing an app id](doc:app-id).",
                "Check which filters are accepted: [Subscriptions](doc:subscriptions).",
                "Stay under the [rate limits](doc:limits) — exceeding the per-connection message limit closes the connection.",
              ],
            },
          ],
        },
      ],
    },

    "app-id": {
      title: "Choosing an app id",
      description:
        "How to choose the app id in wss://<relay>/app/<id> for the Cinderous relay: allowed characters, known tenants with their own storage and 30-day retention, and shared public lanes.",
      lead: "The app id is the last part of the lane URL. It decides where your data lives — it is a routing key, not a password.",
      sections: [
        {
          id: "format",
          title: "Format",
          blocks: [
            {
              list: [
                "1–64 characters of `a-z`, `0-9`, `.`, `_` and `-`.",
                "Must start with a letter or a digit.",
                "Upper-case letters are folded to lower case: `/app/MyGame` is the same lane as `/app/mygame`. The `/app/` prefix itself must be lower case.",
                "A trailing slash is fine. Anything else — spaces, extra path segments, an empty id — is refused with an `invalid app lane` notice.",
              ],
            },
          ],
        },
        {
          id: "known-and-public",
          title: "Known tenants and public lanes",
          blocks: [
            {
              p: "Every valid id is served. What changes is where the data is kept:",
            },
            {
              table: {
                head: ["", "Known tenant", "Public lane"],
                rows: [
                  ["Who", "Ids on the relay's tenant list", "Every other id"],
                  ["Storage", "Its own storage", "Shared with other apps (8 shared shards, chosen by a hash of the id)"],
                  ["Retention", "Regular events up to 7 days, addressable 30 days", "2 hours for both"],
                  ["Addresses per author and kind", "64", "16"],
                ],
              },
            },
            {
              p: "To be added to the list, open a [GitHub issue](repo:issues) describing the app. Joining or leaving the list moves the lane to different storage: data kept before the move stays behind until it expires.",
            },
          ],
        },
        {
          id: "not-a-secret",
          title: "It is not a secret",
          blocks: [
            {
              note: "Anyone can connect to any lane id, including yours. Lanes separate traffic and storage; they do not authenticate apps. Do not rely on an obscure id for privacy.",
            },
          ],
        },
      ],
    },

    endpoints: {
      title: "Endpoints and routing",
      description:
        "Which Cinderous relay URLs third-party apps can use: the two anchor relays, the /app/<id> lane path, and what happens on the root path, message shards and unknown paths.",
      lead: "Two anchor relays serve app lanes. The path decides which part of the relay you reach.",
      sections: [
        {
          id: "anchors",
          title: "Anchor relays",
          blocks: [
            { list: ["`" + ANCHOR_1 + "`", "`" + ANCHOR_2 + "`"] },
            {
              p: "They run the same code but are separate deployments with separate storage: an event published to one is not copied to the other. Connect to both if you want redundancy, and publish to both.",
            },
          ],
        },
        {
          id: "paths",
          title: "Paths",
          blocks: [
            {
              table: {
                head: ["Path", "What it is", "For third-party apps?"],
                rows: [
                  ["`/app/<id>`", "App lane", "Yes"],
                  ["`/`", "The Cinderous messenger (NIP-42 AUTH required, own-inbox subscriptions only)", "No"],
                  ["`/s/<0-f>`, `/presence`", "Cinderous message shards and presence", "No"],
                  ["Anything else", "Refused with a `NOTICE`, then closed", "—"],
                ],
              },
            },
          ],
        },
        {
          id: "http",
          title: "Plain HTTP requests",
          blocks: [
            {
              p: "Non-WebSocket requests always get `200`: `/healthz` returns `ok`, a request with `Accept: application/nostr+json` returns the [relay information document](doc:relay-info), and anything else returns a short text. A `200` therefore does not mean your path is right — open a WebSocket to check.",
            },
          ],
        },
        {
          id: "self-host",
          title: "Self-hosting",
          blocks: [
            {
              p: "The relay is open source and the Cloudflare version supports app lanes. If you need your own quota or longer retention, see the [self-hosting guide](view:selfhost). The Node.js version has no lanes and always applies the strict Cinderous rules.",
            },
          ],
        },
      ],
    },

    subscriptions: {
      title: "Subscriptions",
      description:
        "Which REQ filters the Cinderous relay accepts on app lanes: tag filters, authors, and #p for your own inbox after AUTH. Filters without scope are rejected, plus limits on subscriptions and results.",
      lead: "Every filter in a `REQ` must say what it is looking for. Filters that would stream the whole lane are rejected.",
      sections: [
        {
          id: "accepted",
          title: "Accepted and rejected filters",
          blocks: [
            {
              table: {
                head: ["Filter", "Result"],
                rows: [
                  ["`{\"kinds\":[1078], \"#t\":[\"lobby\"]}`", "Accepted — any tag except `#p`"],
                  ["`{\"kinds\":[31081], \"#d\":[\"deck\"]}`", "Accepted"],
                  ["`{\"authors\":[\"<pubkey>\"]}`", "Accepted (up to 1024 authors)"],
                  ["`{\"#p\":[\"<your pubkey>\"]}`", "Accepted **after** [AUTH](doc:authentication)"],
                  ["`{\"#p\":[\"<someone else>\"]}`", "Rejected, with or without AUTH"],
                  ["`{\"kinds\":[20000]}`, `{}`", "Rejected — no scope"],
                  ["`{\"#t\":[]}`", "Rejected — an empty tag list matches nothing"],
                ],
              },
            },
            {
              p: "A rejected subscription is answered with `[\"CLOSED\", <id>, \"restricted: …\"]`. If one filter in a `REQ` is rejected, the whole `REQ` is.",
            },
          ],
        },
        {
          id: "why",
          title: "Why the rules exist",
          blocks: [
            {
              p: "A filter without scope turns the relay into a firehose: it costs the most and tells a watcher everything happening in the lane. `#p` is limited to yourself because it reveals who is being contacted, when, and by whom.",
            },
          ],
        },
        {
          id: "limits",
          title: "Limits",
          blocks: [
            {
              list: [
                "At most 16 open subscriptions per connection; the 17th is closed with `rate-limited:`.",
                "At most 1024 stored events are returned per filter; a larger `limit` is reduced.",
                "Stored events are returned newest first, followed by `EOSE`; new matching events then arrive live.",
              ],
            },
          ],
        },
      ],
    },

    authentication: {
      title: "Authentication (NIP-42)",
      description:
        "Optional NIP-42 AUTH on Cinderous relay app lanes: publishing and tag subscriptions need no AUTH, while #p subscriptions to your own inbox require it. Includes the challenge flow and a code example.",
      lead: "AUTH is optional on app lanes. You need it only to subscribe with `#p` to your own public key.",
      sections: [
        {
          id: "when",
          title: "When you need it",
          blocks: [
            {
              table: {
                head: ["Action", "AUTH needed?"],
                rows: [
                  ["Publish any event", "No"],
                  ["Subscribe with tags or `authors`", "No"],
                  ["Subscribe with `#p` = your own pubkey", "Yes"],
                ],
              },
            },
          ],
        },
        {
          id: "flow",
          title: "How it works",
          blocks: [
            {
              list: [
                "On connect the relay sends `[\"AUTH\", <challenge>]`. Clients that do not use AUTH can ignore it.",
                "To authenticate, reply with a signed kind `22242` event carrying the `challenge` tag and a `relay` tag with this relay's URL ([NIP-42](" + NIP("42") + ")).",
                "The event must be less than 10 minutes old, and the `relay` tag must point at the host you connected to.",
                "Once accepted, events you publish on that connection are rate-limited under your authenticated key.",
              ],
            },
            { code: AUTH_CODE },
          ],
        },
      ],
    },

    retention: {
      title: "Retention and storage",
      description:
        "How long the Cinderous relay keeps app-lane events: ephemeral kinds are never stored, regular events up to 7 days, addressable events 30 days, and 2 hours on public lanes, plus storage quotas.",
      lead: "Nothing on an app lane is kept forever. How long an event lives depends on its kind and on whether your lane is a known tenant.",
      sections: [
        {
          id: "by-kind",
          title: "How long events live",
          blocks: [
            {
              table: {
                head: ["Kind", "Known tenant", "Public lane"],
                rows: [
                  ["Ephemeral (20000–29999)", "Relayed live, never stored", "Relayed live, never stored"],
                  ["Regular", "Up to 7 days", "2 hours"],
                  ["Replaceable / addressable (0, 3, 10000–19999, 30000–39999)", "30 days", "2 hours"],
                ],
              },
            },
            {
              p: "Replaceable and addressable events are refreshed every time you publish a newer version, so data you keep updating stays. A shorter [NIP-40](" + NIP("40") + ") `expiration` tag is honoured; a longer one is capped.",
            },
            {
              note: "On a public lane, an event that is published once and never updated disappears after 2 hours. The current value is always in the relay information document (`cinder_addressable_ttl_sec`, `retention`).",
            },
          ],
        },
        {
          id: "quotas",
          title: "Quotas",
          blocks: [
            {
              table: {
                head: ["Quota", "Known tenant", "Public lane"],
                rows: [
                  ["Addresses per author and kind", "64", "16"],
                  ["Size of one addressable event", "32 KB", "32 KB"],
                  ["Addressable data per author (all kinds)", "8 MB", "2 MB"],
                  ["Stored events per `#p` recipient", "500 (oldest dropped)", "500 (oldest dropped)"],
                ],
              },
            },
            {
              p: "Each lane storage also has a total ceiling of 128 MB for addressable events and 128 MB for other stored events. When a ceiling is reached, the events closest to expiry are removed first.",
            },
          ],
        },
        {
          id: "kind-30078",
          title: "Avoid kind 30078",
          blocks: [
            {
              p: "Kind `30078` is used by Cinderous for encrypted backups and is handled specially on the messenger side. Pick another addressable kind for your app.",
            },
          ],
        },
      ],
    },

    limits: {
      title: "Rate limits",
      description:
        "Rate limits on Cinderous relay app lanes: new connections per IP, messages per connection, events per key, clock skew and event size limits, and what the relay returns when you exceed them.",
      lead: "The limits are set far above normal use. Hitting one usually means a reconnect loop or a subscription that is opened and closed too often.",
      sections: [
        {
          id: "table",
          title: "Limits",
          blocks: [
            {
              table: {
                head: ["Limit", "Value", "When exceeded"],
                rows: [
                  ["New lane connections per IP", "30 per minute", "`NOTICE` `rate-limited: …`, then closed (1008)"],
                  ["Messages per connection (any type)", "240 per minute", "`NOTICE` `rate-limited: …`, then closed (1008)"],
                  ["Events per key", "120 per minute", "`OK false` `rate-limited: …`"],
                  ["Open subscriptions per connection", "16", "`CLOSED` `rate-limited: …`"],
                ],
              },
            },
            {
              p: "Messages include `REQ` and `CLOSE`. A client that re-opens its subscriptions every few seconds reaches the message limit long before the event limit.",
            },
          ],
        },
        {
          id: "event-rules",
          title: "Event rules",
          blocks: [
            {
              list: [
                "`created_at` must be no more than 15 minutes in the future and no more than 2 days and 1 hour in the past.",
                "The same event id is refused as `duplicate:` within one hour.",
                "At most 128 tags, of which at most 16 `p` tags.",
                "At most 256 KB per event (32 KB for addressable events on lanes); at most 384 KB per WebSocket message.",
              ],
            },
          ],
        },
      ],
    },

    "proof-of-work": {
      title: "Proof of work",
      description:
        "NIP-13 proof of work on Cinderous relay app lanes: currently not required, how it would be enabled, which events it applies to, and how to prepare your client for it.",
      lead: "Proof of work is currently **not required** on the anchor relays.",
      sections: [
        {
          id: "status",
          title: "Status",
          blocks: [
            {
              p: "The relay can require [NIP-13](" + NIP("13") + ") proof of work on app lanes. The difficulty is 0 today because existing clients do not mine. If it is turned on, it will be announced in the [resources](doc:resources) page first.",
            },
          ],
        },
        {
          id: "scope",
          title: "What it applies to",
          blocks: [
            {
              list: [
                "Only stored events. Ephemeral events (20000–29999) are never checked.",
                "Only app lanes. The Cinderous messenger never requires it.",
                "A rejected event gets `OK false` with a reason starting with `pow:`.",
              ],
            },
          ],
        },
        {
          id: "prepare",
          title: "Preparing for it",
          blocks: [
            {
              p: "Supporting NIP-13 mining now costs little and makes the switch invisible to your users. nostr-tools ships `nip13`; the Cinderous core package has `minePow` with an iteration cap.",
            },
          ],
        },
      ],
    },

    "relay-info": {
      title: "Relay information (NIP-11)",
      description:
        "Read the Cinderous relay's NIP-11 document for your app lane: auth requirement, subscription scope, retention, addressable event lifetime, clock skew window and rate limits.",
      lead: "Ask the relay for its current rules instead of hard-coding them. The document is specific to the path you ask for.",
      sections: [
        {
          id: "request",
          title: "Request",
          blocks: [{ code: NIP11_CODE }],
        },
        {
          id: "fields",
          title: "Fields that matter for app lanes",
          blocks: [
            {
              table: {
                head: ["Field", "Meaning"],
                rows: [
                  ["`limitation.auth_required`", "`false` on app lanes"],
                  ["`cinder_subscription_scope`", "`tagged` on app lanes: tag filters are accepted"],
                  ["`retention[0].time`", "Lifetime of regular events, in seconds"],
                  ["`cinder_addressable_ttl_sec`", "Lifetime of replaceable and addressable events, in seconds"],
                  ["`cinder_max_past_skew_sec`, `cinder_max_future_skew_sec`", "Accepted `created_at` window"],
                  ["`cinder_max_events_per_minute`", "Events per key per minute"],
                  ["`limitation.max_subscriptions`, `limitation.max_limit`", "Subscriptions per connection, results per filter"],
                  ["`version`", "Relay software version"],
                ],
              },
            },
            {
              note: "`limitation.max_message_length` reports the general 256 KB limit. Addressable events on app lanes are limited to 32 KB.",
            },
          ],
        },
      ],
    },

    errors: {
      title: "Error messages",
      description:
        "Every error the Cinderous relay returns to third-party apps: refused connections with a NOTICE and close reason, CLOSED subscriptions and OK false event rejections, with the fix for each.",
      lead: "Match on the prefix before the colon. The text after it is a human-readable explanation and may change.",
      sections: [
        {
          id: "connection",
          title: "Refused connections",
          blocks: [
            {
              p: "The relay accepts the WebSocket, sends one `NOTICE`, and closes with code `1008`. The close reason also carries the documentation link, because browsers do not expose the HTTP status of a failed handshake.",
            },
            {
              table: {
                head: ["NOTICE starts with", "Cause", "Fix"],
                rows: [
                  ["`unknown relay path`", "The path is not `/app/<id>` or a Cinderous path", "Connect to `wss://<relay>/app/<your-app-id>`"],
                  ["`invalid app lane`", "The id breaks the [format](doc:app-id)", "Use 1–64 characters of `a-z 0-9 . _ -`"],
                  ["`rate-limited: too many new connections`", "More than 30 new lane connections per minute from your IP", "Back off before reconnecting"],
                  ["`rate-limited:` (during a session)", "More than 240 messages per minute on one connection", "Stop re-opening subscriptions in a loop"],
                ],
              },
            },
          ],
        },
        {
          id: "subscriptions",
          title: "Subscriptions (CLOSED)",
          blocks: [
            {
              table: {
                head: ["Prefix", "Cause"],
                rows: [
                  ["`restricted:`", "A filter has no scope, or uses `#p` for someone else, or uses `#p` without AUTH — see [Subscriptions](doc:subscriptions)"],
                  ["`rate-limited:`", "More than 16 open subscriptions on the connection"],
                ],
              },
            },
          ],
        },
        {
          id: "events",
          title: "Events (OK false)",
          blocks: [
            {
              table: {
                head: ["Prefix", "Cause"],
                rows: [
                  ["`invalid:`", "Bad signature, or `created_at` outside the accepted window"],
                  ["`duplicate:`", "The same event id was already received within the last hour"],
                  ["`blocked:`", "Too many tags, too many `p` tags, too large, or an addressable event refused by a quota"],
                  ["`rate-limited:`", "More than 120 events per minute for this key"],
                  ["`pow:`", "Not enough proof of work (only if it is enabled)"],
                  ["`auth-failed:`", "The AUTH event was invalid, expired, or named a different relay"],
                ],
              },
            },
          ],
        },
      ],
    },

    faq: {
      title: "FAQ",
      description:
        "Frequently asked questions about building on the Cinderous relay: cost, use from social Nostr clients, privacy of lane data, disappearing events, redundancy and self-hosting.",
      lead: "Short answers to the questions third-party developers ask most.",
      sections: [
        {
          id: "cost",
          title: "Does it cost anything?",
          blocks: [{ p: "No. There is no payment and no sign-up. The anchors run on a free tier that is shared with the Cinderous messenger, which is why the limits exist." }],
        },
        {
          id: "social-clients",
          title: "Can I add it to Damus, Primal or another social client?",
          blocks: [{ p: "It will not work well. Social clients connect to the root path and ask for global feeds; both are refused. App lanes are for apps written against them." }],
        },
        {
          id: "privacy",
          title: "Can other people read my lane?",
          blocks: [{ p: "Yes, if they know a filter that matches your events. Lanes separate storage; they are not access control. Encrypt anything private, for example with [NIP-44](" + NIP("44") + ")." }],
        },
        {
          id: "disappeared",
          title: "Why did my events disappear?",
          blocks: [{ p: "Most likely your lane is a public lane, where stored events live for 2 hours unless updated. See [Retention and storage](doc:retention) and [Choosing an app id](doc:app-id)." }],
        },
        {
          id: "can-cinderous-see",
          title: "Can my app read Cinderous messages?",
          blocks: [{ p: "No. App lanes use separate storage that never contains Cinderous messenger events." }],
        },
        {
          id: "own-relay",
          title: "Can I run my own?",
          blocks: [{ p: "Yes — see the [self-hosting guide](view:selfhost). Your own deployment has its own quota." }],
        },
      ],
    },

    resources: {
      title: "Resources",
      description:
        "Design records, specifications and support links for developers building on the Cinderous relay: architecture decisions on app lanes, retention and errors, the game protocol spec and NIPs.",
      lead: "The reasoning behind each rule is written down. Start here if a rule surprises you.",
      sections: [
        {
          id: "decisions",
          title: "Design decisions",
          blocks: [
            {
              list: [
                "[ADR-0366: third-party app lanes](repo:docs/adr/0366-third-party-app-lane.md)",
                "[ADR-0367: probation retention and storage ceilings](repo:docs/adr/0367-probation-retention-and-do-ceiling.md)",
                "[ADR-0368: refused connections point to these docs](repo:docs/adr/0368-rejection-points-to-developer-docs.md)",
                "[ADR-0369: subscription scope and optional AUTH on lanes](repo:docs/adr/0369-lane-scope-check-and-optional-auth.md)",
                "[Game-layer protocol spec](repo:docs/research/game-layer-spec.md)",
              ],
            },
          ],
        },
        {
          id: "nips",
          title: "Nostr specifications",
          blocks: [
            {
              list: [
                "[NIP-01: basic protocol](" + NIP("01") + ")",
                "[NIP-11: relay information](" + NIP("11") + ")",
                "[NIP-13: proof of work](" + NIP("13") + ")",
                "[NIP-40: expiration](" + NIP("40") + ")",
                "[NIP-42: authentication](" + NIP("42") + ")",
              ],
            },
          ],
        },
        {
          id: "support",
          title: "Support",
          blocks: [
            {
              p: "Report problems or ask to be added to the known-tenant list through [GitHub issues](repo:issues). Changes to these rules are recorded as new design decisions in the repository.",
            },
          ],
        },
      ],
    },
  },
};

const zhHant: DevDocs = {
  navTitle: "開發者文件",
  overviewLabel: "總覽",
  sectionTitles: {
    start: "快速開始",
    reference: "中繼規則參考",
    help: "說明與資源",
  },
  tocLabel: "本頁內容",
  prevLabel: "上一頁",
  nextLabel: "下一頁",
  pages: {
    overview: {
      title: "在 Cinderous 中繼上開發",
      description:
        "給第三方應用的 Cinderous Nostr 中繼開發者文件：連到 /app/<id> 車道、免註冊發布與訂閱，以及保存期、速率限制與錯誤訊息的完整說明。",
      lead:
        "Cinderous 的錨點中繼透過「車道」對第三方 Nostr 應用開放：車道是中繼裡一塊獨立的區域，有自己的儲存與規則，網址是 `/app/<你的應用 id>`。不需要註冊、不需要 API 金鑰，也不收費。",
      sections: [
        {
          id: "what-you-can-build",
          title: "可以拿來做什麼",
          blocks: [
            { p: "車道是為「需要一個小而快的共用集合點」的應用設計的，不是永久存放區：" },
            {
              list: [
                "大廳與在線狀態——現在誰在線上（ephemeral 事件，從不儲存）。",
                "信令——寄給特定玩家的邀請與 WebRTC 連線資訊。",
                "非同步的共享世界——許多玩家一起追加的動作日誌。",
                "公開的遊戲資料——以可尋址事件發布的牌組、配裝與世界快照。",
              ],
            },
          ],
        },
        {
          id: "how-to-use",
          title: "怎麼使用",
          blocks: [
            {
              list: [
                "**連線**到 `" + ANCHOR_1 + "/app/<你的應用 id>`。id 選定後就固定使用——見[選擇應用 id](doc:app-id)。",
                "**發布**事件的方式和一般 Nostr 相同，寫入不需要 AUTH。",
                "**訂閱**時要帶標籤 filter（例如 `{\"#t\": [\"my-game\"]}`）或 `authors`。沒有指定範圍的 filter 會被拒絕——見[訂閱](doc:subscriptions)。",
              ],
            },
            { p: "[快速上手](doc:quick-start)把這三步寫成一個可以直接執行的範例。" },
          ],
        },
        {
          id: "what-it-is-not",
          title: "它不是什麼",
          blocks: [
            {
              list: [
                "**不是給社群客戶端用的通用中繼。** `{\"kinds\":[1]}` 這類全站動態在設計上就會被拒絕，根路徑 `/` 則屬於 Cinderous 通訊軟體本身。",
                "**不是長期存放區。** 所有資料都會過期；不在已知租戶名單上的應用，資料若不更新只保存 2 小時。見[保存期與儲存](doc:retention)。",
                "**預設不是私密的。** 任何能組出你的 filter 的人都讀得到你車道上的事件。重要內容請自行加密。",
                "**沒有服務等級保證。** 錨點跑在與 Cinderous 通訊軟體共用的免費額度上。",
              ],
            },
          ],
        },
        {
          id: "help",
          title: "資源與協助",
          blocks: [
            {
              p: "連線被拒時，中繼會在關線前用 `NOTICE` 與關閉原因告訴你為什麼——見[錯誤訊息](doc:errors)。設計背景整理在[資源](doc:resources)頁，問題請到 [GitHub issues](repo:issues)。",
            },
          ],
        },
      ],
    },

    "quick-start": {
      title: "快速上手",
      description:
        "用 nostr-tools 把 JavaScript 應用接到 Cinderous 車道的完整範例：開啟車道、以標籤 filter 訂閱、發布事件，全程不需要註冊或 AUTH。",
      lead: "大約二十行就能完成連線、訂閱與發布。範例用 nostr-tools，但任何符合 NIP-01 的客戶端都可以。",
      sections: [
        { id: "example", title: "範例", blocks: [{ code: QUICK_START_CODE }] },
        {
          id: "what-happened",
          title: "剛才發生了什麼",
          blocks: [
            {
              list: [
                "`/app/my-game` 把你導進車道，而不是 Cinderous 通訊軟體；車道有自己的儲存。",
                "中繼在連線時送出一則 `AUTH` 挑戰。你可以忽略它，只有 `#p` 訂閱才需要（見[認證](doc:authentication)）。",
                "kind `1078` 是一般事件，會保存一段時間，之後的訂閱者也看得到。kind 20000–29999 只即時轉發（見[保存期與儲存](doc:retention)）。",
              ],
            },
          ],
        },
        {
          id: "next-steps",
          title: "下一步",
          blocks: [
            {
              list: [
                "選一個固定的 id：[選擇應用 id](doc:app-id)。",
                "確認哪些 filter 會被接受：[訂閱](doc:subscriptions)。",
                "不要超過[速率限制](doc:limits)——超過每連線訊息上限會被關線。",
              ],
            },
          ],
        },
      ],
    },

    "app-id": {
      title: "選擇應用 id",
      description:
        "如何選擇 Cinderous 中繼 wss://<relay>/app/<id> 裡的應用 id：允許的字元、有獨立儲存與 30 天保存期的已知租戶，以及共用的公用車道。",
      lead: "應用 id 是車道網址的最後一段，決定你的資料放在哪裡——它是路由用的鍵，不是密碼。",
      sections: [
        {
          id: "format",
          title: "格式",
          blocks: [
            {
              list: [
                "1–64 個字元，只能是 `a-z`、`0-9`、`.`、`_`、`-`。",
                "必須以英文字母或數字開頭。",
                "大寫會轉成小寫（`/app/MyGame` 等同 `/app/mygame`）；但 `/app/` 前綴本身必須是小寫。",
                "結尾多一個斜線沒關係。其他情況——空白、多一層路徑、空的 id——都會收到 `invalid app lane` 並被拒絕。",
              ],
            },
          ],
        },
        {
          id: "known-and-public",
          title: "已知租戶與公用車道",
          blocks: [
            { p: "每個合法的 id 都會被服務，差別在資料放在哪裡：" },
            {
              table: {
                head: ["", "已知租戶", "公用車道"],
                rows: [
                  ["誰", "列在中繼租戶名單上的 id", "其他所有 id"],
                  ["儲存", "獨立的儲存", "和其他應用共用（依 id 雜湊分到 8 個共用分片之一）"],
                  ["保存期", "一般事件最多 7 天，可尋址事件 30 天", "兩者都是 2 小時"],
                  ["每位作者每個 kind 的位址數", "64", "16"],
                ],
              },
            },
            {
              p: "想加入名單，請開一則 [GitHub issue](repo:issues) 說明你的應用。加入或移出名單會讓車道換到另一塊儲存：換之前存下的資料會留在原處，直到過期。",
            },
          ],
        },
        {
          id: "not-a-secret",
          title: "它不是秘密",
          blocks: [
            { note: "任何人都能連到任何 id 的車道，包括你的。車道分開的是流量與儲存，不會驗證應用身分。不要靠一個冷門的 id 來保護隱私。" },
          ],
        },
      ],
    },

    endpoints: {
      title: "端點與路由",
      description:
        "第三方應用可以使用哪些 Cinderous 中繼網址：兩座錨點中繼、/app/<id> 車道路徑，以及根路徑、訊息分片與未知路徑各自會發生什麼事。",
      lead: "兩座錨點中繼都提供車道。路徑決定你連到中繼的哪一個部分。",
      sections: [
        {
          id: "anchors",
          title: "錨點中繼",
          blocks: [
            { list: ["`" + ANCHOR_1 + "`", "`" + ANCHOR_2 + "`"] },
            { p: "兩座跑同一份程式，但部署與儲存各自獨立：發到其中一座的事件不會被複製到另一座。需要備援就兩座都連、兩座都發。" },
          ],
        },
        {
          id: "paths",
          title: "路徑",
          blocks: [
            {
              table: {
                head: ["路徑", "用途", "第三方可用？"],
                rows: [
                  ["`/app/<id>`", "車道", "可以"],
                  ["`/`", "Cinderous 通訊軟體（必須 NIP-42 AUTH，只能訂閱自己的收件匣）", "不行"],
                  ["`/s/<0-f>`、`/presence`", "Cinderous 訊息分片與在線狀態", "不行"],
                  ["其他路徑", "送一則 `NOTICE` 後關線", "—"],
                ],
              },
            },
          ],
        },
        {
          id: "http",
          title: "一般 HTTP 請求",
          blocks: [
            {
              p: "不是 WebSocket 的請求一律回 `200`：`/healthz` 回 `ok`，帶 `Accept: application/nostr+json` 的請求回[中繼資訊文件](doc:relay-info)，其他回一小段文字。所以 `200` 不代表路徑正確——要開 WebSocket 才確認得了。",
            },
          ],
        },
        {
          id: "self-host",
          title: "自架",
          blocks: [
            {
              p: "中繼是開源的，Cloudflare 版支援車道。需要自己的額度或更長的保存期，請看[自架教學](view:selfhost)。Node.js 版沒有車道，一律套用 Cinderous 的嚴格規則。",
            },
          ],
        },
      ],
    },

    subscriptions: {
      title: "訂閱",
      description:
        "Cinderous 中繼車道接受哪些 REQ filter：標籤 filter、authors，以及 AUTH 後查自己收件匣的 #p。沒有指定範圍的 filter 會被拒絕，另有訂閱數與結果筆數上限。",
      lead: "`REQ` 裡的每個 filter 都必須說清楚要找什麼。會把整條車道倒出來的 filter 一律拒絕。",
      sections: [
        {
          id: "accepted",
          title: "接受與拒絕的 filter",
          blocks: [
            {
              table: {
                head: ["Filter", "結果"],
                rows: [
                  ["`{\"kinds\":[1078], \"#t\":[\"lobby\"]}`", "接受——`#p` 以外的任何標籤都可以"],
                  ["`{\"kinds\":[31081], \"#d\":[\"deck\"]}`", "接受"],
                  ["`{\"authors\":[\"<pubkey>\"]}`", "接受（最多 1024 位作者）"],
                  ["`{\"#p\":[\"<你的 pubkey>\"]}`", "[AUTH](doc:authentication) **之後**接受"],
                  ["`{\"#p\":[\"<別人>\"]}`", "拒絕，有沒有 AUTH 都一樣"],
                  ["`{\"kinds\":[20000]}`、`{}`", "拒絕——沒有指定範圍"],
                  ["`{\"#t\":[]}`", "拒絕——空的標籤清單什麼都比對不到"],
                ],
              },
            },
            { p: "被拒的訂閱會收到 `[\"CLOSED\", <id>, \"restricted: …\"]`。一個 `REQ` 裡只要有一個 filter 被拒，整個 `REQ` 都會被拒。" },
          ],
        },
        {
          id: "why",
          title: "為什麼有這些規則",
          blocks: [
            {
              p: "沒有範圍的 filter 會讓中繼變成消防水管：成本最高，也讓旁觀者看到車道上發生的一切。`#p` 只能查自己，是因為它會洩漏「誰在什麼時候被誰聯絡」。",
            },
          ],
        },
        {
          id: "limits",
          title: "上限",
          blocks: [
            {
              list: [
                "每條連線最多同時 16 個訂閱；第 17 個會以 `rate-limited:` 關閉。",
                "每個 filter 最多回傳 1024 筆已存事件；更大的 `limit` 會被夾到這個值。",
                "已存事件由新到舊回傳，接著是 `EOSE`；之後符合的新事件會即時送達。",
              ],
            },
          ],
        },
      ],
    },

    authentication: {
      title: "認證（NIP-42）",
      description:
        "Cinderous 中繼車道上可選的 NIP-42 AUTH：發布與標籤訂閱都不需要 AUTH，用 #p 查自己的收件匣才需要。包含挑戰流程與程式範例。",
      lead: "車道上的 AUTH 是可選的，只有要用 `#p` 訂閱自己的公鑰時才需要。",
      sections: [
        {
          id: "when",
          title: "什麼時候需要",
          blocks: [
            {
              table: {
                head: ["動作", "需要 AUTH？"],
                rows: [
                  ["發布任何事件", "不需要"],
                  ["用標籤或 `authors` 訂閱", "不需要"],
                  ["用 `#p` = 自己的 pubkey 訂閱", "需要"],
                ],
              },
            },
          ],
        },
        {
          id: "flow",
          title: "運作方式",
          blocks: [
            {
              list: [
                "連線時中繼會送出 `[\"AUTH\", <challenge>]`，不使用 AUTH 的客戶端可以忽略。",
                "要認證的話，回傳一則簽過名的 kind `22242` 事件，帶 `challenge` 標籤，以及指向本中繼網址的 `relay` 標籤（[NIP-42](" + NIP("42") + ")）。",
                "該事件必須是 10 分鐘內產生的，`relay` 標籤必須指向你連線的那個主機。",
                "認證成功後，這條連線上發布的事件改以你認證的金鑰計算速率。",
              ],
            },
            { code: AUTH_CODE },
          ],
        },
      ],
    },

    retention: {
      title: "保存期與儲存",
      description:
        "Cinderous 中繼車道上的事件會保存多久：ephemeral kind 從不儲存，一般事件最多 7 天，可尋址事件 30 天，公用車道一律 2 小時，另有各項儲存配額。",
      lead: "車道上沒有任何東西會永久保存。事件能留多久，取決於它的 kind，以及你的車道是不是已知租戶。",
      sections: [
        {
          id: "by-kind",
          title: "事件保存多久",
          blocks: [
            {
              table: {
                head: ["Kind", "已知租戶", "公用車道"],
                rows: [
                  ["Ephemeral（20000–29999）", "即時轉發，從不儲存", "即時轉發，從不儲存"],
                  ["一般事件", "最多 7 天", "2 小時"],
                  ["可取代／可尋址（0、3、10000–19999、30000–39999）", "30 天", "2 小時"],
                ],
              },
            },
            {
              p: "可取代與可尋址事件每發布一次更新的版本，到期時間就重新計算，所以持續更新的資料會一直留著。較短的 [NIP-40](" + NIP("40") + ") `expiration` 標籤會被採用，較長的會被夾到上限。",
            },
            {
              note: "在公用車道上，發布一次之後就不再更新的事件會在 2 小時後消失。目前的實際值永遠寫在中繼資訊文件裡（`cinder_addressable_ttl_sec`、`retention`）。",
            },
          ],
        },
        {
          id: "quotas",
          title: "配額",
          blocks: [
            {
              table: {
                head: ["配額", "已知租戶", "公用車道"],
                rows: [
                  ["每位作者每個 kind 的位址數", "64", "16"],
                  ["單一可尋址事件大小", "32 KB", "32 KB"],
                  ["每位作者的可尋址資料總量（所有 kind）", "8 MB", "2 MB"],
                  ["每位 `#p` 收件人保存的事件數", "500（最舊的先丟）", "500（最舊的先丟）"],
                ],
              },
            },
            {
              p: "每塊車道儲存另外有總量上限：可尋址事件 128 MB、其他已存事件 128 MB。到達上限時，最快到期的事件會先被移除。",
            },
          ],
        },
        {
          id: "kind-30078",
          title: "避開 kind 30078",
          blocks: [
            { p: "kind `30078` 是 Cinderous 用來存加密備份的，在通訊軟體那一側有特殊處理。請為你的應用選另一個可尋址 kind。" },
          ],
        },
      ],
    },

    limits: {
      title: "速率限制",
      description:
        "Cinderous 中繼車道的速率限制：每個 IP 的新連線數、每條連線的訊息數、每把金鑰的事件數、時間戳容許範圍與事件大小，以及超過時中繼會回什麼。",
      lead: "這些上限都遠高於正常用量。會撞到通常代表重連迴圈，或是訂閱開了又關得太頻繁。",
      sections: [
        {
          id: "table",
          title: "上限",
          blocks: [
            {
              table: {
                head: ["項目", "數值", "超過時"],
                rows: [
                  ["每個 IP 的新車道連線", "每分鐘 30 次", "`NOTICE` `rate-limited: …` 後關線（1008）"],
                  ["每條連線的訊息（任何類型）", "每分鐘 240 則", "`NOTICE` `rate-limited: …` 後關線（1008）"],
                  ["每把金鑰的事件", "每分鐘 120 則", "`OK false` `rate-limited: …`"],
                  ["每條連線同時開著的訂閱", "16 個", "`CLOSED` `rate-limited: …`"],
                ],
              },
            },
            { p: "訊息包含 `REQ` 與 `CLOSE`。每隔幾秒就重開訂閱的客戶端，會遠在撞到事件上限之前先撞到訊息上限。" },
          ],
        },
        {
          id: "event-rules",
          title: "事件規則",
          blocks: [
            {
              list: [
                "`created_at` 不能比現在晚超過 15 分鐘，也不能早超過 2 天又 1 小時。",
                "同一個事件 id 在一小時內重送會以 `duplicate:` 拒絕。",
                "最多 128 個標籤，其中 `p` 標籤最多 16 個。",
                "每則事件最多 256 KB（車道上的可尋址事件 32 KB）；每則 WebSocket 訊息最多 384 KB。",
              ],
            },
          ],
        },
      ],
    },

    "proof-of-work": {
      title: "工作量證明",
      description:
        "Cinderous 中繼車道上的 NIP-13 工作量證明：目前不要求、日後會如何開啟、適用於哪些事件，以及怎麼先讓你的客戶端準備好。",
      lead: "錨點中繼目前**不要求**工作量證明。",
      sections: [
        {
          id: "status",
          title: "現況",
          blocks: [
            {
              p: "中繼可以在車道上要求 [NIP-13](" + NIP("13") + ") 工作量證明。目前難度是 0，因為現有的客戶端都不會挖礦。如果要開啟，會先在[資源](doc:resources)頁公告。",
            },
          ],
        },
        {
          id: "scope",
          title: "適用範圍",
          blocks: [
            {
              list: [
                "只檢查會被儲存的事件，ephemeral 事件（20000–29999）永遠不檢查。",
                "只在車道上，Cinderous 通訊軟體永遠不要求。",
                "被拒的事件會收到 `OK false`，原因以 `pow:` 開頭。",
              ],
            },
          ],
        },
        {
          id: "prepare",
          title: "先做好準備",
          blocks: [
            { p: "現在就支援 NIP-13 挖礦成本很低，日後切換時你的使用者不會察覺。nostr-tools 內建 `nip13`；Cinderous 的 core 套件有帶迭代上限的 `minePow`。" },
          ],
        },
      ],
    },

    "relay-info": {
      title: "中繼資訊（NIP-11）",
      description:
        "讀取 Cinderous 中繼針對你的車道所回傳的 NIP-11 文件：是否要求認證、訂閱範圍、保存期、可尋址事件壽命、時間戳容許範圍與速率限制。",
      lead: "直接向中繼查詢目前的規則，不要寫死在程式裡。文件內容會依你查詢的路徑而不同。",
      sections: [
        { id: "request", title: "查詢方式", blocks: [{ code: NIP11_CODE }] },
        {
          id: "fields",
          title: "和車道相關的欄位",
          blocks: [
            {
              table: {
                head: ["欄位", "意義"],
                rows: [
                  ["`limitation.auth_required`", "車道上為 `false`"],
                  ["`cinder_subscription_scope`", "車道上為 `tagged`：接受標籤 filter"],
                  ["`retention[0].time`", "一般事件的壽命（秒）"],
                  ["`cinder_addressable_ttl_sec`", "可取代與可尋址事件的壽命（秒）"],
                  ["`cinder_max_past_skew_sec`、`cinder_max_future_skew_sec`", "`created_at` 的容許範圍"],
                  ["`cinder_max_events_per_minute`", "每把金鑰每分鐘的事件數"],
                  ["`limitation.max_subscriptions`、`limitation.max_limit`", "每條連線的訂閱數、每個 filter 的結果筆數"],
                  ["`version`", "中繼軟體版本"],
                ],
              },
            },
            { note: "`limitation.max_message_length` 回報的是一般的 256 KB 上限；車道上的可尋址事件實際上限是 32 KB。" },
          ],
        },
      ],
    },

    errors: {
      title: "錯誤訊息",
      description:
        "Cinderous 中繼回給第三方應用的所有錯誤：以 NOTICE 與關閉原因說明的拒絕連線、CLOSED 訂閱、OK false 拒收事件，以及各自的修正方式。",
      lead: "請比對冒號前的前綴。冒號後是給人看的說明，內容可能會改。",
      sections: [
        {
          id: "connection",
          title: "連線被拒",
          blocks: [
            {
              p: "中繼會先接受 WebSocket、送一則 `NOTICE`，再以代碼 `1008` 關線。關閉原因也附上文件連結，因為瀏覽器看不到握手失敗時的 HTTP 狀態。",
            },
            {
              table: {
                head: ["NOTICE 開頭", "原因", "修正方式"],
                rows: [
                  ["`unknown relay path`", "路徑不是 `/app/<id>`，也不是 Cinderous 的路徑", "連到 `wss://<relay>/app/<你的應用 id>`"],
                  ["`invalid app lane`", "id 不符合[格式](doc:app-id)", "改用 1–64 個 `a-z 0-9 . _ -` 字元"],
                  ["`rate-limited: too many new connections`", "同一個 IP 每分鐘開超過 30 條車道連線", "重連前先等一下"],
                  ["`rate-limited:`（連線中）", "單一連線每分鐘超過 240 則訊息", "不要在迴圈裡反覆重開訂閱"],
                ],
              },
            },
          ],
        },
        {
          id: "subscriptions",
          title: "訂閱（CLOSED）",
          blocks: [
            {
              table: {
                head: ["前綴", "原因"],
                rows: [
                  ["`restricted:`", "filter 沒有指定範圍、`#p` 指向別人，或沒 AUTH 就用 `#p`——見[訂閱](doc:subscriptions)"],
                  ["`rate-limited:`", "這條連線同時開著的訂閱超過 16 個"],
                ],
              },
            },
          ],
        },
        {
          id: "events",
          title: "事件（OK false）",
          blocks: [
            {
              table: {
                head: ["前綴", "原因"],
                rows: [
                  ["`invalid:`", "簽章錯誤，或 `created_at` 超出容許範圍"],
                  ["`duplicate:`", "同一個事件 id 在一小時內已經收過"],
                  ["`blocked:`", "標籤太多、`p` 標籤太多、事件太大，或可尋址事件超過配額"],
                  ["`rate-limited:`", "這把金鑰每分鐘超過 120 則事件"],
                  ["`pow:`", "工作量證明不足（只在開啟時出現）"],
                  ["`auth-failed:`", "AUTH 事件無效、過期，或指向別的中繼"],
                ],
              },
            },
            { note: "冒號後的說明文字目前可能是中文。請以前綴判斷。" },
          ],
        },
      ],
    },

    faq: {
      title: "常見問題",
      description:
        "在 Cinderous 中繼上開發的常見問題：要不要錢、能不能給社群 Nostr 客戶端用、車道資料的隱私、事件為什麼消失、備援與自架。",
      lead: "第三方開發者最常問的幾個問題。",
      sections: [
        { id: "cost", title: "要付費嗎？", blocks: [{ p: "不用。不收費、不用註冊。錨點跑在與 Cinderous 通訊軟體共用的免費額度上，這也是為什麼會有各項上限。" }] },
        {
          id: "social-clients",
          title: "可以加到 Damus、Primal 之類的社群客戶端嗎？",
          blocks: [{ p: "效果不會好。社群客戶端連的是根路徑、要的是全站動態，兩者都會被拒絕。車道是給針對它開發的應用用的。" }],
        },
        {
          id: "privacy",
          title: "別人讀得到我的車道嗎？",
          blocks: [{ p: "讀得到，只要他知道一個能比對到你事件的 filter。車道分開的是儲存，不是存取控制。私密內容請自行加密，例如使用 [NIP-44](" + NIP("44") + ")。" }],
        },
        {
          id: "disappeared",
          title: "我的事件為什麼不見了？",
          blocks: [{ p: "最可能的原因是你的車道是公用車道：已存事件若不更新只留 2 小時。見[保存期與儲存](doc:retention)與[選擇應用 id](doc:app-id)。" }],
        },
        {
          id: "can-cinderous-see",
          title: "我的應用讀得到 Cinderous 的訊息嗎？",
          blocks: [{ p: "讀不到。車道用的是另外的儲存，裡面從來沒有 Cinderous 通訊軟體的事件。" }],
        },
        { id: "own-relay", title: "可以自己架一座嗎？", blocks: [{ p: "可以——見[自架教學](view:selfhost)。自己的部署有自己的額度。" }] },
      ],
    },

    resources: {
      title: "資源",
      description:
        "在 Cinderous 中繼上開發的參考資料：車道、保存期與錯誤訊息的架構決策紀錄、遊戲層協定規格、相關 NIP，以及回報問題的管道。",
      lead: "每條規則背後的理由都有文字紀錄。如果某條規則讓你意外，從這裡開始看。",
      sections: [
        {
          id: "decisions",
          title: "設計決策",
          blocks: [
            {
              list: [
                "[ADR-0366：第三方應用車道](repo:docs/adr/0366-third-party-app-lane.md)",
                "[ADR-0367：見習保存與容量天花板](repo:docs/adr/0367-probation-retention-and-do-ceiling.md)",
                "[ADR-0368：拒絕連線時指向本文件](repo:docs/adr/0368-rejection-points-to-developer-docs.md)",
                "[ADR-0369：車道的訂閱範圍檢查與可選 AUTH](repo:docs/adr/0369-lane-scope-check-and-optional-auth.md)",
                "[遊戲層協定規格](repo:docs/research/game-layer-spec.md)",
              ],
            },
          ],
        },
        {
          id: "nips",
          title: "Nostr 規格",
          blocks: [
            {
              list: [
                "[NIP-01：基本協定](" + NIP("01") + ")",
                "[NIP-11：中繼資訊](" + NIP("11") + ")",
                "[NIP-13：工作量證明](" + NIP("13") + ")",
                "[NIP-40：過期時間](" + NIP("40") + ")",
                "[NIP-42：認證](" + NIP("42") + ")",
              ],
            },
          ],
        },
        {
          id: "support",
          title: "協助",
          blocks: [
            { p: "回報問題或申請加入已知租戶名單，請到 [GitHub issues](repo:issues)。規則的任何變更都會在程式庫中新增一份設計決策紀錄。" },
          ],
        },
      ],
    },
  },
};

const CATALOG: Record<Locale, DevDocs> = { en, "zh-Hant": zhHant };

export function devDocsFor(locale: Locale): DevDocs {
  return CATALOG[locale];
}
