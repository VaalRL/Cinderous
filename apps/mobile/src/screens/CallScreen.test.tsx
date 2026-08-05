import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CallScreen } from "./CallScreen.js";

const base = {
  peerName: "Amy",
  media: "audio" as const,
  localStream: null,
  remoteStream: null,
  onAccept: () => {},
  onReject: () => {},
  onHangup: () => {},
  quality: "medium" as const,
  onQualityChange: () => {},
  localMedia: "audio" as const,
  remoteMedia: "audio" as const,
  canChangeMedia: false,
  onMediaChange: () => {},
  locale: "zh-Hant" as const,
};

const render = (extra: Partial<Parameters<typeof CallScreen>[0]> = {}) =>
  renderToStaticMarkup(<CallScreen {...base} state="active" {...extra} />);

describe("行動端通話畫面（ADR-0101）", () => {
  it("來電：顯示接聽與拒接（不顯示靜音/掛斷）", () => {
    const html = render({ state: "incoming" });
    expect(html).toContain("接聽"); // call_accept
    expect(html).toContain("拒接"); // call_reject
    expect(html).not.toContain("掛斷"); // call_hangup
  });

  it("通話中：顯示靜音與掛斷（不顯示接聽）", () => {
    const html = render({ state: "active" });
    expect(html).toContain("掛斷");
    expect(html).not.toContain("接聽");
  });

  it("撥出中：顯示對方名稱與狀態", () => {
    const html = render({ state: "outgoing" });
    expect(html).toContain("Amy");
    expect(html).toContain("撥號中"); // call_outgoing
  });

  it("語音通話：不渲染視訊元素（只掛不可見的音訊播放槽）", () => {
    const html = render({ state: "active", media: "audio" });
    expect(html).not.toContain("<video");
    expect(html).toContain("<audio");
  });

  it("視訊通話：渲染遠端視訊", () => {
    // ADR-0338 起「要不要渲染遠端視訊」看的是**對方那一方**（remoteMedia），
    // 不是通話的有效型態——他只送語音時就該顯示頭像而非黑畫面。
    const html = render({ state: "active", media: "video", remoteMedia: "video" });
    expect(html).toContain("<video");
  });
});
