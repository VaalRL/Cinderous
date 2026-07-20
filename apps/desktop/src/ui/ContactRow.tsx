import { useState } from "react";
import type { Status } from "@cinderous/engine";
import { useI18n } from "../i18n.js";
import { useDialog } from "./Dialog.js";
import { renderStatus } from "./status-text.js";

/**
 * 聯絡人列副線內容（ADR-0214，情境切換）——經典版與三欄版共用的單一真實來源：
 *   1) 有未讀 → 末則預覽（優先讓你看到待讀）
 *   2) 否則 正在聽 → nowPlaying（♪ 由呈現層加）
 *   3) 否則 狀態訊息（富狀態 :emoji: 由 renderStatus 呈現）
 *   4) 否則 有對話史 → 末則預覽（閒置聯絡人仍保留脈絡）
 *   5) 皆空 → none（留白）
 */
export type RowSecondary =
  | { kind: "none" }
  | { kind: "preview"; text: string }
  | { kind: "nowplaying"; text: string }
  | { kind: "status"; text: string };

export function rowSecondary(args: {
  unread: number;
  nowPlaying?: string;
  statusMessage?: string;
  preview?: string;
}): RowSecondary {
  const np = args.nowPlaying?.trim();
  const sm = args.statusMessage?.trim();
  const pv = args.preview?.trim();
  if (args.unread > 0 && pv) return { kind: "preview", text: pv };
  if (np) return { kind: "nowplaying", text: np };
  if (sm) return { kind: "status", text: sm };
  if (pv) return { kind: "preview", text: pv };
  return { kind: "none" };
}

export interface ContactRowProps {
  id: string;
  /** 已套用暱稱（contactLabel）的顯示名。 */
  name: string;
  status: Status;
  unread: number;
  hint: string;
  nowPlaying?: string;
  statusMessage?: string;
  /** 該對話末則訊息預覽（檔案已含 📎 前綴）。 */
  preview?: string;
  /** 企業廣播頭銜（ADR-0158）；顯示為 chip--role。 */
  title?: string;
  labels?: string[];
  onOpen: (id: string) => void;
  onRemove?: (id: string) => void;
  onBlock?: (id: string) => void;
  onSummarize?: (id: string) => void;
  onAddLabel?: (id: string, label: string) => void;
  onRemoveLabel?: (id: string, label: string) => void;
}

/** 統一的聯絡人列（ADR-0214）：經典（依狀態分區）與三欄（最近排序）共用同一份列規格。 */
export function ContactRow(props: ContactRowProps): JSX.Element {
  const { t } = useI18n();
  const { confirm } = useDialog();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const sec = rowSecondary(props);
  const labels = props.labels ?? [];
  const showLabelRow = !!props.title || labels.length > 0 || (!!props.onAddLabel && adding);

  const remove = async () => {
    if (props.onRemove && (await confirm({ message: t("contact_removeConfirm", { name: props.name }), danger: true }))) {
      props.onRemove(props.id);
    }
  };
  const block = async () => {
    if (props.onBlock && (await confirm({ message: t("contact_blockConfirm", { name: props.name }), danger: true }))) {
      props.onBlock(props.id);
    }
  };
  const submitLabel = () => {
    const v = draft.trim();
    if (v) props.onAddLabel?.(props.id, v);
    setDraft("");
    setAdding(false);
  };

  return (
    <div
      className={`contact contact--row ${props.status === "offline" ? "offline" : ""}`}
      data-testid={`contact-${props.id}`}
      onDoubleClick={() => props.onOpen(props.id)}
      title={sec.kind === "none" ? props.hint : sec.text}
    >
      <span className={`dot ${props.status}`} aria-hidden="true" />
      <div className="contact__info">
        <div className="contact__name">{props.name}</div>
        {sec.kind !== "none" ? (
          <div className="contact__sec" data-testid="contact-sec" data-sec={sec.kind}>
            {sec.kind === "nowplaying" ? (
              <>
                <span className="contact__sec-ic" aria-hidden="true">♪</span> {sec.text}
              </>
            ) : sec.kind === "status" ? (
              renderStatus(sec.text)
            ) : (
              sec.text
            )}
          </div>
        ) : null}
        {showLabelRow ? (
          <div className="labelrow">
            {props.title ? (
              <span className="chip chip--role" data-testid="contact-title-chip">{props.title}</span>
            ) : null}
            {labels.map((l) => (
              <span className="chip" key={l}>
                {l}
                {props.onRemoveLabel ? (
                  <button
                    className="chip__x"
                    aria-label={t("group_labelRemove", { label: l })}
                    onClick={() => props.onRemoveLabel?.(props.id, l)}
                  >
                    ×
                  </button>
                ) : null}
              </span>
            ))}
            {props.onAddLabel && adding ? (
              <input
                className="labelrow__input"
                aria-label={t("group_labelPlaceholder")}
                placeholder={t("group_labelPlaceholder")}
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={submitLabel}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitLabel();
                  else if (e.key === "Escape") {
                    setDraft("");
                    setAdding(false);
                  }
                }}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      {props.unread > 0 ? (
        <span className="unread-badge" title={t("unread_title", { count: props.unread })}>{props.unread}</span>
      ) : null}
      <span className="contact__acts">
        {props.onSummarize && props.unread > 0 ? (
          <button
            className="contact__act"
            title={t("ai_summarize")}
            data-testid="summarize-btn"
            onClick={() => props.onSummarize?.(props.id)}
          >
            🧠
          </button>
        ) : null}
        {props.onAddLabel ? (
          <button
            className="contact__act"
            title={t("sidebar_labelAdd")}
            data-testid="contact-label-btn"
            onClick={() => setAdding(true)}
          >
            🏷
          </button>
        ) : null}
        {props.onBlock ? (
          <button className="contact__act" title={t("contact_block")} onClick={block}>🚫</button>
        ) : null}
        {props.onRemove ? (
          <button className="contact__act" title={t("contact_remove")} onClick={remove}>🗑</button>
        ) : null}
      </span>
    </div>
  );
}
