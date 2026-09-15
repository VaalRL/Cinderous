// 通話連線路徑晶片（ADR-0344）：這通走直連還是經 TURN 中繼。
//
// 為什麼通話特別值得顯示：ADR-0243 核可公共 TURN 的成本論證就是以通話為主體
// （「少數通話 × 小頻寬」），而經中繼同時也是「延遲偏高」最常見的解釋。
// 使用者與站方都該看得出來是哪幾通。

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CallState } from "@cinderous/core";
import type { IcePath } from "@cinderous/engine";
import { I18nProvider } from "../i18n.js";
import { CallWindow } from "./CallWindow.js";
import { p2pChipSpec } from "./p2p-chip.js";

const render = (state: CallState, icePath?: IcePath): string =>
  renderToStaticMarkup(
    <I18nProvider locale="zh-Hant">
      <CallWindow
        peerName="Bob"
        peerKey={"bb".repeat(32)}
        state={state}
        media="audio"
        localMedia="audio"
        remoteMedia="audio"
        canChangeMedia={false}
        onMediaChange={() => {}}
        quality="medium"
        onQualityChange={() => {}}
        onCameraChange={() => {}}
        localStream={null}
        remoteStream={null}
        {...(icePath !== undefined ? { icePath } : {})}
        onAccept={() => {}}
        onReject={() => {}}
        onHangup={() => {}}
      />
    </I18nProvider>,
  );

describe("通話連線路徑晶片（ADR-0344）", () => {
  it("通話中且為直連 → ⚡直連（綠）", () => {
    const html = render("active", "direct");
    expect(html).toContain('data-testid="call-path-chip"');
    expect(html).toContain("chip--p2p on");
    expect(html).toContain('data-p2p-path="direct"');
  });

  it("通話中且走 TURN → 🔁經中繼（琥珀），提示講的是延遲與中繼流量（不是大檔）", () => {
    const html = render("active", "relay");
    expect(html).toContain("chip--p2p relay");
    expect(html).toContain('data-p2p-path="relay"');
    expect(html).toContain("經中繼");
    // 通話情境的 tooltip 要談延遲，不能沿用對話那句「傳大檔請斟酌」。
    expect(html).toContain("延遲");
    expect(html).not.toContain("大檔");
  });

  it("通話中但路徑尚未測出 → 🔗已連線（中性），不假裝是直連", () => {
    const html = render("active", "unknown");
    expect(html).toContain("chip--p2p up");
    expect(html).not.toContain("chip--p2p on");
  });

  it("未帶 icePath（舊呼叫端）→ 同樣退回中性，不樂觀當成直連", () => {
    expect(render("active")).toContain("chip--p2p up");
  });

  it.each(["incoming", "outgoing", "connecting"] as CallState[])(
    "尚未接通（%s）不顯示晶片——接通前談路徑沒有意義",
    (state) => {
      expect(render(state, "relay")).not.toContain('data-testid="call-path-chip"');
    },
  );
});

describe("p2pChipSpec 情境切換（ADR-0344）", () => {
  it("同一個判定，對話與通話給不同的 tooltip", () => {
    expect(p2pChipSpec(true, "relay", "convo").hint).toBe("convo_p2pRelayHint");
    expect(p2pChipSpec(true, "relay", "call").hint).toBe("call_pathRelayHint");
  });

  it("短標籤與配色與情境無關（只有說明文字換句話）", () => {
    for (const path of ["direct", "relay", "unknown"] as IcePath[]) {
      const convo = p2pChipSpec(true, path, "convo");
      const call = p2pChipSpec(true, path, "call");
      expect(call.mod).toBe(convo.mod);
      expect(call.label).toBe(convo.label);
      expect(call.icon).toBe(convo.icon);
      expect(call.hint).not.toBe(convo.hint);
    }
  });

  it("預設情境為對話（既有呼叫端不帶第三個參數）", () => {
    expect(p2pChipSpec(true, "direct").hint).toBe("convo_p2pDirectHint");
  });
});
