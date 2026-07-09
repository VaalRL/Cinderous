import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AddIdentityModal } from "./App.js";

describe("AddIdentityModal", () => {
  it("relay 欄位預填目前作用中身分的網址（可改）", () => {
    const out = renderToStaticMarkup(
      <AddIdentityModal defaultRelayUrl="wss://relay.example" onAdd={() => {}} onCancel={() => {}} />,
    );
    expect(out).toContain('value="wss://relay.example"');
  });

  it("預設值為空字串時 relay 欄位維持空白且建立鈕停用", () => {
    const out = renderToStaticMarkup(
      <AddIdentityModal defaultRelayUrl="" onAdd={() => {}} onCancel={() => {}} />,
    );
    expect(out).toContain("disabled");
  });
});
