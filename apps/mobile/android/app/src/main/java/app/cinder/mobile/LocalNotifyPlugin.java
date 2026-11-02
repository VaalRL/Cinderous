package app.cinder.mobile;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * 訊息通知的 JS 橋（ADR-0410）：Android WebView 沒有 Web Notification API，
 * 前端的 `native/notify.ts` 在原生殼裡改呼叫這裡。
 *
 * <p>只用系統的本機通知，**不經任何第三方推播**。通知文字由前端在本機組好帶入
 * （i18n 與「隱藏預覽」都在前端決定），原生層不碰訊息內容以外的東西。
 *
 * <p>點通知會帶著對話鍵回到 {@link MainActivity}（singleTask），再以 {@code click}
 * 事件交給前端開啟該對話。
 */
@CapacitorPlugin(
        name = "LocalNotify",
        permissions = @Permission(strings = {Manifest.permission.POST_NOTIFICATIONS}, alias = LocalNotifyPlugin.PERM))
public class LocalNotifyPlugin extends Plugin {
    static final String PERM = "notifications";
    private static final String CHANNEL_ID = "cinderous_messages";
    static final String EXTRA_CONVO = "cinderousNotifyConvo";

    @Override
    public void load() {
        // App 被通知叫起來時（行程還在，但 Activity 重建）也要把點擊交給前端。
        deliverClick(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        deliverClick(intent);
    }

    private void deliverClick(Intent intent) {
        if (intent == null || !intent.hasExtra(EXTRA_CONVO)) return;
        JSObject data = new JSObject();
        String convo = intent.getStringExtra(EXTRA_CONVO);
        if (convo != null && !convo.isEmpty()) data.put("convo", convo);
        intent.removeExtra(EXTRA_CONVO); // 同一個 Intent 不重複觸發
        notifyListeners("click", data, true); // 前端還沒掛上監聽時先留著
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        // Android 13 以前沒有執行期通知權限，只看使用者有沒有在系統設定關掉。
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                || getPermissionState(PERM) == PermissionState.GRANTED) {
            resolveGranted(call);
            return;
        }
        requestPermissionForAlias(PERM, call, "permissionResult");
    }

    @PermissionCallback
    private void permissionResult(PluginCall call) {
        resolveGranted(call);
    }

    private void resolveGranted(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        call.resolve(ret);
    }

    @PluginMethod
    public void notify(PluginCall call) {
        Context ctx = getContext();
        if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) {
            call.resolve(); // 沒有權限就靜默略過，與 Web 路徑一致
            return;
        }
        createChannel(ctx);
        String convo = call.getString("convo", "");
        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        open.putExtra(EXTRA_CONVO, convo);
        // 每個對話一個 requestCode，PendingIntent 才不會互相覆蓋對話鍵。
        int code = convo.hashCode();
        PendingIntent pending = PendingIntent.getActivity(
                ctx, code, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setContentTitle(call.getString("title", "Cinderous"))
                .setContentText(call.getString("body", ""))
                .setSmallIcon(android.R.drawable.stat_notify_chat)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setAutoCancel(true)
                .setContentIntent(pending);
        try {
            // 同一個對話只留最新一則，不在通知列堆疊。
            NotificationManagerCompat.from(ctx).notify(code, b.build());
        } catch (SecurityException e) {
            // 權限在檢查後被撤銷：同樣靜默略過。
        }
        call.resolve();
    }

    private static void createChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "Messages", NotificationManager.IMPORTANCE_HIGH);
        nm.createNotificationChannel(channel);
    }
}
