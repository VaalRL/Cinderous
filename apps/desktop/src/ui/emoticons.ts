/**
 * 文字表情符號（emoticon）短碼 → Unicode emoji 轉換。
 *
 * 採用 Unicode emoji（非任何專有貼圖資產），重現 MSN 打 `:)` 自動變笑臉的體感。
 * 以字面子字串替換（split/join），毋須跳脫正則；較長的短碼排在前面，
 * 且彼此無子字串重疊（如 `:-)` 不含 `:)`），故替換順序安全。
 */
export const EMOTICONS: ReadonlyArray<readonly [string, string]> = [
  ["<3", "❤️"],
  [":'(", "😢"],
  [":-)", "🙂"],
  [":)", "🙂"],
  [":-D", "😄"],
  [":D", "😄"],
  [";-)", "😉"],
  [";)", "😉"],
  [":-(", "🙁"],
  [":(", "🙁"],
  [":-P", "😛"],
  [":P", "😛"],
  [":-p", "😛"],
  [":p", "😛"],
  [":-O", "😮"],
  [":O", "😮"],
  ["B-)", "😎"],
  ["8)", "😎"],
  [":|", "😐"],
  ["(y)", "👍"],
  ["(n)", "👎"],
  ["XD", "😆"],
  ["xD", "😆"],
];

/** 將文字中的表情短碼替換為 emoji。 */
export function applyEmoticons(text: string): string {
  let out = text;
  for (const [code, emoji] of EMOTICONS) {
    if (out.includes(code)) out = out.split(code).join(emoji);
  }
  return out;
}
