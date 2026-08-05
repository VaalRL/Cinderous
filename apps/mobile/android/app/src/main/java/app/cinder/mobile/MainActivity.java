package app.cinder.mobile;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 前台服務橋（ADR-0272/0274）：必須在 super.onCreate() 之前註冊，Bridge 才載得到。
        registerPlugin(ForegroundPlugin.class);
        // 裝置金鑰保管庫（ADR-0323）：沒註冊＝前端 `Plugins.DeviceKeyStore` 是 undefined
        // ⇒ 退回明文 KV，而設定頁會如實顯示 plaintext（不會靜默降級成假的「已保護」）。
        registerPlugin(DeviceKeyStorePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
