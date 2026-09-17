// 行動端的合集列（ADR-0355）：收到 `.tar` 時列出內容，支援的瀏覽器還能直接解開。
//
// ## 為什麼要有「列出內容」
//
// 合集在聊天裡只是一個檔名與一個總大小。收件人看不出裡面是三個檔還是三千個，也看不出
// 是不是自己要的東西——唯一的選擇是先下載再說。tar 的結構讓列表很便宜：每個項目是
// 「512 標頭 ＋ 內容補到 512 倍數」，讀完一個標頭就能跳過整段內容，所以列一千個檔只要
// 讀一千個 512 位元組的區塊，而且**全在本機，不連網**。
//
// ## 為什麼解包是有條件的
//
// `showDirectoryPicker()` 是 Chromium 系才有的（Firefox、Safari 沒有）。所以能力先問過：
// 有就給按鈕，沒有就說「請用系統的解壓縮工具打開」——而不是給一顆按了沒反應的按鈕。

import { useState } from "react";
import { listTar, type TarListEntry } from "@cinderous/core";
import { blobReader, canExtractToDirectory, extractBlobToDirectory, formatBytes } from "@cinderous/engine";
import type { ChatMessage } from "@cinderous/engine";
import { type MessageKey, translate, type Locale } from "@cinderous/i18n";
import { Pressable, Text, View } from "react-native-web";
import type { ThemeTokens } from "@cinderous/theme";

/** 一次最多列出幾個檔名（再多就只報總數——這是預覽，不是檔案總管）。 */
const LIST_MAX = 50;

/** 合集的判定：副檔名或 MIME 任一命中（對方宣告的 MIME 不一定可信）。 */
export function isBundleMessage(m: ChatMessage): boolean {
  const f = m.file;
  if (!f || !f.incoming || !f.url) return false; // 沒有本機位元組就無從列起（ADR-0093）
  return f.name.toLowerCase().endsWith(".tar") || f.mime === "application/x-tar";
}

/** 取回這個合集的位元組把手。`fetch(blobUrl)` 不會把它讀進記憶體，只是拿到 `Blob`。 */
async function blobOf(url: string): Promise<Blob> {
  return await (await fetch(url)).blob();
}

export function BundleRow({
  url,
  tk,
  locale,
  testID,
}: {
  url: string;
  tk: ThemeTokens;
  locale: Locale;
  testID?: string;
}): JSX.Element {
  const t = (key: MessageKey, vars?: Record<string, string | number>): string => translate(locale, key, vars);
  const [entries, setEntries] = useState<TarListEntry[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const canExtract = canExtractToDirectory();

  const list = (): void => {
    setBusy(true);
    setNote("");
    void blobOf(url)
      .then(async (b) => await listTar(blobReader(b), b.size))
      .then(setEntries)
      .catch((e: unknown) => setNote(t("bundle_listFailed", { reason: e instanceof Error ? e.message : String(e) })))
      .finally(() => setBusy(false));
  };

  const extract = (): void => {
    setBusy(true);
    setNote("");
    void blobOf(url)
      .then(async (b) => await extractBlobToDirectory(b))
      .then((res) => {
        if (!res) return; // 使用者取消選資料夾
        const lines = [t("bundle_extractDoneHere", { files: res.files })];
        if (res.skipped.length > 0) lines.push(t("bundle_extractSkipped", { count: res.skipped.length }));
        setNote(lines.join(" "));
      })
      .catch((e: unknown) => setNote(t("bundle_listFailed", { reason: e instanceof Error ? e.message : String(e) })))
      .finally(() => setBusy(false));
  };

  const shown = entries?.slice(0, LIST_MAX) ?? [];
  return (
    <View style={{ marginTop: 4, gap: 2 }} testID={testID ?? "bundle"}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable accessibilityRole="button" onPress={list} disabled={busy} testID="bundle-list">
          <Text style={{ fontSize: 12, color: tk.accent }}>🗂 {t("bundle_list")}</Text>
        </Pressable>
        {canExtract ? (
          <Pressable accessibilityRole="button" onPress={extract} disabled={busy} testID="bundle-extract">
            <Text style={{ fontSize: 12, color: tk.accent }}>
              📂 {busy ? t("bundle_extracting") : t("bundle_extract")}
            </Text>
          </Pressable>
        ) : (
          <Text style={{ fontSize: 11, color: tk.muted }} testID="bundle-unsupported">
            {t("bundle_extractUnsupported")}
          </Text>
        )}
      </View>
      {note ? (
        <Text style={{ fontSize: 11, color: tk.muted }} testID="bundle-note">
          {note}
        </Text>
      ) : null}
      {entries ? (
        entries.length === 0 ? (
          <Text style={{ fontSize: 11, color: tk.muted }}>{t("bundle_listEmpty")}</Text>
        ) : (
          <View testID="bundle-entries">
            {shown.map((e) => (
              <Text key={e.path} style={{ fontSize: 11, color: tk.muted }} numberOfLines={1}>
                {e.path} · {formatBytes(e.size)}
              </Text>
            ))}
            {entries.length > LIST_MAX ? (
              <Text style={{ fontSize: 11, color: tk.muted }}>
                {t("bundle_more", { count: entries.length - LIST_MAX })}
              </Text>
            ) : null}
          </View>
        )
      ) : null}
    </View>
  );
}
