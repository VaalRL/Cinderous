// QR 掃描的平台縫（ADR-0280）：用相機讀一個 QR，回傳解出的字串。
//
// ## 為什麼是 BarcodeDetector 而不是外掛或 JS 解碼器
//
// Chromium 的 **Shape Detection API**（`BarcodeDetector`）在 Android WebView 就有，
// 走系統的解碼器：零第三方相依、零原生程式碼、零 APK 體積。這與 ADR-0274 選 Capacitor
// 的理由一致——能用瀏覽器 API 解決的就不要拉原生依賴（`@capacitor/camera` 當初就是
// 因為硬吃 Java 21 而被移除的）。
//
// ## 誠實的限界
//
// `BarcodeDetector` **不保證存在**：iOS Safari 沒有，部分 Android 裝置需要 Google Play
// 服務的條碼模組。所以 {@link qrScanSupported} 會據實回報，呼叫端**不支援就不顯示掃描鈕**
// ——貼上 npub 的手動路徑永遠在，掃描只是加速。
//
// 這裡刻意不做「假裝支援然後掃不到」的降級：掃不到卻一直轉圈，比沒有按鈕更糟。
//
// 相機串流用完一定要關（`stopTracks`）——否則鏡頭指示燈會一直亮，那是很嚴重的隱私觀感問題。

/** Shape Detection API 的最小型別（TS 標準庫尚未內建）。 */
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
interface BarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

function ctor(): BarcodeDetectorCtor | undefined {
  return (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
}

/** 此環境是否掃得了 QR（＝有 BarcodeDetector 且有相機 API）。 */
export function qrScanSupported(): boolean {
  return !!ctor() && !!globalThis.navigator?.mediaDevices?.getUserMedia;
}

/** 關掉串流的所有軌道——鏡頭指示燈得跟著熄。 */
function stopTracks(stream: MediaStream | null): void {
  for (const t of stream?.getTracks() ?? []) t.stop();
}

/** 掃描結果：解出字串、使用者取消、或失敗（權限拒絕、無相機）。 */
export type QrScanResult = { ok: true; text: string } | { ok: false; reason: "cancelled" | "failed" };

/**
 * 開相機掃一個 QR。
 *
 * `video` 由呼叫端提供並顯示（預覽畫面必須看得到——盲掃體驗極差）；本函式只負責
 * 接串流、輪詢解碼、結束時收拾。`signal` 中止即視為使用者取消。
 *
 * 解碼失敗不算錯誤（畫面裡還沒有 QR 很正常），繼續輪詢直到掃到或被中止。
 */
export async function scanQr(video: HTMLVideoElement, signal: AbortSignal): Promise<QrScanResult> {
  const Ctor = ctor();
  if (!Ctor || !navigator.mediaDevices?.getUserMedia) return { ok: false, reason: "failed" };

  let stream: MediaStream | null = null;
  try {
    // 後鏡頭（environment）：掃別人手機上的 QR 用後鏡頭才合理。
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  } catch {
    return { ok: false, reason: "failed" }; // 權限被拒或無相機
  }

  try {
    video.srcObject = stream;
    await video.play().catch(() => {});
    const detector = new Ctor({ formats: ["qr_code"] });
    while (!signal.aborted) {
      try {
        const found = await detector.detect(video);
        const text = found[0]?.rawValue?.trim();
        if (text) return { ok: true, text };
      } catch {
        /* 這一幀解不出來很正常（模糊、沒對到、還沒 metadata）——繼續下一幀 */
      }
      await new Promise((r) => setTimeout(r, 200)); // ~5fps 足夠且省電
    }
    return { ok: false, reason: "cancelled" };
  } finally {
    stopTracks(stream);
    video.srcObject = null;
  }
}
