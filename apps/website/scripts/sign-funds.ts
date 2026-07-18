// 官方資金透明度簽章工具（ADR-0090）——「後台＝流程而非伺服器」。
// 流程：離線編輯 funds 草稿 JSON → 以**透明度金鑰**簽 → 寫 public/funds.json → 提交/發佈。
// 無 DB、無 API、無登入面板；CDN/host 被入侵也改不動數字（改了前端驗簽即失敗）。
//
// 用法（需能執行 TS＋workspace 的 runner，如 tsx）：
//   TRANSPARENCY_NSEC=nsec1... FUNDS_DRAFT=funds.draft.json tsx scripts/sign-funds.ts
// funds.draft.json 形狀＝ FundsData（balance/currency/monthlyBurn/updatedAt/allocations）。
import { readFileSync, writeFileSync } from "node:fs";
import { nsecDecode } from "@cinderous/core";
import { type FundsData, signFunds } from "../src/funds.js";

const nsec = process.env.TRANSPARENCY_NSEC;
if (!nsec) throw new Error("需要環境變數 TRANSPARENCY_NSEC（專屬透明度金鑰的 nsec）");
const draftPath = process.env.FUNDS_DRAFT ?? "funds.draft.json";
const data = JSON.parse(readFileSync(draftPath, "utf8")) as FundsData;
const event = signFunds(data, nsecDecode(nsec));
writeFileSync("public/funds.json", `${JSON.stringify(event, null, 2)}\n`);
console.log(`已簽章寫入 public/funds.json（pubkey=${event.pubkey}）`);
console.log("提醒：務必把 pubkey 與 src/funds.ts 的 TRANSPARENCY_PUBKEY 一致。");
