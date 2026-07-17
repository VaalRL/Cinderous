// 身分層覆寫、回退裝置層的外觀偏好（ADR-0167）：主色/佈局/標題列可依身分各自設定。
//
// 讀：先讀 `nb.<pubkey>.<suffix>`（身分層覆寫），沒有才回退 `nb.<suffix>`（裝置層預設）。
// 寫：作用中有身分 → 寫身分層；無身分（登入前）→ 寫裝置層。純本地、不上雲、不隨快照。
//
// 主題/語言**刻意不走這裡**——它們比較像裝置偏好（整台一致），維持全域 `nb.theme`/`nb.locale`。

/** 讀當前作用中身分的 pubkey（無副作用地讀 nb.profiles.active；未登入回 null）。 */
export function activeIdentity(): string | null {
  try {
    const raw = localStorage.getItem("nb.profiles");
    if (!raw) return null;
    const s = JSON.parse(raw) as { active?: unknown };
    return typeof s.active === "string" && s.active ? s.active : null;
  } catch {
    return null;
  }
}

/** 讀外觀偏好：身分層覆寫優先，回退裝置層；皆無回 null。 */
export function scopedGet(suffix: string): string | null {
  try {
    const pk = activeIdentity();
    if (pk) {
      const v = localStorage.getItem(`nb.${pk}.${suffix}`);
      if (v !== null) return v;
    }
    return localStorage.getItem(`nb.${suffix}`);
  } catch {
    return null;
  }
}

/** 寫外觀偏好：有作用中身分 → 身分層；否則裝置層。 */
export function scopedSet(suffix: string, value: string): void {
  try {
    const pk = activeIdentity();
    localStorage.setItem(pk ? `nb.${pk}.${suffix}` : `nb.${suffix}`, value);
  } catch {
    /* 配額或不可用時忽略 */
  }
}

/** 清除外觀偏好：有作用中身分 → 只清身分層（回退裝置層）；否則清裝置層。 */
export function scopedRemove(suffix: string): void {
  try {
    const pk = activeIdentity();
    localStorage.removeItem(pk ? `nb.${pk}.${suffix}` : `nb.${suffix}`);
  } catch {
    /* 忽略 */
  }
}
