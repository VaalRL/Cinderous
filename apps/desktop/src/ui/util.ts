/** 由 pubkey 衍生一個穩定的頭像底色。 */
export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 40) % 360} 70% 45%))`;
}

/** 取顯示名稱的首字作為頭像文字。 */
export function initial(name: string): string {
  return [...name][0] ?? "?";
}

const EMO: Array<[RegExp, string]> = [
  [/:\)|:-\)/g, "🙂"],
  [/:D|:-D/g, "😃"],
  [/:\(|:-\(/g, "🙁"],
  [/;\)|;-\)/g, "😉"],
  [/:P|:-P/gi, "😛"],
  [/<3/g, "❤️"],
  [/\(Y\)/gi, "👍"],
  [/\(N\)/gi, "👎"],
  [/:O|:-O/gi, "😮"],
  [/\(L\)/gi, "💗"],
];

/** 把經典文字表情碼轉成 emoji。 */
export function emoticonize(text: string): string {
  let out = text;
  for (const [re, e] of EMO) out = out.replace(re, e);
  return out;
}

/** 表情選擇器用的 emoji 清單。 */
export const EMOTICONS = ["🙂", "😃", "😉", "😛", "😮", "😢", "😎", "👍", "❤️", "🎵", "🎉", "🐱"];
