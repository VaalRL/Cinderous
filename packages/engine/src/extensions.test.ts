import { describe, expect, it } from "vitest";
import { getExtension, listExtensions, registerExtension } from "./extensions.js";

describe("前端擴充註冊表（ADR-0074 K4 縫，實驗性）", () => {
  it("register/get/list；取消登記後消失；同 id 覆蓋", () => {
    const off = registerExtension({ id: "my.ext", name: "測試", render: () => "x" });
    expect(getExtension("my.ext")?.name).toBe("測試");
    expect(listExtensions().some((e) => e.id === "my.ext")).toBe(true);
    registerExtension({ id: "my.ext", name: "覆蓋" });
    expect(getExtension("my.ext")?.name).toBe("覆蓋");
    off();
    expect(getExtension("my.ext")).toBeUndefined();
  });
});
