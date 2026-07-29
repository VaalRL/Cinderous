package app.cinder.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

/**
 * 前台服務（ADR-0272 的 Android 預設路徑）：讓 App 進背景後**行程不被系統回收**，
 * WebView 內的 WebSocket 得以維持與中繼的連線——**不需要任何第三方推播**。
 *
 * <p>這是 ADR-0272 定的 Android 預設：零第三方、代價是一條常駐通知。FCM 是 opt-in 的
 * 省電替代方案（尚未實作）。
 *
 * <p><b>foregroundServiceType 選用 specialUse</b>：Android 14 起必須宣告類型，而 Android 15
 * 把 {@code dataSync} 限制為每日 6 小時——對「維持長連線的通訊軟體」不適用。
 * {@code specialUse} 需在 manifest 附上用途說明（並於 Play 上架時聲明）。
 *
 * <p><b>誠實的限界</b>：本服務保證的是「行程活著」。WebView 在背景時 Chromium 仍可能節流
 * JS 計時器（同瀏覽器分頁背景節流，ADR-0113 已記）——**收訊是網路事件，通常不受計時器節流
 * 影響**，但確切行為依 Android 版本與 OEM 省電策略而異，必須以實機驗收（見 ADR-0274）。
 */
public class ConnectionService extends Service {
    private static final String CHANNEL_ID = "cinderous_connection";
    private static final int NOTIFICATION_ID = 1001;

    /** 由外部（Plugin）帶入的通知文案，讓文字走 i18n 而不是寫死在原生層。 */
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_TEXT = "text";

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String title = intent != null ? intent.getStringExtra(EXTRA_TITLE) : null;
        String text = intent != null ? intent.getStringExtra(EXTRA_TEXT) : null;
        createChannel();
        startForeground(NOTIFICATION_ID, buildNotification(
                title != null ? title : "Cinderous",
                text != null ? text : "Keeping your connection alive"));
        // 被系統殺掉後重建（但不重送 Intent——文案改用預設值即可）。
        return START_STICKY;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Connection",
                // LOW：不出聲、不震動——這條通知是「服務在跑」的狀態列，不是訊息通知。
                NotificationManager.IMPORTANCE_LOW);
        channel.setShowBadge(false);
        nm.createNotificationChannel(channel);
    }

    private Notification buildNotification(String title, String text) {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pending = PendingIntent.getActivity(this, 0, open, flags);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(text)
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setOngoing(true)
                .setShowWhen(false)
                .setContentIntent(pending)
                .build();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null; // 不提供繫結；只當前台服務用。
    }
}
