import { describe, expect, it } from "vitest";
import {
  DEFAULT_TITLEBAR_CONTROLS,
  parseTitlebarControls,
  placeControl,
  serializeTitlebarControls,
  type TitlebarControls,
} from "./titlebar-controls.js";

describe("titlebar-controls 標題列按鈕設定 v2（ADR-0150/0151）", () => {
  it("未設／壞 JSON／非物件 → 預設（⚙ 靠左、─ □ ✕ 靠右、不隱藏）", () => {
    expect(DEFAULT_TITLEBAR_CONTROLS).toEqual({ left: ["settings"], right: ["min", "max", "close"], autoHide: false });
    expect(parseTitlebarControls(null)).toEqual(DEFAULT_TITLEBAR_CONTROLS);
    expect(parseTitlebarControls("")).toEqual(DEFAULT_TITLEBAR_CONTROLS);
    expect(parseTitlebarControls("{oops")).toEqual(DEFAULT_TITLEBAR_CONTROLS);
    expect(parseTitlebarControls("42")).toEqual(DEFAULT_TITLEBAR_CONTROLS);
  });

  it("v1 格式（ADR-0150 side/order）自動遷移：order 落在原側、⚙ 補到對側", () => {
    expect(parseTitlebarControls(JSON.stringify({ side: "right", order: ["close", "min", "max"] }))).toEqual({
      left: ["settings"],
      right: ["close", "min", "max"],
      autoHide: false,
    });
    expect(parseTitlebarControls(JSON.stringify({ side: "left", order: ["min", "max", "close"] }))).toEqual({
      left: ["min", "max", "close"],
      right: ["settings"],
      autoHide: false,
    });
  });

  it("v2 正規化：未知 id 剔除、跨帶去重（左優先）、缺漏補回預設帶、autoHide 只認 true", () => {
    const c = parseTitlebarControls(
      JSON.stringify({ left: ["close", "nope", "settings"], right: ["close", "min"], autoHide: true }),
    );
    // close 在左帶先出現→右帶的重複剔除；max 缺漏→補回預設帶（右）
    expect(c).toEqual({ left: ["close", "settings"], right: ["min", "max"], autoHide: true });
    expect(parseTitlebarControls(JSON.stringify({ left: [], right: [], autoHide: "yes" })).autoHide).toBe(false);
  });

  it("serialize → parse 往返不變", () => {
    const c: TitlebarControls = { left: ["close", "settings"], right: ["max", "min"], autoHide: true };
    expect(parseTitlebarControls(serializeTitlebarControls(c))).toEqual(c);
  });

  it("placeControl：拖到某顆之前（同帶/跨帶）、拖到帶尾（beforeId=null）、自拖 no-op、純函式", () => {
    const base: TitlebarControls = { left: ["settings"], right: ["min", "max", "close"], autoHide: false };
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
