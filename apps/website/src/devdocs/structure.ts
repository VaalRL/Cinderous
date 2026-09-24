// 開發者文件的頁面結構（ADR-0368）：只有 slug 與分節，不含內容。
//
// 路由（`routes.ts`）要知道有哪些子頁，但不該為此載入整份雙語內容——結構與內容分開，
// 路由只依賴這一份。版面仿 Material for MkDocs 的文件站（左側分節導覽、右側本頁目錄、
// 底部上一頁／下一頁），第一頁「總覽」沒有 slug，就是 `/developers/` 本身。

/** 導覽的分節（順序即顯示順序）。 */
export const DEV_DOC_SECTIONS = [
  { id: "start", pages: ["quick-start", "app-id"] },
  {
    id: "reference",
    pages: ["endpoints", "subscriptions", "authentication", "retention", "limits", "proof-of-work", "relay-info"],
  },
  { id: "help", pages: ["errors", "faq", "resources"] },
] as const;

export type DevDocSectionId = (typeof DEV_DOC_SECTIONS)[number]["id"];

/** 子頁的 slug（總覽頁沒有 slug）。 */
export type DevDocSlug = (typeof DEV_DOC_SECTIONS)[number]["pages"][number];

/** 全部子頁，依導覽順序。 */
export const DEV_DOC_SLUGS: readonly DevDocSlug[] = DEV_DOC_SECTIONS.flatMap((s) => [...s.pages]);

export function isDevDocSlug(value: string): value is DevDocSlug {
  return (DEV_DOC_SLUGS as readonly string[]).includes(value);
}

/**
 * 導覽順序中的前一頁與後一頁（`undefined`＝總覽頁）。
 * 回傳 `null` 表示沒有那一頁（總覽沒有上一頁、最後一頁沒有下一頁）。
 */
export function neighborsOf(slug: DevDocSlug | undefined): {
  prev: DevDocSlug | undefined | null;
  next: DevDocSlug | undefined | null;
} {
  const order: (DevDocSlug | undefined)[] = [undefined, ...DEV_DOC_SLUGS];
  const i = order.indexOf(slug);
  return {
    prev: i > 0 ? order[i - 1] : null,
    next: i < order.length - 1 ? order[i + 1] : null,
  };
}
