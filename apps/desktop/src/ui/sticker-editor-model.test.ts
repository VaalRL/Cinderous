import { describe, expect, it } from "vitest";
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
  type Stroke,
} from "./sticker-editor-model.js";
import { validateStickerSvg } from "./sticker-svg.js";

const stroke = (pts: Array<[number, number]>, color = "#222", width = 6): Stroke => ({
  color,
  width,
  points: pts,
});

describe("貼圖編輯器：筆劃模型（ADR-0033）", () => {
  it("appendPoint：距離門檻取樣、座標取一位小數", () => {
    let pts = appendPoint([], 10.123, 20.678);
    expect(pts).toEqual([[10.1, 20.7]]);
    pts = appendPoint(pts, 10.5, 20.8); // 距離 < 1.5 → 不收
    expect(pts).toHaveLength(1);
    pts = appendPoint(pts, 14, 24);
    expect(pts).toHaveLength(2);
  });

  it("strokeToPath：單點退化為圓點、多點用二次貝茲中點平滑", () => {
    expect(strokeToPath([[5, 5]])).toBe("M5 5l0 0");
    expect(strokeToPath([[0, 0], [10, 0]])).toBe("M0 0L10 0");
    const d = strokeToPath([[0, 0], [10, 0], [10, 10]]);
    expect(d).toBe("M0 0Q10 0 10 5L10 10");
  });

  it("undo/redo/清空：新筆劃清空 redo 疊", () => {
    const a = stroke([[1, 1]]);
    const b = stroke([[2, 2]]);
    let s = addStroke(addStroke(emptyEditor(), a), b);
    s = undo(s);
    expect(s.strokes).toEqual([a]);
    expect(s.undone).toEqual([b]);
    s = redo(s);
    expect(s.strokes).toEqual([a, b]);
    s = addStroke(undo(s), stroke([[3, 3]]));
    expect(s.undone).toEqual([]); // 新筆劃使 b 不可 redo
    expect(clearStrokes(s).strokes).toEqual([]);
    expect(undo(emptyEditor())).toEqual(emptyEditor()); // 空狀態安全
  });

  it("空筆劃不入狀態", () => {
    expect(addStroke(emptyEditor(), stroke([])).strokes).toEqual([]);
  });

  it("序列化：viewBox 256、產物通過貼圖驗證（不變式）", () => {
    const s = addStroke(emptyEditor(), stroke([[0, 0], [10, 0], [10, 10]]));
    const svg = serializeEditor(s);
    expect(svg).toContain(`viewBox="0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}"`);
    expect(svg).toContain("stroke-linecap=\"round\"");
    expect(validateStickerSvg(svg)).toEqual({ ok: true });
  });

  it("底圖：嵌套 <svg> 統一為畫布尺寸、剝除原 width/height，產物仍通過驗證", () => {
    const base = '<svg width="512" height=\'512\' xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle r="4"/></svg>';
    const svg = serializeEditor(addStroke(emptyEditor(base), stroke([[1, 1], [9, 9]])));
    expect(svg).toContain('<svg width="256" height="256" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">');
    expect(svg).not.toContain("512");
    expect(validateStickerSvg(svg)).toEqual({ ok: true });
  });

  it("長筆劃（500 點）序列化仍遠低於 32KB 上限", () => {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < 500; i++) pts.push([(i * 17) % 256, (i * 31) % 256]);
    const svg = serializeEditor(addStroke(emptyEditor(), stroke(pts)));
    expect(validateStickerSvg(svg)).toEqual({ ok: true });
    expect(new TextEncoder().encode(svg).length).toBeLessThan(16 * 1024);
  });
});
