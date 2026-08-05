// 守衛掃描的目標檔（ADR-0332 階段 2b）。
//
// 🔴 本體從 `MobileApp.tsx` 搬到 `AppSession.tsx` 時，三支掃原始碼的守衛
// （perIdentityState／asyncEpoch／refScope）若還指著舊檔，就會**掃到一個幾乎空的外殼並全部變綠**
// ——那是這次搬家最容易發生、也最沒人會發現的事故。集中在這裡，改一次就好。
export const APP_SESSION_FILE = "AppSession.tsx";
