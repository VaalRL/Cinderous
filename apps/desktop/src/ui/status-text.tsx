import type { ReactNode } from "react";
import { applyEmoticons } from "./emoticons.js";
import { renderMarkdown } from "./markdown.js";

/** 將狀態列文字渲染為 emoji + 行內格式（粗體/斜體/刪除線/行內碼/連結）。 */
export function renderStatus(text: string): ReactNode {
  return renderMarkdown(applyEmoticons(text));
}

/** 判斷文字是否含可渲染的表情或格式（供自我狀態預覽決定是否顯示）。 */
export function hasRichStatus(text: string): boolean {
  return applyEmoticons(text) !== text || /[*_~`]/.test(text) || /\[[^\]]+\]\(https?:\/\//.test(text);
}
