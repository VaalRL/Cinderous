package app.cinder.mobile;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 前台服務橋（ADR-0272/0274）：必須在 super.onCreate() 之前註冊，Bridge 才載得到。
        registerPlugin(ForegroundPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
