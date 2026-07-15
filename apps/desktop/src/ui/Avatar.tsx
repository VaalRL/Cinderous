import { type ChangeEvent, type CSSProperties, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n.js";
import { useDialog } from "./Dialog.js";
import { AVATAR_MAX_EDGE, downscaleImage, getAvatar, removeAvatar, setAvatar, subscribePersonalize } from "./personalize.js";
import { avatarColor, initial } from "./util.js";

/** 訂閱本地個人化變更（頭像/背景），變更時觸發重繪（ADR-0077）。 */
export function usePersonalizeTick(): void {
  const [, setV] = useState(0);
  useEffect(() => subscribePersonalize(() => setV((v) => v + 1)), []);
}

/** 頭像：有本地自訂圖用圖，否則沿用 pubkey 漸層底＋名字首字（ADR-0077 O2）。 */
export function Avatar({
  id,
  name,
  size,
  className,
  ring,
  onClick,
  editable,
}: {
  id: string;
  name: string;
  size?: number | undefined;
  className?: string | undefined;
  ring?: string | undefined;
  onClick?: (() => void) | undefined;
  editable?: boolean | undefined;
}): JSX.Element {
  const { t } = useI18n();
  usePersonalizeTick();
  const custom = getAvatar(id);
  const cls = ["avatar", className, ring, editable ? "avatar--edit" : ""].filter(Boolean).join(" ");
  const style: CSSProperties = {};
  if (size) {
    style.width = size;
    style.height = size;
  }
  const common = onClick
    ? { className: cls, onClick, role: "button" as const, title: editable ? t("avatar_change") : undefined }
    : { className: cls };
  if (custom) {
    return (
      <div
        {...common}
        style={{ ...style, backgroundImage: `url("${custom}")`, backgroundSize: "cover", backgroundPosition: "center" }}
        aria-label={name}
      />
    );
  }
  return (
    <div {...common} style={{ ...style, background: avatarColor(id) }}>
      {initial(name)}
    </div>
  );
}

/** 可編輯頭像（O2）：點擊彈出「更換／移除」小選單；換圖走本機縮圖 → localStorage，不外傳。 */
export function EditableAvatar({
  id,
  name,
  size,
  ring,
  className,
}: {
  id: string;
  name: string;
  size?: number;
  ring?: string;
  className?: string;
}): JSX.Element {
  const { t } = useI18n();
  const { alert } = useDialog();
  usePersonalizeTick();
  const [menu, setMenu] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const hasCustom = !!getAvatar(id);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menu]);
  const onFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const f = e.target.files?.[0];
    e.target.value = "";
    setMenu(false);
    if (!f) return;
    try {
      const uri = await downscaleImage(f, AVATAR_MAX_EDGE);
      if (!setAvatar(id, uri)) await alert(t("personalize_quota"));
    } catch {
      /* 圖片解碼失敗略過 */
    }
  };
  return (
    <div className="avatar-wrap" ref={wrapRef}>
      <Avatar id={id} name={name} size={size} ring={ring} className={className} editable onClick={() => setMenu((m) => !m)} />
      {menu ? (
        <div className="avatar-menu" role="menu">
          <button type="button" onClick={() => fileRef.current?.click()}>{t("avatar_change")}</button>
          {hasCustom ? (
            <button
              type="button"
              onClick={() => {
                removeAvatar(id);
                setMenu(false);
              }}
            >
              {t("avatar_remove")}
            </button>
          ) : null}
        </div>
      ) : null}
      <input ref={fileRef} type="file" accept="image/*" hidden data-testid="avatar-file" onChange={onFile} />
    </div>
  );
}
