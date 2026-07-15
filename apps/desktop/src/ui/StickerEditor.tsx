// 貼圖編輯器（ADR-0033）：pointer 手繪 → 筆劃模型 → SVG。
// 元件只是薄殼：狀態轉移與序列化全在 sticker-editor-model.ts（純函式）。
// 預覽零 innerHTML：底圖走 <img dataURI>，筆劃是 React 建構的 inline <svg>。

import { useRef, useState, type JSX, type PointerEvent } from "react";
import { useI18n } from "../i18n.js";
import { svgToDataUri } from "@cinder/core";
import {
  addStroke,
  appendPoint,
  CANVAS_SIZE,
  clearStrokes,
  emptyEditor,
  redo,
  serializeEditor,
  strokeToPath,
  undo,
  type EditorState,
  type Stroke,
} from "./sticker-editor-model.js";

const PALETTE = ["#222222", "#e0245e", "#f28b30", "#f5c518", "#17bf63", "#1da1f2", "#794bc4", "#ffffff"];
const WIDTHS = [3, 6, 12];

export function StickerEditor({
  base,
  initialLabel,
  onSave,
  onClose,
}: {
  /** 以現有貼圖為底編輯時的底圖 SVG（須已通過驗證）。 */
  base?: string | undefined;
  initialLabel?: string | undefined;
  /** 回傳 true 表示入庫成功（編輯器隨之關閉）。 */
  onSave: (label: string, svg: string) => boolean;
  onClose: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const [state, setState] = useState<EditorState>(() => emptyEditor(base));
  const [color, setColor] = useState(PALETTE[0]!);
  const [width, setWidth] = useState(WIDTHS[1]!);
  const [label, setLabel] = useState(initialLabel ?? "");
  const [live, setLive] = useState<Stroke | null>(null);
  const canvasRef = useRef<SVGSVGElement>(null);

  const toCanvas = (e: PointerEvent): readonly [number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [
      ((e.clientX - rect.left) / rect.width) * CANVAS_SIZE,
      ((e.clientY - rect.top) / rect.height) * CANVAS_SIZE,
    ];
  };
  const down = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = toCanvas(e);
    setLive({ color, width, points: appendPoint([], x, y) });
  };
  const move = (e: PointerEvent) => {
    if (!live) return;
    const [x, y] = toCanvas(e);
    setLive({ ...live, points: appendPoint(live.points, x, y) });
  };
  const up = () => {
    if (!live) return;
    setState((s) => addStroke(s, live));
    setLive(null);
  };
  const save = () => {
    if (onSave(label, serializeEditor(state))) onClose();
  };

  const strokes = live ? [...state.strokes, live] : state.strokes;
  return (
    <div className="stickered" role="dialog" aria-modal="true" aria-label={t("editor_title")}>
      <div className="stickered__panel" data-testid="sticker-editor">
        <div className="stickered__head">
          <strong>{t("editor_title")}</strong>
          <button type="button" className="stickered__close" aria-label={t("editor_cancel")} onClick={onClose}>✕</button>
        </div>
        <div className="stickered__canvaswrap">
          {state.base ? <img className="stickered__base" src={svgToDataUri(state.base)} alt="" /> : null}
          <svg
            ref={canvasRef}
            className="stickered__canvas"
            data-testid="editor-canvas"
            viewBox={`0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
          >
            {strokes.map((s, i) => (
              <path
                key={i}
                d={strokeToPath(s.points)}
                fill="none"
                stroke={s.color}
                strokeWidth={s.width}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </svg>
        </div>
        <div className="stickered__tools">
          <span className="stickered__palette" role="radiogroup" aria-label={t("editor_color")}>
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                className={`stickered__swatch${color === c ? " on" : ""}`}
                style={{ background: c }}
                title={c}
                onClick={() => setColor(c)}
              />
            ))}
          </span>
          <span className="stickered__widths" role="radiogroup" aria-label={t("editor_width")}>
            {WIDTHS.map((w) => (
              <button
                key={w}
                type="button"
                role="radio"
                aria-checked={width === w}
                className={`stickered__widthbtn${width === w ? " on" : ""}`}
                title={`${w}px`}
                onClick={() => setWidth(w)}
              >
                <i style={{ width: w, height: w }} />
              </button>
            ))}
          </span>
          <span className="stickered__ops">
            <button type="button" title={t("editor_undo")} aria-label={t("editor_undo")} disabled={state.strokes.length === 0} onClick={() => setState(undo)}>↩</button>
            <button type="button" title={t("editor_redo")} aria-label={t("editor_redo")} disabled={state.undone.length === 0} onClick={() => setState(redo)}>↪</button>
            <button type="button" title={t("editor_clear")} aria-label={t("editor_clear")} disabled={state.strokes.length === 0} onClick={() => setState(clearStrokes)}>🗑</button>
          </span>
        </div>
        <div className="stickered__foot">
          <input
            type="text"
            value={label}
            maxLength={24}
            placeholder={t("editor_label")}
            aria-label={t("editor_label")}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button
            type="button"
            className="stickered__save"
            disabled={state.strokes.length === 0 && !state.base}
            onClick={save}
          >
            {t("editor_save")}
          </button>
        </div>
      </div>
    </div>
  );
}
