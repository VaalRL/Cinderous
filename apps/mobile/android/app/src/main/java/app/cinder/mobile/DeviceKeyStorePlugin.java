package app.cinder.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.security.KeyStore;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;

/**
 * 裝置金鑰的 Android 保管庫（ADR-0323）。
 *
 * <p>ADR-0322 的撤銷成立的**唯一前提**是「被移除那台的裝置私鑰拿不到」。這支外掛之前不存在，
 * 裝置金鑰明文躺在 MMKV／localStorage 裡 ⇒ 磁碟被複製即可繞過撤銷。
 *
 * <p><b>做法</b>：在 {@code AndroidKeyStore} 產一把**不可匯出**的 AES-256-GCM 金鑰，用它把 nsec
 * 加密後放進 SharedPreferences。落地的只有密文；解密金鑰在 Keystore 裡，有 TEE／StrongBox 的
 * 機型上連 root 也匯不出來。**刻意不引入新的第三方套件**（androidx.security 等）——
 * Keystore 本身就夠，少一個相依就少一條供應鏈。
 *
 * <p><b>刻意不設 {@code setUserAuthenticationRequired}</b>：這把金鑰要在開機/背景重連時就取得，
 * 掛上生物辨識會讓「收訊息」變成要解鎖，而它保護的東西（裝置身分）不值得那個代價。
 *
 * <p>🔴 <b>解不開時 reject，不回 null</b>：回 null 會讓引擎以為「還沒有金鑰」而**生一把新的覆蓋上去**
 * ——那正是 ADR-0122 禁止的「靜默把使用者換掉」。reject 會讓引擎落到 {@code ephemeral}（看得見）。
 */
@CapacitorPlugin(name = "DeviceKeyStore")
public class DeviceKeyStorePlugin extends Plugin {

    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String ALIAS = "cinder.deviceKey.v1";
    private static final String PREFS = "cinder.devicekey";
    private static final String ENTRY = "wrapped";
    private static final int IV_BYTES = 12; // GCM 標準長度
    private static final int TAG_BITS = 128;

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** 取（必要時產生）Keystore 內那把包裹金鑰。 */
    private SecretKey wrapKey() throws Exception {
        KeyStore ks = KeyStore.getInstance(KEYSTORE);
        ks.load(null);
        KeyStore.Entry entry = ks.getEntry(ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        }
        KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(
                        ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            // StrongBox（獨立安全晶片）優先；沒有的機型會丟 StrongBoxUnavailableException → 退回一般 TEE。
            try {
                gen.init(spec.setIsStrongBoxBacked(true).build());
                return gen.generateKey();
            } catch (Exception ignored) {
                gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
                spec.setIsStrongBoxBacked(false);
            }
        }
        gen.init(spec.build());
        return gen.generateKey();
    }

    @PluginMethod
    public void load(PluginCall call) {
        JSObject out = new JSObject();
        String stored = prefs().getString(ENTRY, null);
        if (stored == null) {
            out.put("value", (String) null); // 真的還沒有 → 引擎會生一把並存進來
            call.resolve(out);
            return;
        }
        try {
            byte[] blob = Base64.decode(stored, Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, wrapKey(), new GCMParameterSpec(TAG_BITS, blob, 0, IV_BYTES));
            byte[] plain = cipher.doFinal(blob, IV_BYTES, blob.length - IV_BYTES);
            out.put("value", new String(plain, "UTF-8"));
            call.resolve(out);
        } catch (Exception e) {
            // 有密文卻解不開＝Keystore 出事。**不得**謊報「沒有金鑰」（見類別註解）。
            call.reject("device-key-undecryptable", e);
        }
    }

    @PluginMethod
    public void save(PluginCall call) {
        String value = call.getString("value");
        if (value == null) {
            call.reject("device-key-missing-value");
            return;
        }
        try {
            byte[] iv = new byte[IV_BYTES];
            new SecureRandom().nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, wrapKey(), new GCMParameterSpec(TAG_BITS, iv));
            byte[] ct = cipher.doFinal(value.getBytes("UTF-8"));
            byte[] blob = new byte[iv.length + ct.length];
            System.arraycopy(iv, 0, blob, 0, iv.length);
            System.arraycopy(ct, 0, blob, iv.length, ct.length);
            // commit（非 apply）：引擎會在這之後才抹掉舊的明文副本，寫入必須真的落地過。
            boolean ok = prefs().edit().putString(ENTRY, Base64.encodeToString(blob, Base64.NO_WRAP)).commit();
            if (ok) call.resolve();
            else call.reject("device-key-write-failed");
        } catch (Exception e) {
            call.reject("device-key-save-failed", e);
        }
    }

    /**
     * 這把包裹金鑰**實際上**是不是硬體支援的。
     *
     * <p>🔴 沒有 TEE／StrongBox 的機型上，Keystore 是軟體實作 ⇒ 完整磁碟映像仍可能解得開，
     * 只能算 {@code encrypted}。把它一律講成 {@code keystore} 就是 ADR-0297 §6 紅線說的
     * 「用最強平台的說法涵蓋最弱平台的現實」。
     */
    @PluginMethod
    public void tier(PluginCall call) {
        JSObject out = new JSObject();
        try {
            SecretKey key = wrapKey();
            SecretKeyFactory factory = SecretKeyFactory.getInstance(key.getAlgorithm(), KEYSTORE);
            KeyInfo info = (KeyInfo) factory.getKeySpec(key, KeyInfo.class);
            boolean secure;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                secure = info.getSecurityLevel() != KeyProperties.SECURITY_LEVEL_SOFTWARE;
            } else {
                secure = info.isInsideSecureHardware();
            }
            out.put("tier", secure ? "keystore" : "encrypted");
        } catch (Exception e) {
            out.put("tier", "encrypted"); // 問不出來就往低的講，不往高的猜
        }
        call.resolve(out);
    }
}
