import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n.js";
import { useDialog } from "./Dialog.js";
import { usePersonalizeTick } from "./Avatar.js";
import { BG_PRESETS, CHATBG_MAX_EDGE, downscaleImage, getChatBg, removeChatBg, setChatBg } from "./personalize.js";

/** 對話背景設定入口（ADR-0077 O3）：內建預設色/漸層一鍵套用、或上傳本機圖片、或清除。 */
export function ChatBgPicker({ pubkey }: { pubkey: string }): JSX.Element {
  const { t } = useI18n();
  const { alert } = useDialog();
  usePersonalizeTick();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const current = getChatBg(pubkey);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const onFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const f = e.target.files?.[0];
    e.target.value = "";
    setOpen(false);
    if (!f) return;
    try {
      const uri = await downscaleImage(f, CHATBG_MAX_EDGE);
      if (!setChatBg(pubkey, { type: "image", value: uri })) await alert(t("personalize_quota"));
    } catch {
      /* 圖片解碼失敗略過 */
    }
  };
  return (
    <span className="bgpick" ref={wrapRef}>
      <span
        className="win__btn"
        role="button"
        title={t("chatbg_title")}
        data-testid="chatbg-btn"
        onClick={() => setOpen((o) => !o)}
      >
        🖼️
      </span>
      {open ? (
        <div className="bgpick__menu" role="menu">
          <div className="bgpick__grid">
            {BG_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`bgpick__swatch ${current?.type === "preset" && current.value === p.id ? "on" : ""}`}
                style={{ background: p.css }}
                title={p.id}
                aria-label={p.id}
                onClick={() => {
                  setChatBg(pubkey, { type: "preset", value: p.id });
                  setOpen(false);
                }}
              />
            ))}
          </div>
          <div className="bgpick__row">
            <button type="button" onClick={() => fileRef.current?.click()}>{t("chatbg_upload")}</button>
            {current ? (
              <button
                type="button"
                onClick={() => {
                  removeChatBg(pubkey);
                  setOpen(false);
                }}
              >
                {t("chatbg_clear")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <input ref={fileRef} type="file" accept="image/*" hidden data-testid="chatbg-file" onChange={onFile} />
    </span>
  );
}
