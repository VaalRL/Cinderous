package app.cinder.mobile;

import android.content.Intent;
import android.os.Build;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 前台服務的 JS 橋（ADR-0272 / ADR-0274）：讓前端決定何時保住連線。
 *
 * <p>刻意**不**在 App 啟動時自動開——登入後才有連線可保，且使用者可於設定關閉
 * （常駐通知是有感的代價）。文案由前端帶入，維持 i18n 單一來源。
 */
@CapacitorPlugin(name = "Foreground")
public class ForegroundPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        Intent intent = new Intent(getContext(), ConnectionService.class);
        intent.putExtra(ConnectionService.EXTRA_TITLE, call.getString("title"));
        intent.putExtra(ConnectionService.EXTRA_TEXT, call.getString("text"));
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
            call.resolve();
        } catch (Exception e) {
            // 例如 Android 12+ 的背景啟動限制：不讓它變成前端的未捕捉例外，
            // 回報失敗即可（前端維持「未啟用」狀態，不假裝連線受保護）。
            call.reject("foreground-service-start-failed", e);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), ConnectionService.class));
        call.resolve();
    }
}
