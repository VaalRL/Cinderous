// Android 系統備份必須關閉（ADR-0279）。
//
// 這條是**設定檔的紅線**，不是程式邏輯：`cap add android` 的樣板預設是
// `allowBackup="true"`，會把 app 私有目錄上傳到使用者的 Google Drive。
// 若哪天有人重跑 `cap add android`（ADR-0274 已記此風險），manifest 會被悄悄還原——
// 沒有測試就沒人會發現。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MANIFEST = new URL("../../android/app/src/main/AndroidManifest.xml", import.meta.url);
const RULES = new URL("../../android/app/src/main/res/xml/data_extraction_rules.xml", import.meta.url);

describe("AndroidManifest：系統備份（ADR-0279）", () => {
  const xml = readFileSync(MANIFEST, "utf8");

  it("🔴 allowBackup 必須是 false——true 等於把私有資料上傳 Google Drive", () => {
    expect(xml).toContain('android:allowBackup="false"');
    expect(xml).not.toContain('android:allowBackup="true"');
  });

  it("🔴 必須掛 dataExtractionRules——Android 12+ 的 allowBackup=false 擋不掉裝置間轉移", () => {
    expect(xml).toContain('android:dataExtractionRules="@xml/data_extraction_rules"');
  });
});

describe("data_extraction_rules：兩段都要排除（ADR-0279）", () => {
  const xml = readFileSync(RULES, "utf8");

  it("cloud-backup 與 device-transfer 兩段都在", () => {
    expect(xml).toContain("<cloud-backup>");
    expect(xml).toContain("<device-transfer>");
  });

  it("🔴 兩段都排除 root 與 external（各出現兩次＝兩段都有）", () => {
    expect(xml.match(/<exclude domain="root" \/>/g)).toHaveLength(2);
    expect(xml.match(/<exclude domain="external" \/>/g)).toHaveLength(2);
  });
});
