import { describe, expect, it } from "vitest";
import {
  DEFAULT_TITLEBAR_CONTROLS,
  parseTitlebarControls,
  placeControl,
  serializeTitlebarControls,
  type TitlebarControls,
} from "./titlebar-controls.js";

describe("titlebar-controls 標題列按鈕設定 v2（ADR-0150/0151）", () => {
  it("未設／壞 JSON／非物件 → 預設（⚙ 在最小化左側、同右帶、不隱藏；ADR-0152）", () => {
    expect(DEFAULT_TITLEBAR_CONTROLS).toEqual({ left: [], right: ["settings", "min", "max", "close"], autoHide: false, style: "flat" });
    expect(parseTitlebarControls(null)).toEqual(DEFAULT_TITLEBAR_CONTROLS);
    expect(parseTitlebarControls("")).toEqual(DEFAULT_TITLEBAR_CONTROLS);
    expect(parseTitlebarControls("{oops")).toEqual(DEFAULT_TITLEBAR_CONTROLS);
    expect(parseTitlebarControls("42")).toEqual(DEFAULT_TITLEBAR_CONTROLS);
  });

  it("v1 格式（ADR-0150 side/order）自動遷移：order 落在原側、⚙ 補在該帶最前（貼最小化左側）", () => {
    expect(parseTitlebarControls(JSON.stringify({ side: "right", order: ["close", "min", "max"] }))).toEqual({
      left: [],
      right: ["settings", "close", "min", "max"],
      autoHide: false,
      style: "flat",
    });
    expect(parseTitlebarControls(JSON.stringify({ side: "left", order: ["min", "max", "close"] }))).toEqual({
      left: ["settings", "min", "max", "close"],
      right: [],
      autoHide: false,
      style: "flat",
    });
  });

  it("v2 正規化：未知 id 剔除、跨帶去重（左優先）、缺漏補回（⚙ 補右帶最前、其餘補右帶尾）、autoHide 只認 true", () => {
    const c = parseTitlebarControls(
      JSON.stringify({ left: ["close", "nope", "settings"], right: ["close", "min"], autoHide: true }),
    );
    // close 在左帶先出現→右帶的重複剔除；max 缺漏→補右帶尾
    expect(c).toEqual({ left: ["close", "settings"], right: ["min", "max"], autoHide: true, style: "flat" });
    // ⚙ 缺漏 → 補右帶最前
    expect(parseTitlebarControls(JSON.stringify({ left: ["min"], right: ["max", "close"] }))).toEqual({
      left: ["min"],
      right: ["settings", "max", "close"],
      autoHide: false,
      style: "flat",
    });
    expect(parseTitlebarControls(JSON.stringify({ left: [], right: [], autoHide: "yes" })).autoHide).toBe(false);
  });

  it("按鈕風格（ADR-0167）：合法值原樣、未知/缺 → flat", () => {
    expect(parseTitlebarControls(JSON.stringify({ left: [], right: ["close"], style: "mac" })).style).toBe("mac");
    expect(parseTitlebarControls(JSON.stringify({ left: [], right: ["close"], style: "bogus" })).style).toBe("flat");
    expect(parseTitlebarControls(JSON.stringify({ left: [], right: ["close"] })).style).toBe("flat");
  });

  it("serialize → parse 往返不變", () => {
    const c: TitlebarControls = { left: ["close", "settings"], right: ["max", "min"], autoHide: true, style: "mac" };
    expect(parseTitlebarControls(serializeTitlebarControls(c))).toEqual(c);
  });

  it("0151 舊預設（⚙ 獨佔左帶）視為未自訂 → 轉新預設；autoHide 保留（ADR-0152）", () => {
    const old = JSON.stringify({ left: ["settings"], right: ["min", "max", "close"], autoHide: true });
    expect(parseTitlebarControls(old)).toEqual({ left: [], right: ["settings", "min", "max", "close"], autoHide: true, style: "flat" });
    // 使用者自訂過的左帶配置（順序不同）不受影響
    const custom = JSON.stringify({ left: ["settings"], right: ["close", "min", "max"], autoHide: false });
    expect(parseTitlebarControls(custom).left).toEqual(["settings"]);
  });

  it("placeControl：拖到某顆之前（同帶/跨帶）、拖到帶尾（beforeId=null）、自拖 no-op、純函式", () => {
    const base: TitlebarControls = { left: ["settings"], right: ["min", "max", "close"], autoHide: false, style: "flat" }; // 自訂配置（⚙ 已被拖到左帶）
    // 同帶：close 拖到 min 之前
    expect(placeControl(base, "close", "right", "min").right).toEqual(["close", "min", "max"]);
    // 跨帶：close 拖到左帶 settings 之前
    const cross = placeControl(base, "close", "left", "settings");
    expect(cross.left).toEqual(["close", "settings"]);
    expect(cross.right).toEqual(["min", "max"]);
    // 帶尾：settings 拖到右帶末端
    const tail = placeControl(base, "settings", "right", null);
    expect(tail.left).toEqual([]);
    expect(tail.right).toEqual(["min", "max", "close", "settings"]);
    // 自拖 no-op；未知 beforeId → 附加帶尾
    expect(placeControl(base, "min", "right", "min")).toEqual(base);
    expect(placeControl(base, "min", "left", "close").left).toEqual(["settings", "min"]);
    // 純函式：原物件不動
    expect(base.right).toEqual(["min", "max", "close"]);
  });
});
