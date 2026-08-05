// Android 保管庫的原生側紅線（ADR-0323）。
//
// 同 `android-backup.test.ts` 的理由：這些是**原生程式碼的紅線**，JS 測試碰不到，
// 但寫錯的後果是靜默的——沒有測試就沒人會發現。掃原始碼是這裡唯一擋得住的方式。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dir = new URL("../../android/app/src/main/java/app/cinder/mobile/", import.meta.url);
const PLUGIN = readFileSync(new URL("DeviceKeyStorePlugin.java", dir), "utf8");
const ACTIVITY = readFileSync(new URL("MainActivity.java", dir), "utf8");

describe("MainActivity 註冊（ADR-0323）", () => {
  it("🔴 必須註冊 DeviceKeyStorePlugin——沒註冊等於整個功能靜默不存在", () => {
    expect(ACTIVITY).toContain("registerPlugin(DeviceKeyStorePlugin.class)");
  });

  it("註冊在 super.onCreate() 之前（Bridge 才載得到，同 ForegroundPlugin）", () => {
    expect(ACTIVITY.indexOf("registerPlugin(DeviceKeyStorePlugin.class)")).toBeLessThan(
      // 找**呼叫**而非註解裡的「super.onCreate()」——上一行的說明剛好也含那串字。
      ACTIVITY.indexOf("super.onCreate(savedInstanceState)"),
    );
  });
});

describe("DeviceKeyStorePlugin 紅線（ADR-0323）", () => {
  it("🔴 解不開時 reject，不得 resolve 一個 null——那會讓引擎生新金鑰覆蓋（ADR-0122）", () => {
    expect(PLUGIN).toContain('call.reject("device-key-undecryptable"');
  });

  it("🔴 寫入用 commit() 而非 apply()——引擎會在這之後才抹掉舊的明文副本", () => {
    expect(PLUGIN).toContain(".commit()");
    expect(PLUGIN).not.toContain(".apply()");
  });

  it("🔴 寫入失敗要 reject，不得默默成功", () => {
    expect(PLUGIN).toContain('call.reject("device-key-write-failed")');
  });

  it("🔴 tier 不得寫死 keystore——沒有 TEE 的機型是軟體實作，只能算 encrypted", () => {
    expect(PLUGIN).toContain("isInsideSecureHardware()");
    expect(PLUGIN).toContain("SECURITY_LEVEL_SOFTWARE");
    expect(PLUGIN).toContain('out.put("tier", secure ? "keystore" : "encrypted")');
  });

  it("問不出等級時往低的講（不往高的猜）", () => {
    expect(PLUGIN).toMatch(/catch[^{]*\{\s*out\.put\("tier", "encrypted"\)/);
  });

  it("金鑰不可匯出：在 AndroidKeyStore 內產生，且要求隨機化加密", () => {
    expect(PLUGIN).toContain('KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)');
    expect(PLUGIN).toContain("setRandomizedEncryptionRequired(true)");
  });

  it("刻意不掛使用者驗證——掛了會讓「收訊息」變成要先解鎖", () => {
    expect(PLUGIN).not.toContain("setUserAuthenticationRequired(true)");
  });
});
