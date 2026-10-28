// 由 relay/src/fixtures/gen-main-stores.mjs 從 5137079c 產生（ADR-0370），不要手改。
// @ts-nocheck
// ../../../AppData/Local/Temp/cinder-main-stores-9J0UC9/relay/src/filters.ts
function matchFilter(filter, event) {
  if (filter.ids && !filter.ids.includes(event.id)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.since !== void 0 && event.created_at < filter.since) return false;
  if (filter.until !== void 0 && event.created_at > filter.until) return false;
  for (const key in filter) {
    if (key.charCodeAt(0) !== 35) continue;
    const wanted = filter[key];
    if (!wanted) continue;
    const tagName = key.slice(1);
    const hit = event.tags.some(
      (t) => t[0] === tagName && t[1] !== void 0 && wanted.includes(t[1])
    );
    if (!hit) return false;
  }
  return true;
}

// ../../../AppData/Local/Temp/cinder-main-stores-9J0UC9/relay/src/capacity.ts
var BORROW_TTL_SECONDS = 2 * 60 * 60;
var BORROW_KEY_SHARE = 1 / 16;
var NEAR_FULL_TOP_PERCENT = 95;
var DROPPED_COUNT_MAX = 1e6;
var DROPPED_RECIPIENTS_MAX = 1e4;
function decideCapacity(input) {
  const { max, used, need } = input;
  if (need > max) return { type: "reject" };
  if (used + need <= max) return { type: "fit" };
  if (input.evicts && input.guarantee === void 0) return { type: "legacy" };
  const borrowed = input.borrowed();
  if (used - borrowed + need <= max) return { type: "reclaim" };
  if (input.evicts && input.withinGuarantee()) {
    return used - borrowed + need - input.excessAvailable() <= max ? { type: "excess" } : { type: "reject" };
  }
  const canBorrow = input.band > 0 && input.planeBorrows && (!input.evicts || input.guarantee !== void 0);
  if (canBorrow && used + need <= max + input.band && input.borrowFitsPerKey()) return { type: "borrow" };
  return { type: "reject" };
}
function overflowBand(max, ratio) {
  if (max === void 0 || ratio === void 0 || !(ratio > 0)) return 0;
  return Math.floor(max * ratio);
}
function borrowPerKey(band, configured) {
  return configured ?? Math.floor(band * BORROW_KEY_SHARE);
}
function nearFullGrade(usedAfter, max, percent) {
  if (max === void 0 || percent === void 0 || max <= 0) return void 0;
  const ratio = usedAfter / max;
  if (percent < NEAR_FULL_TOP_PERCENT && ratio >= NEAR_FULL_TOP_PERCENT / 100) return NEAR_FULL_TOP_PERCENT;
  return ratio >= percent / 100 ? percent : void 0;
}
function borrowedExpiration(effective, nowSec, ttlSeconds = BORROW_TTL_SECONDS) {
  return Math.min(effective, nowSec + ttlSeconds);
}
function pickExcess(candidates, usage, guarantee, target) {
  const left = new Map(usage);
  const rows = [];
  let freed = 0;
  for (const row of candidates) {
    if (freed >= target) break;
    const current = left.get(row.owner) ?? 0;
    if (current - row.bytes < guarantee) continue;
    left.set(row.owner, current - row.bytes);
    rows.push(row);
    freed += row.bytes;
  }
  return { rows, freed };
}
function mergeDropped(prev, count, since, until) {
  if (prev === void 0 || prev.count === 0) return { count: Math.min(count, DROPPED_COUNT_MAX), since, until };
  return {
    count: Math.min(prev.count + count, DROPPED_COUNT_MAX),
    since: Math.min(prev.since, since),
    until: Math.max(prev.until, until)
  };
}

// ../../../AppData/Local/Temp/cinder-main-stores-9J0UC9/relay/src/message-store.ts
function getExpiration(event) {
  const tag = event.tags.find((t) => t[0] === "expiration");
  if (!tag || tag[1] === void 0) return void 0;
  const seconds = Number(tag[1]);
  return Number.isFinite(seconds) ? seconds : void 0;
}
var DEFAULT_MAX_TTL_SECONDS = 7 * 86400;
var MAX_QUERY_ROWS = 1024;
var MAX_QUERY_BYTES = 16 * 1024 * 1024;
function queryLimit(requested) {
  if (typeof requested !== "number" || !Number.isFinite(requested) || requested <= 0) return MAX_QUERY_ROWS;
  return Math.min(Math.floor(requested), MAX_QUERY_ROWS);
}
var FILE_WRAP_KIND = 1060;
var SNAPSHOT_KIND = 30078;
function isAuthorOnlyKind(kind) {
  return kind === SNAPSHOT_KIND;
}
function isAddressablePurge(event) {
  return isAuthorOnlyKind(event.kind) && event.content === "";
}
var DEFAULT_FILE_PER_RECIPIENT = 4e3;
function effectiveExpiration(event, nowSec, maxTtlSeconds = DEFAULT_MAX_TTL_SECONDS) {
  const cap = nowSec + maxTtlSeconds;
  const tagged = getExpiration(event);
  return tagged === void 0 ? cap : Math.min(tagged, cap);
}
function dTagOf(event) {
  return event.tags.find((t) => t[0] === "d")?.[1] ?? "";
}
function shouldReplace(existing, incoming) {
  if (incoming.created_at !== existing.created_at) return incoming.created_at > existing.created_at;
  return incoming.id < existing.id;
}
var ADDRESSABLE_MAX_BYTES = 262144;
var ADDRESSABLE_MAX_PER_AUTHOR = 5;
var ADDRESSABLE_TTL_SECONDS = 30 * 86400;
var ADDRESSABLE_PUT_OK = { ok: true };
function addressableRejected(reason) {
  return { ok: false, reason };
}
function recipientsOf(event) {
  const out = [];
  for (const tag of event.tags) {
    if (tag[0] === "p" && tag[1] !== void 0) out.push(tag[1]);
  }
  return out;
}
function dedupById(events) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    out.push(event);
  }
  return out;
}
function batchOf(event) {
  return event.kind === FILE_WRAP_KIND ? getExpiration(event) : void 0;
}
var MessageStore = class _MessageStore {
  constructor(opts = {}) {
    this.opts = opts;
  }
  /** 收件人 pubkey → 該收件人的留言。 */
  byRecipient = /* @__PURE__ */ new Map();
  /** 無 `p` 標籤的事件。 */
  noRecipient = [];
  /** event id → 有效到期時間（ADR-0065：每列壽命必有界）。 */
  effExp = /* @__PURE__ */ new Map();
  /** 可尋址事件（ADR-0071）：`kind\0pubkey\0d` → 最新一顆。 */
  addressable = /* @__PURE__ */ new Map();
  /** 以借用收下的離線事件 id（溢位帶，SDK ADR 0042）。 */
  borrowedIds = /* @__PURE__ */ new Set();
  /** 以借用收下的可尋址位址（鍵同 {@link addressable}）。 */
  borrowedAddr = /* @__PURE__ */ new Set();
  /** 事件 id → 寫入序號：丟棄計數的水位線用（SQL 版用 rowid；SDK ADR 0042）。 */
  seq = /* @__PURE__ */ new Map();
  nextSeq = 1;
  /** 收件人 → 丟棄計數與水位線（序號 ≤ `mark` 的留言已經送到了）。 */
  drops = /* @__PURE__ */ new Map();
  /** 誰正在線上收自己的收件匣（`RelayCore` 設定）。 */
  inboxProbe = () => false;
  setInboxProbe(probe) {
    this.inboxProbe = probe;
  }
  /** 寫入可取代／可尋址事件（取代語意＋配額；ADR-0035／0071）。可取代事件無 `d` → 每 (kind,pubkey) 一顆。 */
  putAddressable(event, nowSec) {
    return this.putAddressableResult(event, nowSec).ok;
  }
  /** 同 {@link putAddressable}，被拒時帶原因（SDK ADR 0038 P0-R2）；收下時帶借用與預警（SDK ADR 0042）。 */
  putAddressableResult(event, nowSec) {
    const prefix = `${event.kind}\0${event.pubkey}\0`;
    const key = prefix + dTagOf(event);
    const existing = this.addressable.get(key);
    if (existing && !shouldReplace(existing, event)) return addressableRejected("stale");
    if (isAddressablePurge(event)) {
      if (existing) {
        this.addressable.delete(key);
        this.borrowedAddr.delete(key);
        this.effExp.delete(existing.id);
      }
      return ADDRESSABLE_PUT_OK;
    }
    const size = JSON.stringify(event).length;
    if (size > (this.opts.addressableMaxBytes ?? ADDRESSABLE_MAX_BYTES)) return addressableRejected("too-large");
    if (!existing) {
      let count = 0;
      for (const k of this.addressable.keys()) if (k.startsWith(prefix)) count++;
      if (count >= (this.opts.addressablePerAuthor ?? ADDRESSABLE_MAX_PER_AUTHOR)) return addressableRejected("address-quota");
    }
    const budget = this.opts.addressableBytesPerAuthor;
    if (budget !== void 0) {
      let used = 0;
      for (const [k, e] of this.addressable) {
        if (e.pubkey !== event.pubkey || k === key) continue;
        used += JSON.stringify(e).length;
      }
      if (used + size > budget) return addressableRejected("byte-quota");
    }
    let eff = effectiveExpiration(event, nowSec, this.opts.addressableTtlSeconds ?? ADDRESSABLE_TTL_SECONDS);
    if (eff <= nowSec) return addressableRejected("expired");
    const placed = this.placeAddressable(key, event.pubkey, size);
    if (placed === void 0) return addressableRejected("ceiling");
    if (existing) this.effExp.delete(existing.id);
    const ttl = this.opts.borrowTtlSeconds ?? BORROW_TTL_SECONDS;
    if (placed.borrowed) {
      eff = borrowedExpiration(eff, nowSec, ttl);
      this.borrowedAddr.add(key);
    } else {
      this.borrowedAddr.delete(key);
    }
    this.addressable.set(key, event);
    this.effExp.set(event.id, eff);
    if (placed.borrowed) return { ok: true, borrowedTtlSec: ttl };
    const nearFull = nearFullGrade(this.addressableBytes(), this.opts.addressableMaxTotalBytes, this.opts.nearFullPercent);
    return nearFull === void 0 ? ADDRESSABLE_PUT_OK : { ok: true, nearFull };
  }
  /** 目前可尋址佔用的位元組（`except` 那個位址不算：它即將被取代）。 */
  addressableBytes(except) {
    let used = 0;
    for (const [k, e] of this.addressable) if (k !== except) used += JSON.stringify(e).length;
    return used;
  }
  /** 目前離線留言佔用的位元組（每位收件人各算一份，與 SQL 版的「一列」對齊）。 */
  offlineBytes() {
    let used = 0;
    for (const { event } of this.offlineRows()) used += JSON.stringify(event).length;
    return used;
  }
  /** 每一列離線留言（每位收件人一列；無 `p` 者 `recipient = ''`）。 */
  offlineRows() {
    const rows = [];
    for (const event of this.noRecipient) rows.push({ event, recipient: "" });
    for (const [recipient, bucket] of this.byRecipient) for (const event of bucket) rows.push({ event, recipient });
    return rows;
  }
  /** 保底份額的 key：收件人；沒有收件人的列以作者計（SDK ADR 0042）。 */
  static ownerOf(event, recipient) {
    return recipient === "" ? event.pubkey : recipient;
  }
  /** 每個 key 的離線用量（`borrowed` 選正常列或借用列）。 */
  offlineUsage(borrowed) {
    const usage = /* @__PURE__ */ new Map();
    for (const { event, recipient } of this.offlineRows()) {
      if (this.borrowedIds.has(event.id) !== borrowed) continue;
      const owner = _MessageStore.ownerOf(event, recipient);
      usage.set(owner, (usage.get(owner) ?? 0) + JSON.stringify(event).length);
    }
    return usage;
  }
  /** 依到期時間由近而遠排好的離線列（`borrowed` 選正常列或借用列）。 */
  offlineRowsByExpiry(borrowed) {
    return this.offlineRows().filter(({ event }) => this.borrowedIds.has(event.id) === borrowed).map(({ event, recipient }) => ({
      event,
      recipient,
      owner: _MessageStore.ownerOf(event, recipient),
      bytes: JSON.stringify(event).length
    })).sort((a, b) => (this.effExp.get(a.event.id) ?? 0) - (this.effExp.get(b.event.id) ?? 0));
  }
  /**
   * 這顆 DO 放不放得下這筆離線留言、怎麼放（ADR-0367 §決策 2；SDK ADR 0042 的保底與溢位帶）。
   * 回 undefined＝拒收；`borrowed`＝放進溢位帶。決策與 SQL 版共用 `decideCapacity`。
   */
  placeOffline(size, copies, owners, nowSec) {
    const max = this.opts.offlineMaxTotalBytes;
    if (max === void 0) return { borrowed: false };
    const need = size * copies;
    let used = this.offlineBytes();
    const guarantee = this.opts.guaranteeBytes;
    const band = overflowBand(max, this.opts.overflowRatio);
    let borrowedTotal;
    let plan = [];
    const borrowed = () => borrowedTotal ??= [...this.offlineUsage(true).values()].reduce((a, b) => a + b, 0);
    const decision = decideCapacity({
      max,
      used,
      need,
      evicts: this.opts.ceilingEvicts === true,
      guarantee,
      band,
      planeBorrows: true,
      borrowed,
      withinGuarantee: () => {
        const usage = this.offlineUsage(false);
        return owners.every((o) => (usage.get(o) ?? 0) + size <= guarantee);
      },
      excessAvailable: () => {
        const usage = this.offlineUsage(false);
        const mine = new Set(owners);
        const candidates = this.offlineRowsByExpiry(false).filter(
          (r) => !mine.has(r.owner) && (usage.get(r.owner) ?? 0) > guarantee
        );
        const picked = pickExcess(candidates, usage, guarantee, used - borrowed() + need - max);
        plan = picked.rows;
        return picked.freed;
      },
      borrowFitsPerKey: () => {
        const usage = this.offlineUsage(true);
        const perKey = borrowPerKey(band, this.opts.borrowPerKeyBytes);
        return owners.every((o) => (usage.get(o) ?? 0) + size <= perKey);
      }
    });
    switch (decision.type) {
      case "fit":
        return { borrowed: false };
      case "borrow":
        return { borrowed: true };
      case "reject":
        return void 0;
      case "reclaim": {
        const gone = [];
        for (const row of this.offlineRowsByExpiry(true)) {
          if (used + need <= max) break;
          used -= this.dropRow(row.event, row.recipient, nowSec);
          gone.push(row);
        }
        this.dropBatchMates(gone, nowSec);
        return { borrowed: false };
      }
      case "excess": {
        const gone = [...this.offlineRowsByExpiry(true), ...plan];
        for (const row of gone) this.dropRow(row.event, row.recipient, nowSec);
        this.dropBatchMates(gone, nowSec);
        return { borrowed: false };
      }
      case "legacy": {
        const victims = [...this.effExp.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
        for (const id of victims) {
          if (used + need <= max) break;
          const gone = [];
          used -= this.dropOffline(id, nowSec, gone);
          used -= this.dropBatchMates(gone, nowSec);
        }
        return used + need <= max ? { borrowed: false } : void 0;
      }
    }
  }
  /**
   * 可尋址那一側的同一套決策（SDK ADR 0042）。`key` 是即將被取代的位址（不算進用量），`pubkey` 是保底的 key。
   */
  placeAddressable(key, pubkey, size) {
    const max = this.opts.addressableMaxTotalBytes;
    if (max === void 0) return { borrowed: false };
    let used = this.addressableBytes(key);
    const guarantee = this.opts.guaranteeBytes;
    const band = overflowBand(max, this.opts.overflowRatio);
    const others = (borrowed2) => [...this.addressable.entries()].filter(([k]) => k !== key && this.borrowedAddr.has(k) === borrowed2).map(([k, e]) => [k, e, JSON.stringify(e).length]).sort((a, b) => (this.effExp.get(a[1].id) ?? 0) - (this.effExp.get(b[1].id) ?? 0));
    const usageOf = (borrowed2) => {
      const usage = /* @__PURE__ */ new Map();
      for (const [, e, n] of others(borrowed2)) usage.set(e.pubkey, (usage.get(e.pubkey) ?? 0) + n);
      return usage;
    };
    let borrowedTotal;
    const borrowed = () => borrowedTotal ??= others(true).reduce((a, [, , n]) => a + n, 0);
    let plan = [];
    const decision = decideCapacity({
      max,
      used,
      need: size,
      evicts: this.opts.ceilingEvicts === true,
      guarantee,
      band,
      planeBorrows: this.opts.addressableBorrows !== false,
      borrowed,
      withinGuarantee: () => (usageOf(false).get(pubkey) ?? 0) + size <= guarantee,
      excessAvailable: () => {
        const usage = usageOf(false);
        const candidates = others(false).filter(([, e]) => e.pubkey !== pubkey && (usage.get(e.pubkey) ?? 0) > guarantee).map(([k, e, n]) => ({ key: k, owner: e.pubkey, bytes: n, id: e.id }));
        const picked = pickExcess(candidates, usage, guarantee, used - borrowed() + size - max);
        plan = picked.rows;
        return picked.freed;
      },
      borrowFitsPerKey: () => (usageOf(true).get(pubkey) ?? 0) + size <= borrowPerKey(band, this.opts.borrowPerKeyBytes)
    });
    const drop = (k, id) => {
      this.addressable.delete(k);
      this.borrowedAddr.delete(k);
      this.effExp.delete(id);
    };
    switch (decision.type) {
      case "fit":
        return { borrowed: false };
      case "borrow":
        return { borrowed: true };
      case "reject":
        return void 0;
      case "reclaim":
        for (const [k, e, n] of others(true)) {
          if (used + size <= max) break;
          drop(k, e.id);
          used -= n;
        }
        return { borrowed: false };
      case "excess":
        for (const [k, e] of others(true)) drop(k, e.id);
        for (const row of plan) drop(row.key, row.id);
        return { borrowed: false };
      case "legacy": {
        const byExpiry = [...this.addressable.entries()].filter(([k]) => k !== key).sort((a, b) => (this.effExp.get(a[1].id) ?? 0) - (this.effExp.get(b[1].id) ?? 0));
        for (const [k, e] of byExpiry) {
          if (used + size <= max) break;
          used -= JSON.stringify(e).length;
          drop(k, e.id);
        }
        return used + size <= max ? { borrowed: false } : void 0;
      }
    }
  }
  /** 事件還在任何一個離線桶裡嗎。 */
  stillStored(id) {
    if (this.noRecipient.some((e) => e.id === id)) return true;
    for (const bucket of this.byRecipient.values()) if (bucket.some((e) => e.id === id)) return true;
    return false;
  }
  /** 忘掉一顆不再存在的離線事件的附帶資料（到期時間、借用、序號）。 */
  forgetOffline(id) {
    this.effExp.delete(id);
    this.borrowedIds.delete(id);
    this.seq.delete(id);
  }
  /** 刪掉一列（某位收件人的那一份），回傳釋放的位元組；記進丟棄計數。 */
  dropRow(event, recipient, nowSec) {
    let freed = 0;
    const keep = (e) => {
      if (freed > 0 || e.id !== event.id) return true;
      freed = JSON.stringify(e).length;
      return false;
    };
    if (recipient === "") {
      this.noRecipient = this.noRecipient.filter(keep);
    } else {
      const bucket = this.byRecipient.get(recipient);
      if (bucket) {
        const next = bucket.filter(keep);
        if (next.length === 0) this.byRecipient.delete(recipient);
        else this.byRecipient.set(recipient, next);
      }
    }
    if (freed > 0) {
      this.noteDropped(recipient, event, nowSec);
      if (!this.stillStored(event.id)) this.forgetOffline(event.id);
    }
    return freed;
  }
  /**
   * 整批淘汰（SDK ADR 0085）：中繼自己刪掉的檔案塊，同一收件人、同一個 `expiration` 標籤（＝同一次送出）的其餘檔案塊一起刪，
   * 回傳釋放的位元組。只刪一部分會切出永遠收不齊的孤兒：佔空間到過期、每次補拉都被整批再下載。
   * 批次靠中繼本來就看得到的值判斷（不加任何元資料）；同一秒送給同一人的另一則可能被一起刪（ADR 0085 已知取捨）。
   */
  dropBatchMates(dropped, nowSec) {
    const batches = /* @__PURE__ */ new Map();
    for (const { event, recipient } of dropped) {
      const batch = batchOf(event);
      if (batch === void 0 || recipient === "") continue;
      const set = batches.get(recipient) ?? /* @__PURE__ */ new Set();
      set.add(batch);
      batches.set(recipient, set);
    }
    let freed = 0;
    for (const [recipient, set] of batches) {
      const mates = (this.byRecipient.get(recipient) ?? []).filter((e) => set.has(batchOf(e) ?? NaN));
      for (const e of mates) freed += this.dropRow(e, recipient, nowSec);
    }
    return freed;
  }
  /** 從所有桶移除某個 id，回傳釋放的位元組（v0.33 的淘汰）。`removed` 給了就把移除的列放進去。 */
  dropOffline(id, nowSec, removedOut) {
    let freed = 0;
    const removed = [];
    const keep = (recipient) => (e) => {
      if (e.id !== id) return true;
      freed += JSON.stringify(e).length;
      removed.push({ event: e, recipient });
      return false;
    };
    this.noRecipient = this.noRecipient.filter(keep(""));
    for (const [recipient, bucket] of this.byRecipient) {
      const next = bucket.filter(keep(recipient));
      if (next.length === 0) this.byRecipient.delete(recipient);
      else this.byRecipient.set(recipient, next);
    }
    for (const { event, recipient } of removed) this.noteDropped(recipient, event, nowSec);
    if (freed > 0) this.forgetOffline(id);
    removedOut?.push(...removed);
    return freed;
  }
  /**
   * 寄給 `recipient` 的一則被刪掉了（FIFO、天花板淘汰、借用到期）：記進丟棄計數（SDK ADR 0042）。
   * 不計：沒開 `countDrops`、沒有收件人、收件人正在線上收收件匣（即時收到了）、在上次送到的水位線以前就存了（送到過）。
   */
  noteDropped(recipient, event, nowSec) {
    if (this.opts.countDrops !== true || recipient === "" || this.inboxProbe(recipient)) return;
    const entry = this.drops.get(recipient);
    if ((this.seq.get(event.id) ?? 0) <= (entry?.mark ?? 0)) return;
    this.drops.set(recipient, {
      summary: mergeDropped(entry?.summary, 1, event.created_at, event.created_at),
      mark: entry?.mark ?? 0,
      updatedAt: nowSec
    });
    if (this.drops.size > DROPPED_RECIPIENTS_MAX) {
      let oldest;
      let at = Infinity;
      for (const [r, e] of this.drops) if (e.updatedAt < at) [oldest, at] = [r, e.updatedAt];
      if (oldest !== void 0) this.drops.delete(oldest);
    }
  }
  takeDropped(recipient, nowSec) {
    if (this.opts.countDrops !== true) return void 0;
    const summary = this.drops.get(recipient)?.summary;
    this.drops.set(recipient, { mark: this.nextSeq - 1, updatedAt: nowSec });
    return summary !== void 0 && summary.count > 0 ? summary : void 0;
  }
  markDelivered(recipient, nowSec) {
    if (this.opts.countDrops !== true) return;
    const entry = this.drops.get(recipient);
    this.drops.set(recipient, { ...entry?.summary ? { summary: entry.summary } : {}, mark: this.nextSeq - 1, updatedAt: nowSec });
  }
  ackInbox(recipient, ids, expiresAt, nowSec) {
    const bucket = this.byRecipient.get(recipient);
    if (!bucket) return 0;
    const wanted = new Set(ids);
    let lowered = 0;
    for (const event of bucket) {
      if (!wanted.has(event.id) || this.isExpired(event, nowSec)) continue;
      const others = recipientsOf(event);
      if (others.length !== 1 || others[0] !== recipient) continue;
      const exp = this.effExp.get(event.id) ?? getExpiration(event);
      if (exp !== void 0 && exp <= expiresAt) continue;
      this.effExp.set(event.id, expiresAt);
      lowered += 1;
    }
    return lowered;
  }
  /** 寫入一筆留言；若已過期則拒絕並回 false。 */
  put(event, nowSec) {
    return this.putResult(event, nowSec).ok;
  }
  /** 同 {@link put}，說出結果的細節（SDK ADR 0042）。 */
  putResult(event, nowSec) {
    if (this.isExpired(event, nowSec)) return { ok: false, reason: "expired" };
    const recipients = recipientsOf(event);
    const copies = Math.max(1, recipients.length);
    const owners = [...new Set(recipients.length > 0 ? recipients : [event.pubkey])];
    const placed = this.placeOffline(JSON.stringify(event).length, copies, owners, nowSec);
    if (placed === void 0) return { ok: false, reason: "ceiling" };
    const ttl = this.opts.borrowTtlSeconds ?? BORROW_TTL_SECONDS;
    const eff = effectiveExpiration(event, nowSec, this.opts.maxTtlSeconds);
    this.effExp.set(event.id, placed.borrowed ? borrowedExpiration(eff, nowSec, ttl) : eff);
    if (placed.borrowed) this.borrowedIds.add(event.id);
    else this.borrowedIds.delete(event.id);
    this.seq.set(event.id, this.nextSeq++);
    if (recipients.length === 0) {
      this.noRecipient.push(event);
    } else {
      for (const recipient of recipients) {
        const bucket = this.byRecipient.get(recipient) ?? [];
        bucket.push(event);
        this.byRecipient.set(recipient, bucket);
      }
      this.enforceCap(recipients, nowSec);
    }
    if (placed.borrowed) return { ok: true, borrowedTtlSec: ttl };
    const nearFull = nearFullGrade(this.offlineBytes(), this.opts.offlineMaxTotalBytes, this.opts.nearFullPercent);
    return nearFull === void 0 ? { ok: true } : { ok: true, nearFull };
  }
  /**
   * 查詢符合 filter 且未過期的留言。
   *
   * 回傳筆數與 SQL 版一樣有界（ADR-0235 C2）——兩個實作共用同一份 `OfflineStore` 契約，
   * 行為分歧會讓「用記憶體版寫的測試」保證不了產線的 SQL 版。
   */
  query(filter, nowSec, maxBytes) {
    const candidates = this.candidatesFor(filter);
    const hit = candidates.filter((e) => !this.isExpired(e, nowSec) && matchFilter(filter, e));
    const limit = queryLimit(filter.limit);
    if (hit.length <= limit && maxBytes === void 0) return hit;
    const newest = [...hit].sort((a, b) => b.created_at - a.created_at).slice(0, limit);
    if (maxBytes === void 0) return newest;
    const out = [];
    let spent = 0;
    for (const e of newest) {
      const n = JSON.stringify(e).length;
      if (spent + n > maxBytes) break;
      spent += n;
      out.push(e);
    }
    return out;
  }
  /** 清除所有已過期留言。借用列到期算丟棄（SDK ADR 0042）；一般的保存期到期不算——那是宣告過的契約。 */
  prune(nowSec) {
    const survivors = /* @__PURE__ */ new Set();
    const borrowedGone = [];
    for (const [recipient, bucket] of this.byRecipient) {
      const kept = bucket.filter((e) => {
        if (!this.isExpired(e, nowSec)) return true;
        if (this.borrowedIds.has(e.id)) {
          this.noteDropped(recipient, e, nowSec);
          borrowedGone.push({ event: e, recipient });
        }
        return false;
      });
      if (kept.length > 0) this.byRecipient.set(recipient, kept);
      else this.byRecipient.delete(recipient);
      for (const e of kept) survivors.add(e.id);
    }
    this.dropBatchMates(borrowedGone, nowSec);
    for (const bucket of this.byRecipient.values()) for (const e of bucket) survivors.add(e.id);
    this.noRecipient = this.noRecipient.filter((e) => !this.isExpired(e, nowSec));
    for (const e of this.noRecipient) survivors.add(e.id);
    for (const [key, e] of this.addressable) {
      if (this.isExpired(e, nowSec)) {
        this.addressable.delete(key);
        this.borrowedAddr.delete(key);
      } else survivors.add(e.id);
    }
    for (const id of this.effExp.keys()) {
      if (!survivors.has(id)) this.forgetOffline(id);
    }
    const keepFor = this.opts.maxTtlSeconds ?? DEFAULT_MAX_TTL_SECONDS;
    for (const [r, e] of this.drops) if (e.updatedAt <= nowSec - keepFor) this.drops.delete(r);
  }
  /** NIP-62 清除（ADR-0260）：刪掉此人發的、寄給他的、以及他的可尋址事件。 */
  vanish(pubkey, _nowSec) {
    const removed = /* @__PURE__ */ new Set();
    for (const e of this.byRecipient.get(pubkey) ?? []) removed.add(e.id);
    this.byRecipient.delete(pubkey);
    for (const [recipient, bucket] of this.byRecipient) {
      const kept = bucket.filter((e) => {
        if (e.pubkey !== pubkey) return true;
        removed.add(e.id);
        return false;
      });
      if (kept.length > 0) this.byRecipient.set(recipient, kept);
      else this.byRecipient.delete(recipient);
    }
    this.noRecipient = this.noRecipient.filter((e) => {
      if (e.pubkey !== pubkey) return true;
      removed.add(e.id);
      return false;
    });
    for (const [key, e] of this.addressable) {
      if (e.pubkey !== pubkey) continue;
      removed.add(e.id);
      this.addressable.delete(key);
      this.borrowedAddr.delete(key);
    }
    this.drops.delete(pubkey);
    const survivors = /* @__PURE__ */ new Set();
    for (const bucket of this.byRecipient.values()) for (const e of bucket) survivors.add(e.id);
    for (const e of this.noRecipient) survivors.add(e.id);
    for (const e of this.addressable.values()) survivors.add(e.id);
    for (const id of removed) if (!survivors.has(id)) this.forgetOffline(id);
    return removed.size;
  }
  /** 依 filter 縮小候選集合：帶 `#p` 時僅取相關收件人桶，否則全掃。 */
  candidatesFor(filter) {
    const pValues = filter["#p"];
    if (pValues && pValues.length > 0) {
      return dedupById(pValues.flatMap((r) => this.byRecipient.get(r) ?? []));
    }
    return this.allEvents();
  }
  allEvents() {
    const all = [];
    for (const bucket of this.byRecipient.values()) all.push(...bucket);
    all.push(...this.noRecipient);
    all.push(...this.addressable.values());
    return dedupById(all);
  }
  isExpired(event, nowSec) {
    const exp = this.effExp.get(event.id) ?? getExpiration(event);
    return exp !== void 0 && exp <= nowSec;
  }
  enforceCap(recipients, nowSec) {
    const cap = this.opts.maxPerRecipient;
    const fileCap = this.opts.filePerRecipient ?? DEFAULT_FILE_PER_RECIPIENT;
    for (const recipient of recipients) {
      const bucket = this.byRecipient.get(recipient);
      if (!bucket) continue;
      const sorted = [...bucket].sort((a, b) => a.created_at - b.created_at);
      const keptReversed = [];
      const trimmed = [];
      let chat = 0;
      let file = 0;
      for (let i = sorted.length - 1; i >= 0; i--) {
        const e = sorted[i];
        if (e.kind === FILE_WRAP_KIND) {
          if (file >= fileCap) {
            trimmed.push(e);
            continue;
          }
          file++;
        } else if (cap !== void 0) {
          if (chat >= cap) {
            trimmed.push(e);
            continue;
          }
          chat++;
        }
        keptReversed.push(e);
      }
      this.byRecipient.set(recipient, keptReversed.reverse());
      for (const e of trimmed) {
        this.noteDropped(recipient, e, nowSec);
        if (!this.stillStored(e.id)) this.forgetOffline(e.id);
      }
      this.dropBatchMates(trimmed.map((event) => ({ event, recipient })), nowSec);
    }
  }
};

// ../../../AppData/Local/Temp/cinder-main-stores-9J0UC9/relay/src/sql-message-store.ts
function inJson(column, values) {
  if (!Array.isArray(values)) throw new TypeError("filter 值必須是陣列");
  return { clause: `${column} IN (SELECT value FROM json_each(?))`, binding: JSON.stringify(values) };
}
function tagFiltersOf(filter) {
  const out = [];
  for (const key in filter) {
    if (key.charCodeAt(0) !== 35 || key === "#p") continue;
    const values = filter[key];
    if (values) out.push({ name: key.slice(1), values });
  }
  return out;
}
function pushTagClauses(table, filter, where, bind) {
  for (const { name, values } of tagFiltersOf(filter)) {
    const vals = inJson("json_extract(tg.value, '$[1]')", values);
    where.push(
      `EXISTS (SELECT 1 FROM json_each(${table}.json, '$.tags') AS tg
               WHERE json_extract(tg.value, '$[0]') = ?
                 AND ${vals.clause})`
    );
    bind.push(name, vals.binding);
  }
}
var pushIn = (where, bind, column, values) => {
  const only = Array.isArray(values) && values.length === 1 ? values[0] : void 0;
  if (typeof only === "string" || typeof only === "number") {
    where.push(`${column} = ?`);
    bind.push(only);
    return;
  }
  const { clause, binding } = inJson(column, values);
  where.push(clause);
  bind.push(binding);
};
var SqlMessageStore = class {
  constructor(sql, opts = {}) {
    this.sql = sql;
    this.opts = opts;
    this.sql(
      `CREATE TABLE IF NOT EXISTS offline_msgs (
        id TEXT NOT NULL,
        recipient TEXT NOT NULL,
        expiration INTEGER,
        created_at INTEGER NOT NULL,
        json TEXT NOT NULL,
        PRIMARY KEY (id, recipient)
      )`
    );
    this.sql(`CREATE INDEX IF NOT EXISTS idx_offline_expiration ON offline_msgs(expiration)`);
    this.sql(
      `CREATE TABLE IF NOT EXISTS addressable (
        kind INTEGER NOT NULL,
        pubkey TEXT NOT NULL,
        d TEXT NOT NULL,
        id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expiration INTEGER NOT NULL,
        json TEXT NOT NULL,
        PRIMARY KEY (kind, pubkey, d)
      )`
    );
    this.sql(`CREATE INDEX IF NOT EXISTS idx_addressable_expiration ON addressable(expiration)`);
    this.sql(`CREATE INDEX IF NOT EXISTS idx_addressable_pubkey ON addressable(pubkey)`);
    this.sql(
      `UPDATE offline_msgs SET expiration = created_at + ? WHERE expiration IS NULL`,
      opts.maxTtlSeconds ?? DEFAULT_MAX_TTL_SECONDS
    );
    for (const ddl of [
      `ALTER TABLE offline_msgs ADD COLUMN pubkey TEXT`,
      `ALTER TABLE offline_msgs ADD COLUMN kind INTEGER`,
      // ADR-0371 §決策 5：每列的位元組數。總量與天花板改讀這一欄（有索引），
      // 不再 `SUM(LENGTH(json))`——後者要把每一列的 json 從溢位頁讀出來（實測 260MB 約 1.4 秒）。
      `ALTER TABLE offline_msgs ADD COLUMN bytes INTEGER`
    ]) {
      try {
        this.sql(ddl);
      } catch {
      }
    }
    this.sql(
      `UPDATE offline_msgs SET pubkey = json_extract(json, '$.pubkey'), kind = json_extract(json, '$.kind')
       WHERE pubkey IS NULL OR kind IS NULL`
    );
    this.sql(`CREATE INDEX IF NOT EXISTS idx_offline_pubkey ON offline_msgs(pubkey)`);
    this.sql(`DROP INDEX IF EXISTS idx_offline_kind`);
    this.sql(
      `CREATE INDEX IF NOT EXISTS idx_offline_bucket ON offline_msgs(recipient, kind, created_at, expiration, bytes)`
    );
    this.sql(`DROP INDEX IF EXISTS idx_offline_recipient`);
    this.sql(`CREATE INDEX IF NOT EXISTS idx_offline_bytes_missing ON offline_msgs(id) WHERE bytes IS NULL`);
    this.sql(`UPDATE offline_msgs SET bytes = LENGTH(json) WHERE bytes IS NULL`);
    for (const ddl of [
      `ALTER TABLE offline_msgs ADD COLUMN borrowed INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE addressable ADD COLUMN borrowed INTEGER NOT NULL DEFAULT 0`
    ]) {
      try {
        this.sql(ddl);
      } catch {
      }
    }
    this.sql(
      `CREATE INDEX IF NOT EXISTS idx_offline_borrowed ON offline_msgs(recipient, pubkey, expiration, bytes, created_at) WHERE borrowed = 1`
    );
    this.sql(`CREATE INDEX IF NOT EXISTS idx_addressable_borrowed ON addressable(pubkey, expiration) WHERE borrowed = 1`);
    try {
      this.sql(`ALTER TABLE offline_msgs ADD COLUMN batch INTEGER`);
    } catch {
    }
    this.sql(
      `CREATE INDEX IF NOT EXISTS idx_offline_batch ON offline_msgs(recipient, batch, bytes, created_at) WHERE batch IS NOT NULL`
    );
    this.sql(
      `CREATE TABLE IF NOT EXISTS inbox_drops (
        recipient TEXT PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 0,
        since INTEGER,
        until INTEGER,
        mark INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )`
    );
    this.sql(`CREATE INDEX IF NOT EXISTS idx_inbox_drops_updated ON inbox_drops(updated_at)`);
  }
  /**
   * 離線留言目前佔用的位元組（快取；`undefined`＝下次用到時重算一次）。ADR-0371 §決策 5。
   *
   * 🔴 為什麼要快取：天花板每次寫入都要問「現在用了多少」。就算改讀索引，`SUM` 仍要掃過
   * **每一列**的索引項，而 Cloudflare 以「讀取列數」計費（免費層每日 500 萬列）——一顆滿載的
   * 檔案車道 DO 有數千列，上傳一個 30MB 檔（656 塊）就會把一整天的額度讀光。
   * 寫入時加、刪除時減；刪除路徑算不出確切數字的（prune、vanish）直接作廢，下次重算。
   */
  offlineUsed;
  /** 每個（收件人, 桶）目前的列數（快取，理由同上）。鍵見 {@link bucketKey}。 */
  bucketCounts = /* @__PURE__ */ new Map();
  /** 借用列的總量（快取；SDK ADR 0042）。只在天花板滿了才用得到，從部分索引算、很便宜。 */
  offlineBorrowed;
  /**
   * 每個 key（收件人；沒有收件人的列＝作者）的**正常列**用量（快取；SDK ADR 0042 保底份額）。
   * 只有設了保底、而且天花板滿了才建（一次掃過分桶索引），之後寫入時加、刪除時減或重算那一個 key。
   */
  ownerNormal;
  /** 丟棄計數表的列數（快取；上限 `DROPPED_RECIPIENTS_MAX`）。 */
  dropRows;
  /** 誰正在線上收自己的收件匣（`RelayCore` 設定；SDK ADR 0042）。 */
  inboxProbe = () => false;
  /** 作廢所有快取（下次用到時從索引重算）。 */
  invalidateUsage() {
    this.offlineUsed = void 0;
    this.offlineBorrowed = void 0;
    this.ownerNormal = void 0;
    this.bucketCounts.clear();
  }
  setInboxProbe(probe) {
    this.inboxProbe = probe;
  }
  usedOfflineBytes() {
    if (this.offlineUsed === void 0) {
      this.offlineUsed = Number(this.sql(`SELECT COALESCE(SUM(bytes), 0) AS n FROM offline_msgs`)[0]?.n ?? 0) || 0;
    }
    return this.offlineUsed;
  }
  /** 借用列的總量（部分索引 `idx_offline_borrowed`，只掃借用列）。 */
  borrowedOfflineBytes() {
    if (this.offlineBorrowed === void 0) {
      this.offlineBorrowed = Number(this.sql(`SELECT COALESCE(SUM(bytes), 0) AS n FROM offline_msgs WHERE borrowed = 1`)[0]?.n ?? 0) || 0;
    }
    return this.offlineBorrowed;
  }
  /** 某個 key 的借用量（部分索引）。 */
  ownerBorrowedBytes(owner) {
    return Number(
      this.sql(
        `SELECT COALESCE(SUM(bytes), 0) AS n FROM offline_msgs
           WHERE borrowed = 1 AND (recipient = ? OR (recipient = '' AND pubkey = ?))`,
        owner,
        owner
      )[0]?.n ?? 0
    ) || 0;
  }
  /**
   * 每個 key 的正常列用量（SDK ADR 0042）。
   *
   * 🔴 刻意不在大表上讀 `borrowed` 欄：它是 `ADD COLUMN` 加的、排在 json 後面，檔案塊的 json 在溢位頁上，
   * 讀它要把整串溢位頁走完（Cinderous ADR-0371 §決策 5 的教訓）。所以用「分桶索引上的總量 − 部分索引上的借用量」。
   */
  ownerNormalUsage() {
    if (this.ownerNormal !== void 0) return this.ownerNormal;
    const usage = /* @__PURE__ */ new Map();
    const add = (rows, sign) => {
      for (const row of rows) {
        const owner = String(row.o);
        usage.set(owner, (usage.get(owner) ?? 0) + sign * (Number(row.n ?? 0) || 0));
      }
    };
    add(this.sql(`SELECT recipient AS o, SUM(bytes) AS n FROM offline_msgs WHERE recipient != '' GROUP BY recipient`), 1);
    add(this.sql(`SELECT pubkey AS o, SUM(bytes) AS n FROM offline_msgs WHERE recipient = '' GROUP BY pubkey`), 1);
    add(
      this.sql(
        `SELECT CASE WHEN recipient = '' THEN pubkey ELSE recipient END AS o, SUM(bytes) AS n
         FROM offline_msgs WHERE borrowed = 1 GROUP BY o`
      ),
      -1
    );
    this.ownerNormal = usage;
    return usage;
  }
  put(event, nowSec) {
    return this.putResult(event, nowSec).ok;
  }
  /** 同 {@link put}，說出結果的細節（SDK ADR 0042）。行為與記憶體版對齊。 */
  putResult(event, nowSec) {
    const exp = getExpiration(event);
    if (exp !== void 0 && exp <= nowSec) return { ok: false, reason: "expired" };
    const effExp = effectiveExpiration(event, nowSec, this.opts.maxTtlSeconds);
    const recipients = recipientsOf(event);
    const targets = [...new Set(recipients.length > 0 ? recipients : [""])];
    const json = JSON.stringify(event);
    const size = json.length;
    const present = new Set(
      this.sql(`SELECT recipient FROM offline_msgs WHERE id = ?`, event.id).map((r) => r.recipient)
    );
    const fresh = targets.filter((r) => !present.has(r));
    if (fresh.length === 0) return { ok: true };
    const owners = [...new Set(fresh.map((r) => r === "" ? event.pubkey : r))];
    const placed = this.placeOffline(size, fresh.length, owners, nowSec);
    if (placed === void 0) return { ok: false, reason: "ceiling" };
    const ttl = this.opts.borrowTtlSeconds ?? BORROW_TTL_SECONDS;
    const expiration = placed.borrowed ? borrowedExpiration(effExp, nowSec, ttl) : effExp;
    for (const recipient of fresh) {
      this.sql(
        `INSERT OR IGNORE INTO offline_msgs (id, recipient, expiration, created_at, json, pubkey, kind, bytes, borrowed, batch)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        event.id,
        recipient,
        expiration,
        event.created_at,
        json,
        event.pubkey,
        event.kind,
        size,
        placed.borrowed ? 1 : 0,
        batchOf(event) ?? null
      );
    }
    if (this.offlineUsed !== void 0) this.offlineUsed += size * fresh.length;
    if (placed.borrowed) {
      if (this.offlineBorrowed !== void 0) this.offlineBorrowed += size * fresh.length;
    } else if (this.ownerNormal !== void 0) {
      for (const recipient of fresh) {
        const owner = recipient === "" ? event.pubkey : recipient;
        this.ownerNormal.set(owner, (this.ownerNormal.get(owner) ?? 0) + size);
      }
    }
    const file = event.kind === FILE_WRAP_KIND;
    for (const recipient of fresh) {
      const key = bucketKey(recipient, file);
      const count = this.bucketCounts.get(key);
      if (count !== void 0) this.bucketCounts.set(key, count + 1);
    }
    this.enforceCap(fresh, file, nowSec);
    if (placed.borrowed) return { ok: true, borrowedTtlSec: ttl };
    if (this.opts.nearFullPercent === void 0) return { ok: true };
    const nearFull = nearFullGrade(this.usedOfflineBytes(), this.opts.offlineMaxTotalBytes, this.opts.nearFullPercent);
    return nearFull === void 0 ? { ok: true } : { ok: true, nearFull };
  }
  /** 寫入可取代／可尋址事件（取代語意＋配額；ADR-0035／0071）。行為對齊記憶體版。 */
  putAddressable(event, nowSec) {
    return this.putAddressableResult(event, nowSec).ok;
  }
  /** 同 {@link putAddressable}，被拒時帶原因（SDK ADR 0038 P0-R2）；收下時帶借用與預警（SDK ADR 0042）。原因與記憶體版逐字對齊。 */
  putAddressableResult(event, nowSec) {
    const d = dTagOf(event);
    const existing = this.sql(
      `SELECT id, created_at, LENGTH(json) AS len, borrowed FROM addressable WHERE kind = ? AND pubkey = ? AND d = ?`,
      event.kind,
      event.pubkey,
      d
    );
    const prev = existing[0];
    if (prev) {
      const prevEvent = { id: prev.id, created_at: prev.created_at };
      if (!shouldReplace(prevEvent, event)) return addressableRejected("stale");
    }
    if (isAddressablePurge(event)) {
      this.sql(`DELETE FROM addressable WHERE kind = ? AND pubkey = ? AND d = ?`, event.kind, event.pubkey, d);
      return ADDRESSABLE_PUT_OK;
    }
    const json = JSON.stringify(event);
    if (json.length > (this.opts.addressableMaxBytes ?? ADDRESSABLE_MAX_BYTES)) return addressableRejected("too-large");
    if (!existing[0]) {
      const count = this.sql(`SELECT COUNT(*) AS n FROM addressable WHERE kind = ? AND pubkey = ?`, event.kind, event.pubkey);
      if ((count[0]?.n ?? 0) >= (this.opts.addressablePerAuthor ?? ADDRESSABLE_MAX_PER_AUTHOR)) return addressableRejected("address-quota");
    }
    const budget = this.opts.addressableBytesPerAuthor;
    if (budget !== void 0) {
      const used = this.sql(
        `SELECT COALESCE(SUM(LENGTH(json)), 0) AS n FROM addressable
         WHERE pubkey = ? AND NOT (kind = ? AND d = ?)`,
        event.pubkey,
        event.kind,
        d
      );
      if ((used[0]?.n ?? 0) + json.length > budget) return addressableRejected("byte-quota");
    }
    let eff = effectiveExpiration(event, nowSec, this.opts.addressableTtlSeconds ?? ADDRESSABLE_TTL_SECONDS);
    if (eff <= nowSec) return addressableRejected("expired");
    const placed = this.placeAddressable(event, d, json.length, prev?.len ?? 0, Number(prev?.borrowed ?? 0) === 1);
    if (placed === void 0) return addressableRejected("ceiling");
    const ttl = this.opts.borrowTtlSeconds ?? BORROW_TTL_SECONDS;
    if (placed.borrowed) eff = borrowedExpiration(eff, nowSec, ttl);
    this.sql(
      `INSERT OR REPLACE INTO addressable (kind, pubkey, d, id, created_at, expiration, json, borrowed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      event.kind,
      event.pubkey,
      d,
      event.id,
      event.created_at,
      eff,
      json,
      placed.borrowed ? 1 : 0
    );
    if (placed.borrowed) return { ok: true, borrowedTtlSec: ttl };
    const nearFull = nearFullGrade(placed.usedAfter, this.opts.addressableMaxTotalBytes, this.opts.nearFullPercent);
    return nearFull === void 0 ? ADDRESSABLE_PUT_OK : { ok: true, nearFull };
  }
  /**
   * 這顆 DO 放不放得下這筆離線留言、怎麼放（ADR-0367 §決策 2；SDK ADR 0042 的保底與溢位帶）。行為與記憶體版逐字對齊。
   * 回 undefined＝拒收；`borrowed`＝放進溢位帶。決策由 `capacity.ts` 的 `decideCapacity` 做，這裡只執行。
   *
   * 🔴 為什麼 FIFO 不夠：`enforceCap` 只對**真正的收件人**執行，而沒有 `p` 標籤的事件
   * 落在 `recipient = ''` ⇒ 那個桶原本只被 TTL 壓著，而遊戲的房間事件正是這個形狀。
   */
  placeOffline(size, copies, owners, nowSec) {
    const max = this.opts.offlineMaxTotalBytes;
    if (max === void 0) return { borrowed: false };
    const need = size * copies;
    let used = this.usedOfflineBytes();
    const guarantee = this.opts.guaranteeBytes;
    const band = overflowBand(max, this.opts.overflowRatio);
    let plan = [];
    const decision = decideCapacity({
      max,
      used,
      need,
      evicts: this.opts.ceilingEvicts === true,
      guarantee,
      band,
      planeBorrows: true,
      borrowed: () => this.borrowedOfflineBytes(),
      withinGuarantee: () => {
        const usage = this.ownerNormalUsage();
        return owners.every((o) => (usage.get(o) ?? 0) + size <= guarantee);
      },
      excessAvailable: () => {
        const usage = this.ownerNormalUsage();
        const mine = new Set(owners);
        const over = [...usage].filter(([o, n]) => n > guarantee && !mine.has(o)).map(([o]) => o);
        if (over.length === 0) return 0;
        const borrowedRows = new Set(
          this.sql(`SELECT rowid AS r FROM offline_msgs WHERE borrowed = 1`).map((row) => Number(row.r))
        );
        const list = JSON.stringify(over);
        const candidates = this.sql(
          `SELECT rowid AS r, recipient, CASE WHEN recipient = '' THEN pubkey ELSE recipient END AS o, bytes, created_at
           FROM offline_msgs
           WHERE recipient IN (SELECT value FROM json_each(?)) OR (recipient = '' AND pubkey IN (SELECT value FROM json_each(?)))
           ORDER BY expiration ASC, rowid ASC LIMIT ?`,
          list,
          list,
          EXCESS_CANDIDATES + borrowedRows.size
        ).filter((row) => !borrowedRows.has(Number(row.r))).map((row) => ({
          r: Number(row.r),
          owner: String(row.o),
          bytes: Number(row.bytes ?? 0),
          recipient: String(row.recipient),
          created: Number(row.created_at)
        }));
        const picked = pickExcess(candidates, usage, guarantee, used - this.borrowedOfflineBytes() + need - max);
        plan = picked.rows;
        return picked.freed;
      },
      borrowFitsPerKey: () => {
        const perKey = borrowPerKey(band, this.opts.borrowPerKeyBytes);
        return owners.every((o) => this.ownerBorrowedBytes(o) + size <= perKey);
      }
    });
    switch (decision.type) {
      case "fit":
        return { borrowed: false };
      case "borrow":
        return { borrowed: true };
      case "reject":
        return void 0;
      case "reclaim":
      case "excess": {
        const borrowedRows = this.sql(
          `SELECT rowid AS r, recipient, bytes, created_at FROM offline_msgs INDEXED BY idx_offline_borrowed
           WHERE borrowed = 1 ORDER BY expiration ASC, rowid ASC`
        );
        const dropped = [];
        const borrowedVictims = [];
        let room = used;
        for (const row of borrowedRows) {
          if (decision.type === "reclaim" && room + need <= max) break;
          borrowedVictims.push(row);
          room -= Number(row.bytes ?? 0);
        }
        const info = this.describeRows([
          ...borrowedVictims.map((row) => Number(row.r)),
          ...decision.type === "excess" ? plan.map((row) => row.r) : []
        ]);
        const batches = batchKeysOf(info);
        for (const row of borrowedVictims) {
          this.sql(`DELETE FROM offline_msgs WHERE rowid = ?`, Number(row.r));
          used -= Number(row.bytes ?? 0);
          if (this.offlineBorrowed !== void 0) this.offlineBorrowed -= Number(row.bytes ?? 0);
          dropped.push({ r: Number(row.r), recipient: String(row.recipient), created: Number(row.created_at) });
        }
        if (decision.type === "excess") {
          for (const row of plan) {
            this.sql(`DELETE FROM offline_msgs WHERE rowid = ?`, row.r);
            used -= row.bytes;
            this.ownerNormal?.set(row.owner, (this.ownerNormal.get(row.owner) ?? 0) - row.bytes);
            dropped.push(row);
          }
        }
        this.forgetRows(dropped.map((row) => info.get(row.r)));
        this.offlineUsed = used;
        this.recordDrops(dropped, nowSec);
        this.dropBatchMates(dropped.map((row) => batches.get(row.r)), nowSec);
        return { borrowed: false };
      }
      case "legacy": {
        const victims = this.sql(
          `SELECT rowid AS r, recipient, bytes, created_at FROM offline_msgs ORDER BY expiration ASC LIMIT 256`
        );
        const info = this.describeRows(victims.map((row) => Number(row.r)));
        const batches = batchKeysOf(info);
        const dropped = [];
        for (const row of victims) {
          if (used + need <= max) break;
          if (!this.sql(`SELECT 1 AS x FROM offline_msgs WHERE rowid = ?`, row.r).length) continue;
          this.sql(`DELETE FROM offline_msgs WHERE rowid = ?`, row.r);
          used -= Number(row.bytes ?? 0);
          dropped.push({ r: Number(row.r), recipient: String(row.recipient), created: Number(row.created_at) });
          this.forgetRows([info.get(Number(row.r))]);
          this.offlineUsed = used;
          used -= this.dropBatchMates([batches.get(Number(row.r))], nowSec);
        }
        this.forgetUsage(dropped.map((row) => info.get(row.r)));
        this.offlineUsed = used;
        this.recordDrops(dropped, nowSec);
        return used + need <= max ? { borrowed: false } : void 0;
      }
    }
  }
  /**
   * 可尋址那一側的同一套決策（ADR-0367 §決策 2；SDK ADR 0042）。行為與記憶體版逐字對齊。
   * `replacedLen`／`replacedBorrowed` 是**即將被取代**的那一列——它會被換掉，不該算進已用空間。
   */
  placeAddressable(event, d, size, replacedLen, replacedBorrowed) {
    const max = this.opts.addressableMaxTotalBytes;
    if (max === void 0) return { borrowed: false, usedAfter: 0 };
    if (size > max) return void 0;
    const total = this.sql(`SELECT COALESCE(SUM(LENGTH(json)), 0) AS n FROM addressable`)[0]?.n ?? 0;
    let used = total - replacedLen;
    const guarantee = this.opts.guaranteeBytes;
    const band = overflowBand(max, this.opts.overflowRatio);
    const sameAddress = (row) => Number(row.kind) === event.kind && row.pubkey === event.pubkey && row.d === d;
    let borrowedTotal;
    const borrowed = () => borrowedTotal ??= (Number(this.sql(`SELECT COALESCE(SUM(LENGTH(json)), 0) AS n FROM addressable WHERE borrowed = 1`)[0]?.n ?? 0) || 0) - (replacedBorrowed ? replacedLen : 0);
    let plan = [];
    const decision = decideCapacity({
      max,
      used,
      need: size,
      evicts: this.opts.ceilingEvicts === true,
      guarantee,
      band,
      planeBorrows: this.opts.addressableBorrows !== false,
      borrowed,
      withinGuarantee: () => {
        const mine = this.sql(
          `SELECT COALESCE(SUM(LENGTH(json)), 0) AS n FROM addressable
           WHERE pubkey = ? AND borrowed = 0 AND NOT (kind = ? AND d = ?)`,
          event.pubkey,
          event.kind,
          d
        );
        return (Number(mine[0]?.n ?? 0) || 0) + size <= guarantee;
      },
      excessAvailable: () => {
        const over = this.sql(
          `SELECT pubkey, SUM(LENGTH(json)) AS n FROM addressable
           WHERE borrowed = 0 AND pubkey != ? GROUP BY pubkey HAVING SUM(LENGTH(json)) > ?`,
          event.pubkey,
          guarantee
        );
        if (over.length === 0) return 0;
        const usage = new Map(over.map((row) => [String(row.pubkey), Number(row.n ?? 0)]));
        const candidates = this.sql(
          `SELECT kind, pubkey, d, LENGTH(json) AS len FROM addressable
           WHERE borrowed = 0 AND pubkey IN (SELECT value FROM json_each(?))
           ORDER BY expiration ASC, rowid ASC LIMIT ?`,
          JSON.stringify([...usage.keys()]),
          EXCESS_CANDIDATES
        ).map((row) => ({
          kind: Number(row.kind),
          pubkey: String(row.pubkey),
          d: String(row.d),
          owner: String(row.pubkey),
          bytes: Number(row.len ?? 0)
        }));
        const picked = pickExcess(candidates, usage, guarantee, used - borrowed() + size - max);
        plan = picked.rows;
        return picked.freed;
      },
      borrowFitsPerKey: () => {
        const mine = this.sql(
          `SELECT COALESCE(SUM(LENGTH(json)), 0) AS n FROM addressable
           WHERE borrowed = 1 AND pubkey = ? AND NOT (kind = ? AND d = ?)`,
          event.pubkey,
          event.kind,
          d
        );
        return (Number(mine[0]?.n ?? 0) || 0) + size <= borrowPerKey(band, this.opts.borrowPerKeyBytes);
      }
    });
    const drop = (kind, pubkey, dd) => {
      this.sql(`DELETE FROM addressable WHERE kind = ? AND pubkey = ? AND d = ?`, kind, pubkey, dd);
    };
    switch (decision.type) {
      case "fit":
        return { borrowed: false, usedAfter: used + size };
      case "borrow":
        return { borrowed: true, usedAfter: used + size };
      case "reject":
        return void 0;
      case "reclaim":
      case "excess": {
        const borrowedRows = this.sql(
          `SELECT kind, pubkey, d, LENGTH(json) AS len FROM addressable WHERE borrowed = 1 ORDER BY expiration ASC, rowid ASC`
        );
        for (const row of borrowedRows) {
          if (sameAddress(row)) continue;
          if (decision.type === "reclaim" && used + size <= max) break;
          drop(Number(row.kind), String(row.pubkey), String(row.d));
          used -= Number(row.len ?? 0);
        }
        if (decision.type === "excess") {
          for (const row of plan) {
            drop(row.kind, row.pubkey, row.d);
            used -= row.bytes;
          }
        }
        return { borrowed: false, usedAfter: used + size };
      }
      case "legacy": {
        const victims = this.sql(
          `SELECT kind, pubkey, d, LENGTH(json) AS len FROM addressable ORDER BY expiration ASC LIMIT 256`
        );
        for (const row of victims) {
          if (used + size <= max) break;
          drop(row.kind, row.pubkey, row.d);
          used -= row.len ?? 0;
        }
        return used + size <= max ? { borrowed: false, usedAfter: used + size } : void 0;
      }
    }
  }
  /**
   * 被刪掉的離線列記進丟棄計數（SDK ADR 0042；ADR 0038 M8）。
   *
   * 不計：沒開 `countDrops`、沒有收件人的列、收件人正在線上收收件匣（即時收到了）、
   * rowid 不超過那位收件人上次讀收件匣時的水位線（那時就在庫裡，已經送到過）。
   */
  recordDrops(rows, nowSec) {
    if (this.opts.countDrops !== true || rows.length === 0) return;
    const byRecipient = /* @__PURE__ */ new Map();
    for (const row of rows) {
      if (row.recipient === "") continue;
      const list = byRecipient.get(row.recipient);
      if (list) list.push(row);
      else byRecipient.set(row.recipient, [row]);
    }
    for (const [recipient, list] of byRecipient) {
      if (this.inboxProbe(recipient)) continue;
      const prev = this.sql(`SELECT count, since, until, mark FROM inbox_drops WHERE recipient = ?`, recipient)[0];
      const mark = Number(prev?.mark ?? 0);
      const counted = list.filter((row) => row.r > mark);
      if (counted.length === 0) continue;
      const created = counted.map((row) => row.created);
      const merged = mergeDropped(
        prev && Number(prev.count) > 0 ? { count: Number(prev.count), since: Number(prev.since), until: Number(prev.until) } : void 0,
        counted.length,
        Math.min(...created),
        Math.max(...created)
      );
      this.sql(
        `INSERT OR REPLACE INTO inbox_drops (recipient, count, since, until, mark, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        recipient,
        merged.count,
        merged.since,
        merged.until,
        mark,
        nowSec
      );
      if (prev === void 0) this.noteNewDropRow();
    }
  }
  /** 丟棄計數表多了一列：超過上限就刪最久沒更新的（收件人可以亂編，表不能無限長）。 */
  noteNewDropRow() {
    if (this.dropRows === void 0) this.dropRows = Number(this.sql(`SELECT COUNT(*) AS n FROM inbox_drops`)[0]?.n ?? 0);
    else this.dropRows += 1;
    if (this.dropRows > DROPPED_RECIPIENTS_MAX) {
      const extra = this.dropRows - DROPPED_RECIPIENTS_MAX;
      this.sql(
        `DELETE FROM inbox_drops WHERE recipient IN (SELECT recipient FROM inbox_drops ORDER BY updated_at ASC LIMIT ?)`,
        extra
      );
      this.dropRows = DROPPED_RECIPIENTS_MAX;
    }
  }
  /** 目前離線表的最大 rowid：丟棄計數的水位線（這之前存的都送到了）。 */
  deliveredMark() {
    return Number(this.sql(`SELECT COALESCE(MAX(rowid), 0) AS m FROM offline_msgs`)[0]?.m ?? 0);
  }
  takeDropped(recipient, nowSec) {
    if (this.opts.countDrops !== true) return void 0;
    const prev = this.sql(`SELECT count, since, until FROM inbox_drops WHERE recipient = ?`, recipient)[0];
    this.sql(
      `INSERT OR REPLACE INTO inbox_drops (recipient, count, since, until, mark, updated_at) VALUES (?, 0, NULL, NULL, ?, ?)`,
      recipient,
      this.deliveredMark(),
      nowSec
    );
    if (prev === void 0) {
      this.noteNewDropRow();
      return void 0;
    }
    const count = Number(prev.count ?? 0);
    return count > 0 ? { count, since: Number(prev.since), until: Number(prev.until) } : void 0;
  }
  markDelivered(recipient, nowSec) {
    if (this.opts.countDrops !== true) return;
    const prev = this.sql(`SELECT 1 AS x FROM inbox_drops WHERE recipient = ?`, recipient)[0];
    this.sql(
      `INSERT INTO inbox_drops (recipient, count, since, until, mark, updated_at) VALUES (?, 0, NULL, NULL, ?, ?)
       ON CONFLICT(recipient) DO UPDATE SET mark = excluded.mark, updated_at = excluded.updated_at`,
      recipient,
      this.deliveredMark(),
      nowSec
    );
    if (prev === void 0) this.noteNewDropRow();
  }
  /**
   * 查詢符合 filter 且未過期的留言。
   *
   * ## 為什麼過濾條件必須下推到 SQL（ADR-0235 C2）
   *
   * 修正前，沒有 `#p` 的 filter 會走
   * `SELECT json FROM offline_msgs WHERE expiration > ?`——**整張表**（所有使用者的離線留言）
   * 撈進記憶體、逐筆 `JSON.parse`，再於 JS 端 `matchFilter` 過濾。
   *
   * 而 `relay-core` 的 `scoped()` 明文允許「沒有 `#p`、但有 `authors`」的訂閱（ADR-0071 的
   * 快照查詢正是這個形狀），連 `authors: []` 都放行——它匹配不到任何事件，卻會完整跑一次
   * 全表掃描。也就是說 `{"authors":[]}` 是一個**零成本、零收穫、全代價**的 payload。
   * Durable Object 記憶體上限 128MB，而這是**單一全域房間**：重複送幾次就 OOM，全站掉線。
   *
   * 現在 `#p`／`authors`／`ids`／`kinds`／`since`／`until` 全部進 WHERE（有索引），並一律帶
   * `LIMIT`。`matchFilter` 仍是最終權威（`#e` 等標籤 filter 只能在 JS 判），但它現在跑在
   * **有界且已縮小**的候選集上。
   *
   * 「訂閱必須具名」則**不**在這一層——那是 `relay-core.scoped()` 的職責（ADR-0123）。
   * 儲存層若也擋，會讓「Ephemeral 不入庫」這類**否定斷言**變成恆真的空轉測試。
   * 這裡只負責一件事：**任何查詢的代價都有界**。
   */
  query(filter, nowSec, maxBytes) {
    const pValues = filter["#p"];
    const { authors, ids, kinds } = filter;
    if (pValues && pValues.length === 0 || authors && authors.length === 0 || ids && ids.length === 0) {
      return [];
    }
    if (tagFiltersOf(filter).some((t) => t.values.length === 0)) return [];
    const where = [];
    const bind = [];
    const push = (clause, values) => {
      where.push(clause);
      bind.push(...values);
    };
    if (pValues && pValues.length > 0) pushIn(where, bind, "recipient", pValues);
    if (authors && authors.length > 0) pushIn(where, bind, "pubkey", authors);
    if (ids && ids.length > 0) pushIn(where, bind, "id", ids);
    if (kinds && kinds.length > 0) pushIn(where, bind, "kind", kinds);
    if (filter.since !== void 0) push(`created_at >= ?`, [filter.since]);
    if (filter.until !== void 0) push(`created_at <= ?`, [filter.until]);
    pushTagClauses("offline_msgs", filter, where, bind);
    where.push(`(expiration IS NULL OR expiration > ?)`);
    bind.push(nowSec);
    const limit = queryLimit(filter.limit);
    const offline = this.boundedSelect(
      "offline_msgs",
      where.join(" AND "),
      bind,
      limit,
      "COALESCE(bytes, LENGTH(json))",
      maxBytes
    );
    let rows = offline.rows;
    if (!(pValues && pValues.length > 0)) {
      const aWhere = [`expiration > ?`];
      const aBind = [nowSec];
      if (authors && authors.length > 0) pushIn(aWhere, aBind, "pubkey", authors);
      if (ids && ids.length > 0) pushIn(aWhere, aBind, "id", ids);
      if (kinds && kinds.length > 0) pushIn(aWhere, aBind, "kind", kinds);
      pushTagClauses("addressable", filter, aWhere, aBind);
      const remaining = maxBytes === void 0 ? void 0 : maxBytes - offline.spent;
      rows = rows.concat(
        this.boundedSelect("addressable", aWhere.join(" AND "), aBind, limit, "LENGTH(json)", remaining).rows
      );
    }
    const events = dedupById(rows.map((r) => JSON.parse(r.json)));
    return events.filter((e) => matchFilter(filter, e)).slice(0, limit);
  }
  /**
   * 取出最新的列，但**累計大小不超過 `budget`**（ADR-0371 §決策 6）。沒給預算＝與過去相同。
   *
   * 🔴 為什麼要分兩步：`toArray()` 一次把結果全部搬進記憶體，而 DO 的記憶體上限是 128MB。
   * 一位收件人名下的檔案塊可能有上千顆、每顆約 131KB——一次 REQ 就是上百 MB，DO 當場重置。
   * 先只讀大小（分桶索引上就有）算出放得下幾列，再取那幾列的 json。
   * 排序多一個 `rowid` 當決勝，兩步才保證挑中的是同一批列。
   */
  boundedSelect(table, where, bind, limit, sizeExpr, budget) {
    const order = "ORDER BY created_at DESC, rowid DESC";
    if (budget === void 0) {
      return { rows: this.sql(`SELECT json FROM ${table} WHERE ${where} ${order} LIMIT ?`, ...bind, limit), spent: 0 };
    }
    const sizes = this.sql(`SELECT ${sizeExpr} AS n FROM ${table} WHERE ${where} ${order} LIMIT ?`, ...bind, limit);
    let take = 0;
    let spent = 0;
    for (const row of sizes) {
      const n = Number(row.n ?? 0);
      if (spent + n > budget) break;
      spent += n;
      take += 1;
    }
    if (take === 0) return { rows: [], spent: 0 };
    return { rows: this.sql(`SELECT json FROM ${table} WHERE ${where} ${order} LIMIT ?`, ...bind, take), spent };
  }
  prune(nowSec) {
    this.invalidateUsage();
    const borrowedBatches = this.sql(
      `SELECT recipient, batch FROM offline_msgs
       WHERE rowid IN (SELECT rowid FROM offline_msgs INDEXED BY idx_offline_borrowed
                       WHERE borrowed = 1 AND expiration IS NOT NULL AND expiration <= ?)
         AND batch IS NOT NULL`,
      nowSec
    ).map((row) => ({ recipient: String(row.recipient), batch: Number(row.batch) }));
    if (this.opts.countDrops === true) {
      const expired = this.sql(
        `SELECT rowid AS r, recipient, created_at FROM offline_msgs
         WHERE borrowed = 1 AND recipient != '' AND expiration IS NOT NULL AND expiration <= ?`,
        nowSec
      );
      this.recordDrops(
        expired.map((row) => ({ r: Number(row.r), recipient: String(row.recipient), created: Number(row.created_at) })),
        nowSec
      );
    }
    this.sql(`DELETE FROM offline_msgs WHERE expiration IS NOT NULL AND expiration <= ?`, nowSec);
    this.dropBatchMates(borrowedBatches, nowSec);
    this.sql(`DELETE FROM addressable WHERE expiration <= ?`, nowSec);
    this.sql(`DELETE FROM inbox_drops WHERE updated_at <= ?`, nowSec - (this.opts.maxTtlSeconds ?? DEFAULT_MAX_TTL_SECONDS));
    this.dropRows = void 0;
  }
  /**
   * NIP-62 清除（ADR-0260）：`pubkey = ?`（他發的）**或** `recipient = ?`（寄給他的
   * ——Gift Wrap 外層是一次性金鑰，`p` 是唯一能定位收件匣的鍵），外加他的可尋址事件。
   *
   * 兩欄都有索引（`idx_offline_pubkey`／`idx_offline_bucket` 的 recipient 前綴），故不是全表掃描。
   */
  /**
   * 收件確認（ADR-0380；SDK ADR 0067）：同 {@link OfflineStore.ackInbox}。走主鍵 `(id, recipient)`，不讀 json。
   * 「只寄給一人」以**庫裡還有沒有同 id、別的收件人的列**判斷（讀 json 的標籤要走溢位頁，檔案塊一顆約 131KB）。
   */
  ackInbox(recipient, ids, expiresAt, nowSec) {
    if (ids.length === 0) return 0;
    const set = inJson("id", ids);
    const where = `recipient = ? AND ${set.clause}
       AND (expiration IS NULL OR expiration > ?) AND (expiration IS NULL OR expiration > ?)
       AND NOT EXISTS (SELECT 1 FROM offline_msgs o2 WHERE o2.id = offline_msgs.id AND o2.recipient != ?)`;
    const binds = [recipient, set.binding, expiresAt, nowSec, recipient];
    const n = Number(this.sql(`SELECT COUNT(*) AS n FROM offline_msgs WHERE ${where}`, ...binds)[0]?.n ?? 0);
    if (n > 0) this.sql(`UPDATE offline_msgs SET expiration = ? WHERE ${where}`, expiresAt, ...binds);
    return n;
  }
  vanish(pubkey, _nowSec) {
    const rows = this.sql(
      `SELECT COUNT(DISTINCT id) AS n FROM offline_msgs WHERE pubkey = ? OR recipient = ?`,
      pubkey,
      pubkey
    );
    const msgs = Number(rows[0]?.n ?? 0);
    const addr = Number(
      this.sql(`SELECT COUNT(*) AS n FROM addressable WHERE pubkey = ?`, pubkey)[0]?.n ?? 0
    );
    this.invalidateUsage();
    this.sql(`DELETE FROM offline_msgs WHERE pubkey = ? OR recipient = ?`, pubkey, pubkey);
    this.sql(`DELETE FROM addressable WHERE pubkey = ?`, pubkey);
    this.sql(`DELETE FROM inbox_drops WHERE recipient = ?`, pubkey);
    this.dropRows = void 0;
    return msgs + addr;
  }
  /**
   * 這幾列的收件人、批次（SDK ADR 0085）與桶別：**以 rowid 逐列查**，只讀要刪的那幾列（ADR-0389）。
   *
   * 🔴 原本寫成 `INDEXED BY idx_offline_batch ... rowid IN (...)`，想「只讀索引、不碰 json 溢位頁」，
   * 但部分索引不是以 rowid 排序——SQLite 只能把整個索引掃一遍（每顆檔案塊都在裡面），
   * 塞滿的檔案車道每次淘汰讀約 4,400 列，2026-10-19 一小時把錨點 1 的讀取額度用完。
   * 改成 rowid 查詢：要讀這幾列在大表上的欄位（`batch`／`kind` 在 json 後面，要走溢位頁），但只有這幾列。
   */
  describeRows(rowids) {
    const out = /* @__PURE__ */ new Map();
    if (rowids.length === 0) return out;
    for (const row of this.sql(
      `SELECT rowid AS r, recipient, pubkey, bytes, borrowed, batch, kind FROM offline_msgs WHERE rowid IN (SELECT value FROM json_each(?))`,
      JSON.stringify(rowids)
    )) {
      out.set(Number(row.r), {
        recipient: String(row.recipient),
        owner: String(row.recipient) !== "" ? String(row.recipient) : String(row.pubkey ?? ""),
        bytes: Number(row.bytes ?? 0),
        borrowed: Number(row.borrowed) === 1,
        file: Number(row.kind) === FILE_WRAP_KIND,
        ...row.batch === null || row.batch === void 0 ? {} : { batch: Number(row.batch) }
      });
    }
    return out;
  }
  /**
   * 這幾列被刪掉了：借用量與每個人的正常列用量照實扣掉（ADR-0390）。原本整個作廢，
   * 下一次要判斷保底時以 `GROUP BY` 掃過整個分桶索引重建（塞滿的檔案車道每次約 4,200 列）。
   */
  forgetUsage(rows) {
    for (const row of rows) {
      if (row === void 0) continue;
      if (row.borrowed) {
        if (this.offlineBorrowed !== void 0) this.offlineBorrowed -= row.bytes;
      } else if (this.ownerNormal !== void 0) {
        this.ownerNormal.set(row.owner, (this.ownerNormal.get(row.owner) ?? 0) - row.bytes);
      }
    }
  }
  /** 這幾列被刪掉了：從各自那一桶的列數快取扣掉（沒快取的桶下次照舊重數）。ADR-0389 */
  forgetRows(rows) {
    for (const row of rows) {
      if (row === void 0) continue;
      const key = bucketKey(row.recipient, row.file);
      const count = this.bucketCounts.get(key);
      if (count !== void 0) this.bucketCounts.set(key, Math.max(0, count - 1));
    }
  }
  /**
   * 整批淘汰（SDK ADR 0085）：被刪掉的檔案塊所屬的那一批（同收件人、同 `batch`）其餘的列一起刪，回傳釋放的位元組；記進丟棄計數。
   * 只刪一部分會切出永遠收不齊的孤兒。行為與記憶體版逐字對齊。
   */
  dropBatchMates(keys, nowSec) {
    const unique = /* @__PURE__ */ new Map();
    for (const k of keys) if (k && k.recipient !== "") unique.set(`${k.recipient}
${k.batch}`, k);
    if (unique.size === 0) return 0;
    let freed = 0;
    const dropped = [];
    for (const { recipient, batch } of unique.values()) {
      const mates = this.sql(
        `SELECT rowid AS r, bytes, created_at, borrowed, pubkey FROM offline_msgs INDEXED BY idx_offline_batch WHERE recipient = ? AND batch = ?`,
        recipient,
        batch
      );
      if (mates.length === 0) continue;
      this.sql(`DELETE FROM offline_msgs WHERE recipient = ? AND batch = ?`, recipient, batch);
      const key = bucketKey(recipient, true);
      const count = this.bucketCounts.get(key);
      if (count !== void 0) this.bucketCounts.set(key, Math.max(0, count - mates.length));
      for (const m of mates) {
        freed += Number(m.bytes ?? 0);
        dropped.push({ r: Number(m.r), recipient, created: Number(m.created_at) });
      }
      this.forgetUsage(
        mates.map((m) => ({
          recipient,
          owner: recipient,
          bytes: Number(m.bytes ?? 0),
          borrowed: Number(m.borrowed) === 1,
          file: true
        }))
      );
    }
    if (freed > 0 && this.offlineUsed !== void 0) this.offlineUsed -= freed;
    this.recordDrops(dropped, nowSec);
    return freed;
  }
  /**
   * 分桶修剪（ADR-0162：檔案塊與聊天留言各自計數、各自由舊到新丟棄）。
   *
   * 只修剪**這次寫入落到的那一桶**：另一桶的列數沒變，不需要看（修正前兩桶每次都掃）。
   * 列數走快取，只有超量時才讀出要刪的那幾列——而且只讀 `idx_offline_bucket` 的索引項。
   */
  enforceCap(recipients, file, nowSec) {
    const limit = file ? this.opts.filePerRecipient ?? DEFAULT_FILE_PER_RECIPIENT : this.opts.maxPerRecipient;
    if (limit === void 0) return;
    const bucket = file ? `kind = ${FILE_WRAP_KIND}` : `kind != ${FILE_WRAP_KIND}`;
    for (const recipient of recipients) {
      if (recipient === "") continue;
      const key = bucketKey(recipient, file);
      let count = this.bucketCounts.get(key);
      if (count === void 0) {
        count = Number(
          this.sql(`SELECT COUNT(*) AS n FROM offline_msgs WHERE recipient = ? AND ${bucket}`, recipient)[0]?.n ?? 0
        );
      }
      if (count > limit) {
        const rows = this.sql(
          `SELECT rowid AS r, bytes, created_at FROM offline_msgs WHERE recipient = ? AND ${bucket}
           ORDER BY created_at ASC LIMIT ?`,
          recipient,
          count - limit
        );
        const info = this.describeRows(rows.map((row) => Number(row.r)));
        const batches = file ? batchKeysOf(info) : /* @__PURE__ */ new Map();
        for (const row of rows) {
          this.sql(`DELETE FROM offline_msgs WHERE rowid = ?`, row.r);
          if (this.offlineUsed !== void 0) this.offlineUsed -= Number(row.bytes ?? 0);
        }
        count -= rows.length;
        if (rows.length > 0) {
          this.forgetUsage(rows.map((row) => info.get(Number(row.r))));
          this.recordDrops(
            rows.map((row) => ({ r: Number(row.r), recipient, created: Number(row.created_at) })),
            nowSec
          );
          this.bucketCounts.set(key, count);
          this.dropBatchMates(rows.map((row) => batches.get(Number(row.r))), nowSec);
          count = this.bucketCounts.get(key) ?? count;
        }
      }
      this.bucketCounts.set(key, count);
    }
  }
};
function bucketKey(recipient, file) {
  return `${file ? "f" : "c"}:${recipient}`;
}
var EXCESS_CANDIDATES = 1024;
function batchKeysOf(info) {
  const out = /* @__PURE__ */ new Map();
  for (const [r, row] of info) if (row.batch !== void 0) out.set(r, { recipient: row.recipient, batch: row.batch });
  return out;
}

// ../../../AppData/Local/Temp/cinder-main-stores-9J0UC9/relay/src/conn-persistence.ts
var INLINE_BUDGET_BYTES = 12 * 1024;
var MAX_CONN_SUB_BYTES = 512 * 1024;
var ConnPersistence = class {
  constructor(sql) {
    this.sql = sql;
    this.sql(
      `CREATE TABLE IF NOT EXISTS ws_subs (
        conn_id TEXT NOT NULL,
        sub_id  TEXT NOT NULL,
        filters TEXT NOT NULL,
        PRIMARY KEY (conn_id, sub_id)
      )`
    );
  }
  persisted = /* @__PURE__ */ new Map();
  /**
   * 把某連線的最新狀態存起來；沒變就什麼都不做。
   *
   * 不拋例外：任何失敗都轉成 `rejected`，由呼叫方關掉那些訂閱並告訴客戶端。
   */
  save(ws, snap) {
    const prev = this.persisted.get(snap.connId);
    const sized = snap.subs.map((s) => ({ ...s, json: JSON.stringify(s.filters) }));
    const changed = (s) => prev?.subs.get(s.subId) !== s.json;
    const rejected = [];
    let total = sized.reduce((n, s) => n + s.json.length, 0);
    if (total > MAX_CONN_SUB_BYTES) {
      for (const c of sized.filter(changed).sort((a, b) => b.json.length - a.json.length)) {
        if (total <= MAX_CONN_SUB_BYTES) break;
        rejected.push({ subId: c.subId, reason: "too-large" });
        total -= c.json.length;
      }
    }
    const dropped = new Set(rejected.map((r) => r.subId));
    const kept = sized.filter((s) => !dropped.has(s.subId));
    try {
      this.write(ws, snap, kept, prev);
    } catch (err) {
      console.error(`ws 訂閱持久化失敗 conn=${snap.connId}（ADR-0373）`, err);
      for (const s of kept.filter(changed)) rejected.push({ subId: s.subId, reason: "persist-failed" });
    }
    return { rejected };
  }
  write(ws, snap, subs, prev) {
    const head = JSON.stringify({ ...snap, subs: [] }).length;
    let budget = INLINE_BUDGET_BYTES - head;
    const inline = [];
    const spill = /* @__PURE__ */ new Map();
    const bySize = [...subs].sort((a, b) => a.json.length - b.json.length || (a.subId < b.subId ? -1 : 1));
    for (const s of bySize) {
      const cost = s.json.length + s.subId.length + 32;
      if (cost <= budget) {
        inline.push({ subId: s.subId, filters: s.filters });
        budget -= cost;
      } else {
        spill.set(s.subId, s.json);
      }
    }
    const attachment = {
      ...snap,
      subs: inline,
      ...spill.size > 0 ? { spilled: [...spill.keys()].sort() } : {}
    };
    const attachmentJson = JSON.stringify(attachment);
    for (const [subId, json] of spill) {
      if (prev?.spilled.has(subId) && prev.subs.get(subId) === json) continue;
      this.sql(
        `INSERT INTO ws_subs (conn_id, sub_id, filters) VALUES (?, ?, ?)
         ON CONFLICT(conn_id, sub_id) DO UPDATE SET filters = excluded.filters`,
        snap.connId,
        subId,
        json
      );
    }
    if (prev?.attachment !== attachmentJson) ws.serializeAttachment(attachment);
    for (const subId of prev?.spilled ?? []) {
      if (!spill.has(subId)) this.sql(`DELETE FROM ws_subs WHERE conn_id = ? AND sub_id = ?`, snap.connId, subId);
    }
    this.persisted.set(snap.connId, {
      attachment: attachmentJson,
      subs: new Map(subs.map((s) => [s.subId, s.json])),
      spilled: new Set(spill.keys())
    });
  }
  /** 連線結束：清掉它的溢位列（有才刪——刪除也計入寫入列數）。 */
  remove(connId) {
    const prev = this.persisted.get(connId);
    this.persisted.delete(connId);
    if (prev && prev.spilled.size > 0) {
      try {
        this.sql(`DELETE FROM ws_subs WHERE conn_id = ?`, connId);
      } catch (err) {
        console.error(`ws 訂閱溢位列清除失敗 conn=${connId}（ADR-0373）`, err);
      }
    }
  }
  /**
   * 喚醒還原：讀所有存活連線的 attachment，補回溢位的訂閱，並**清掉孤兒列**
   *（連線已不在——例如部署重啟時 `webSocketClose` 沒被呼叫——或 attachment 已不再指著它）。
   *
   * 只有 attachment 記著溢位時才碰 storage：一般情況（沒有大訂閱）喚醒仍然零讀取（ADR-0059）。
   */
  load(sockets) {
    this.persisted.clear();
    const atts = [];
    for (const ws of sockets) {
      const att = ws.deserializeAttachment();
      if (att?.connId) atts.push(att);
    }
    const rows = this.readRows(atts);
    const snapshots = [];
    const lost = [];
    const referenced = /* @__PURE__ */ new Set();
    for (const att of atts) {
      const { spilled: spilledIds, ...rest } = att;
      const subs = [...att.subs];
      const spill = /* @__PURE__ */ new Map();
      const lostHere = lost.length;
      for (const subId of spilledIds ?? []) {
        const key = rowKey(att.connId, subId);
        const json = rows.get(key);
        if (json === void 0) {
          lost.push({ connId: att.connId, subId });
          continue;
        }
        referenced.add(key);
        spill.set(subId, json);
        subs.push({ subId, filters: JSON.parse(json) });
      }
      snapshots.push({ ...rest, subs });
      this.persisted.set(att.connId, {
        // 有遺失的 ⇒ 記成空字串，逼下一次 save 重寫 attachment，把溢位清單更正過來。
        attachment: lost.length > lostHere ? "" : JSON.stringify(att),
        subs: new Map([
          ...att.subs.map((s) => [s.subId, JSON.stringify(s.filters)]),
          ...spill
        ]),
        spilled: new Set(spill.keys())
      });
    }
    for (const key of rows.keys()) {
      if (referenced.has(key)) continue;
      const [connId, subId] = JSON.parse(key);
      try {
        this.sql(`DELETE FROM ws_subs WHERE conn_id = ? AND sub_id = ?`, connId, subId);
      } catch (err) {
        console.error(`ws 訂閱孤兒列清除失敗（ADR-0373）`, err);
      }
    }
    return { snapshots, lost };
  }
  /**
   * 讀溢位列。有任何 attachment 記著溢位就讀整張表（順便找出孤兒）；
   * 否則只問「表裡有沒有東西」——有就代表有孤兒要清，沒有就到此為止。
   */
  readRows(atts) {
    const out = /* @__PURE__ */ new Map();
    try {
      const anySpilled = atts.some((a) => (a.spilled?.length ?? 0) > 0);
      if (!anySpilled && this.sql(`SELECT 1 AS x FROM ws_subs LIMIT 1`).length === 0) return out;
      for (const r of this.sql(`SELECT conn_id, sub_id, filters FROM ws_subs`)) {
        out.set(rowKey(String(r.conn_id), String(r.sub_id)), String(r.filters));
      }
    } catch (err) {
      console.error(`ws 訂閱溢位列讀取失敗（ADR-0373）`, err);
    }
    return out;
  }
};
function rowKey(connId, subId) {
  return JSON.stringify([connId, subId]);
}
export {
  ConnPersistence,
  MessageStore,
  SqlMessageStore
};
