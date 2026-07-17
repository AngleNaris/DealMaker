import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  QuoteData,
  QuoteRow,
  PriceValue,
  SPEC_TAG_KINDS,
  SpecTag,
  SpecTagKind,
  clearQuoteDraft,
  defaultQuote,
  emptyRow,
  formatMoney,
  formatPrice,
  labeledSpecTags,
  loadQuoteDraft,
  parseTaxRateFromNote,
  qtyLabel,
  quoteFormMismatch,
  quotePngFilename,
  saveQuoteDraft,
  sumPartner,
  uid,
} from "../lib/quote";
import { exportQuotePng } from "../lib/api";
import "../styles/quote-preview.css";

/**
 * 价格输入框：允许占位符 "/"（代表该项另行计价 / 暂不填，不计入合计）。
 * 交互：
 *  - 在 0 时继续向下滚动滚轮 → 设为 "/"
 *  - 在 "/" 时向上滚动滚轮 → 回到 0
 *  - 其它情况按 step 正常增减
 * 使用原生非被动 wheel 监听，确保能 preventDefault 接管步进。
 */
function PriceInput({
  value,
  onCommit,
  step = 1,
}: {
  value: PriceValue;
  onCommit: (v: PriceValue) => void;
  step?: number;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState<string>(value === "/" ? "/" : String(value));
  const valRef = useRef<PriceValue>(value);
  valRef.current = value;
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  // 外部值变化（AI / 工作区 / 撤销）同步到输入框文本
  useEffect(() => {
    setText(value === "/" ? "/" : String(value));
  }, [value]);

  // 原生非被动 wheel 监听：接管步进逻辑
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dec = e.deltaY > 0; // 向下滚动 = 减少
      const cur = valRef.current;
      let next: PriceValue;
      if (dec) {
        if (cur === "/") next = "/";
        else if ((cur as number) <= 0) next = "/"; // 0 时继续下滚 → "/"
        else next = Math.max(0, (cur as number) - step);
      } else {
        if (cur === "/") next = 0; // "/" 时上滚 → 0
        else next = (cur as number) + step;
      }
      commitRef.current(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [step]);

  const commit = (raw: string) => {
    const t = raw.trim();
    if (t === "/") {
      onCommit("/");
      return;
    }
    if (t === "" || t === "-") {
      onCommit(0);
      return;
    }
    const n = parseFloat(t);
    onCommit(Number.isFinite(n) ? n : 0);
  };

  return (
    <input
      ref={ref}
      className="qc-cell-input qc-num"
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

type Props = {
  projectName?: string;
  /** 合同编号，用于报价图稳定文件名 */
  contractNo?: string;
  /** 合同表单总费用，用于默认值与一致性校验 */
  formTotal?: number | null;
  /** 合同表单税率 */
  formTaxRate?: number | null;
  initial?: QuoteData | null;
  onBack: (draft: QuoteData) => void;
  onSaved: (imagePath: string, data: QuoteData) => void;
};

/** 指针拖拽载荷（不依赖 HTML5 DnD，兼容 WebView2） */
type PtrDrag =
  | {
      mode: "row";
      rowId: string;
      label: string;
    }
  | {
      mode: "tag";
      rowId: string;
      tagId: string;
      kind: SpecTagKind;
      value: string;
      label: string;
    }
  | {
      mode: "specs";
      sourceRowId: string;
      specs: { kind: SpecTagKind; value: string }[];
      label: string;
    };

type DropHighlight =
  | { type: "row"; rowId: string }
  | { type: "spec"; rowId: string; beforeTagId: string | null };

export function QuoteEditor({
  projectName,
  contractNo,
  formTotal = null,
  formTaxRate = null,
  initial,
  onBack,
  onSaved,
}: Props) {
  const seedOpts = () => ({
    projectName: projectName || "",
    formTotal: formTotal ?? null,
    formTaxRate: formTaxRate ?? null,
  });

  const [data, setData] = useState<QuoteData>(() => {
    if (initial && initial.rows?.length) return initial;
    const saved = loadQuoteDraft();
    if (saved && saved.rows?.length) return saved;
    return defaultQuote(seedOpts());
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [specClipboard, setSpecClipboard] = useState<{
    sourceRowId: string;
    specs: { kind: SpecTagKind; value: string }[];
  } | null>(null);
  const [hint, setHint] = useState(
    "按住标签拖动：同行内排序，拖到其他行则复制；行首 ⋮⋮ 可调换行序"
  );

  // 指针拖拽状态
  const [ptrDrag, setPtrDrag] = useState<PtrDrag | null>(null);
  const [ghostPos, setGhostPos] = useState({ x: 0, y: 0 });
  const [dropHL, setDropHL] = useState<DropHighlight | null>(null);
  const ptrDragRef = useRef<PtrDrag | null>(null);
  const draggingRef = useRef(false);
  const startPt = useRef({ x: 0, y: 0 });

  const total = useMemo(() => sumPartner(data.rows), [data.rows]);
  const mismatch = useMemo(
    () => quoteFormMismatch(data, formTotal ?? null, formTaxRate ?? null),
    [data, formTotal, formTaxRate]
  );

  useEffect(() => {
    const t = window.setTimeout(() => saveQuoteDraft(data), 300);
    return () => window.clearTimeout(t);
  }, [data]);

  // 外部（AI/工作区）更新 initial 时同步进编辑器（父级用 key 强制刷新时也会 remount）
  useEffect(() => {
    if (initial && initial.rows?.length) {
      setData(initial);
    }
  }, [initial]);

  const onNew = () => {
    if (!confirm("新建将清空当前报价表编辑内容，是否继续？")) return;
    const fresh = defaultQuote(seedOpts());
    setData(fresh);
    clearQuoteDraft();
    saveQuoteDraft(fresh);
    const bits: string[] = ["已新建报价表"];
    if (formTotal != null && formTotal > 0) bits.push(`总费用默认 ${formTotal}`);
    if (formTaxRate != null) bits.push(`税率默认 ${formTaxRate}%`);
    setHint(bits.join(" · "));
    setErr("");
  };

  const updateMeta = (patch: Partial<QuoteData>) => setData((d) => ({ ...d, ...patch }));

  const updateRow = (id: string, patch: Partial<QuoteRow>) => {
    setData((d) => ({
      ...d,
      rows: d.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
  };

  const addRow = () => setData((d) => ({ ...d, rows: [...d.rows, emptyRow()] }));

  const removeRow = (id: string) => {
    const row = data.rows.find((r) => r.id === id);
    if (!row) return;
    if (data.rows.length <= 1) {
      setHint("至少保留一行，无法删除");
      return;
    }
    const label = row.name?.trim() || "（未命名）";
    if (!confirm(`确定删除这一行？\n服务名称：${label}`)) return;
    setData((d) => ({
      ...d,
      rows: d.rows.filter((r) => r.id !== id),
    }));
  };

  const reorderRows = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setData((d) => {
      const from = d.rows.findIndex((r) => r.id === fromId);
      const to = d.rows.findIndex((r) => r.id === toId);
      if (from < 0 || to < 0) return d;
      const rows = [...d.rows];
      const [item] = rows.splice(from, 1);
      rows.splice(to, 0, item);
      return { ...d, rows };
    });
    setHint("已调整行顺序");
  };

  const addSpec = (rowId: string, kind: SpecTagKind, value = "") => {
    const tag: SpecTag = { id: uid("tag"), kind, value };
    setData((d) => ({
      ...d,
      rows: d.rows.map((r) =>
        r.id === rowId ? { ...r, specs: [...r.specs, tag] } : r
      ),
    }));
  };

  const appendSpecs = (
    rowId: string,
    specs: { kind: SpecTagKind; value: string }[],
    beforeTagId?: string | null
  ) => {
    if (!specs.length) return;
    setData((d) => ({
      ...d,
      rows: d.rows.map((r) => {
        if (r.id !== rowId) return r;
        const next = specs.map((s) => ({
          id: uid("tag"),
          kind: s.kind,
          value: s.value,
        }));
        if (!beforeTagId) return { ...r, specs: [...r.specs, ...next] };
        const idx = r.specs.findIndex((t) => t.id === beforeTagId);
        if (idx < 0) return { ...r, specs: [...r.specs, ...next] };
        const specs2 = [...r.specs];
        specs2.splice(idx, 0, ...next);
        return { ...r, specs: specs2 };
      }),
    }));
    setHint(`已复制 ${specs.length} 个标签到目标行`);
  };

  const reorderSpecs = (
    rowId: string,
    fromTagId: string,
    beforeTagId: string | null
  ) => {
    if (fromTagId === beforeTagId) return;
    setData((d) => ({
      ...d,
      rows: d.rows.map((r) => {
        if (r.id !== rowId) return r;
        const from = r.specs.findIndex((t) => t.id === fromTagId);
        if (from < 0) return r;
        const specs = [...r.specs];
        const [item] = specs.splice(from, 1);
        if (!beforeTagId) {
          specs.push(item);
        } else {
          const to = specs.findIndex((t) => t.id === beforeTagId);
          if (to < 0) specs.push(item);
          else specs.splice(to, 0, item);
        }
        return { ...r, specs };
      }),
    }));
    setHint("已调整标签顺序");
  };

  const updateSpec = (rowId: string, tagId: string, value: string) => {
    setData((d) => ({
      ...d,
      rows: d.rows.map((r) =>
        r.id !== rowId
          ? r
          : { ...r, specs: r.specs.map((t) => (t.id === tagId ? { ...t, value } : t)) }
      ),
    }));
  };

  const removeSpec = (rowId: string, tagId: string) => {
    setData((d) => ({
      ...d,
      rows: d.rows.map((r) =>
        r.id !== rowId ? r : { ...r, specs: r.specs.filter((t) => t.id !== tagId) }
      ),
    }));
  };

  const copyRowSpecs = (row: QuoteRow) => {
    if (!row.specs.length) {
      setHint("该行没有规格标签可复制");
      return;
    }
    const specs = row.specs.map((s) => ({ kind: s.kind, value: s.value }));
    setSpecClipboard({ sourceRowId: row.id, specs });
    setHint(`已复制 ${specs.length} 个标签，请点击目标行的「粘贴规格」`);
  };

  const pasteRowSpecs = (targetRowId: string) => {
    if (!specClipboard?.specs?.length) {
      setHint("请先在某一行点击「复制规格」");
      return;
    }
    appendSpecs(targetRowId, specClipboard.specs);
  };

  // ─── 指针拖拽核心 ─────────────────────────────────────────

  const hitTestDrop = (clientX: number, clientY: number): DropHighlight | null => {
    // 隐藏 ghost 再检测，避免点到自己
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    if (!el) return null;
    const tagEl = el.closest("[data-q-tag-id]") as HTMLElement | null;
    if (tagEl) {
      const tagId = tagEl.getAttribute("data-q-tag-id");
      const rowId = tagEl.getAttribute("data-q-tag-row");
      if (tagId && rowId) return { type: "spec", rowId, beforeTagId: tagId };
    }
    const specEl = el.closest("[data-q-spec-row]") as HTMLElement | null;
    if (specEl) {
      const rowId = specEl.getAttribute("data-q-spec-row");
      if (rowId) return { type: "spec", rowId, beforeTagId: null };
    }
    const rowEl = el.closest("[data-q-row]") as HTMLElement | null;
    if (rowEl) {
      const rowId = rowEl.getAttribute("data-q-row");
      if (rowId) return { type: "row", rowId };
    }
    return null;
  };

  const endPtrDrag = (clientX: number, clientY: number) => {
    const drag = ptrDragRef.current;
    draggingRef.current = false;
    ptrDragRef.current = null;
    setPtrDrag(null);
    const drop = hitTestDrop(clientX, clientY);
    setDropHL(null);
    if (!drag || !drop) return;

    if (drag.mode === "row" && drop.type === "row") {
      reorderRows(drag.rowId, drop.rowId);
      return;
    }

    // 标签 / 整组规格 → 规格格
    const targetRowId =
      drop.type === "spec" ? drop.rowId : drop.type === "row" ? drop.rowId : null;
    if (!targetRowId) return;
    const beforeTagId = drop.type === "spec" ? drop.beforeTagId : null;

    if (drag.mode === "tag") {
      if (drag.rowId === targetRowId) {
        // 同行：排序
        if (drag.tagId !== beforeTagId) {
          reorderSpecs(targetRowId, drag.tagId, beforeTagId);
        }
      } else {
        // 跨行：复制
        appendSpecs(
          targetRowId,
          [{ kind: drag.kind, value: drag.value }],
          beforeTagId
        );
      }
      return;
    }

    if (drag.mode === "specs") {
      if (drag.sourceRowId === targetRowId) {
        setHint("整组复制请拖到其他行");
        return;
      }
      appendSpecs(targetRowId, drag.specs, beforeTagId);
    }
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!ptrDragRef.current) return;
      const dx = e.clientX - startPt.current.x;
      const dy = e.clientY - startPt.current.y;
      if (!draggingRef.current) {
        if (Math.hypot(dx, dy) < 6) return;
        draggingRef.current = true;
        setPtrDrag(ptrDragRef.current);
      }
      setGhostPos({ x: e.clientX, y: e.clientY });
      setDropHL(hitTestDrop(e.clientX, e.clientY));
    };
    const onUp = (e: PointerEvent) => {
      if (!ptrDragRef.current) return;
      if (draggingRef.current) {
        endPtrDrag(e.clientX, e.clientY);
      } else {
        // 未达到拖动阈值，视为点击
        ptrDragRef.current = null;
        setPtrDrag(null);
        setDropHL(null);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const beginTagDrag = (
    e: React.PointerEvent,
    row: QuoteRow,
    tag: SpecTag,
    displayKey: string
  ) => {
    // 只响应主键
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const payload: PtrDrag = {
      mode: "tag",
      rowId: row.id,
      tagId: tag.id,
      kind: tag.kind,
      value: tag.value,
      label: `${displayKey} ${tag.value || ""}`.trim(),
    };
    ptrDragRef.current = payload;
    draggingRef.current = false;
    startPt.current = { x: e.clientX, y: e.clientY };
    setGhostPos({ x: e.clientX, y: e.clientY });
  };

  const beginRowDrag = (e: React.PointerEvent, row: QuoteRow) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const payload: PtrDrag = {
      mode: "row",
      rowId: row.id,
      label: row.name || "整行",
    };
    ptrDragRef.current = payload;
    draggingRef.current = false;
    startPt.current = { x: e.clientX, y: e.clientY };
    setGhostPos({ x: e.clientX, y: e.clientY });
  };

  const beginSpecsDrag = (e: React.PointerEvent, row: QuoteRow) => {
    if (e.button !== 0) return;
    if (!row.specs.length) return;
    e.preventDefault();
    e.stopPropagation();
    const payload: PtrDrag = {
      mode: "specs",
      sourceRowId: row.id,
      specs: row.specs.map((s) => ({ kind: s.kind, value: s.value })),
      label: `复制 ${row.specs.length} 个标签`,
    };
    ptrDragRef.current = payload;
    draggingRef.current = false;
    startPt.current = { x: e.clientX, y: e.clientY };
    setGhostPos({ x: e.clientX, y: e.clientY });
  };

  const onExport = async () => {
    setBusy(true);
    setErr("");
    try {
      // 与 CLI 共用后端 Edge 截图路径，避免 html2canvas 边框/文字发粗、效果不一致
      const res = await exportQuotePng({
        quote: data,
        filename: quotePngFilename(projectName, contractNo),
        projectName,
        contractNo,
      });
      onSaved(res.path, data);
    } catch (e: any) {
      setErr(String(e?.message || e).split(/\r?\n/)[0]);
    } finally {
      setBusy(false);
    }
  };

  const isDragging = !!ptrDrag && draggingRef.current;

  return (
    <div className={`dm-root qe-root${ptrDrag ? " qe-dragging" : ""}`}>
      <header className="dm-titlebar qe-header">
        <button
          type="button"
          className="dm-btn"
          onClick={() => {
            saveQuoteDraft(data);
            onBack(data);
          }}
          disabled={busy}
        >
          ← 返回合同
        </button>
        <div className="qe-header-title">制作报价表 · 表格内编辑</div>
        <div className="qe-header-actions">
          <button type="button" className="dm-btn" onClick={onNew} disabled={busy}>
            新建
          </button>
          <button type="button" className="dm-btn" onClick={addRow} disabled={busy}>
            + 添加行
          </button>
          <button
            type="button"
            className="dm-btn dm-btn-outline"
            onClick={onExport}
            disabled={busy}
          >
            {busy ? "导出中…" : "保存为图片并填入合同"}
          </button>
        </div>
      </header>

      <div className="qe-hint qe-edit-only">{hint}</div>
      {(mismatch.total || mismatch.tax) && (
        <div className="dm-msg err qe-mismatch-warn" style={{ margin: "0 14px" }}>
          {mismatch.total
            ? `报价合计 ¥${formatMoney(total)} 与合同「总费用」${
                formTotal != null ? `¥${formatMoney(formTotal)}` : ""
              } 不一致`
            : ""}
          {mismatch.total && mismatch.tax ? "；" : ""}
          {mismatch.tax
            ? `税率文案（${parseTaxRateFromNote(data.taxNote) ?? "?"}%）与合同税率${
                formTaxRate != null ? `${formTaxRate}%` : ""
              } 不一致`
            : ""}
          。红色数字为提示，请改一致后再导出。
        </div>
      )}
      {err && (
        <div className="dm-msg err" style={{ margin: "0 14px" }}>
          {err}
        </div>
      )}

      {/* 拖拽幽灵 */}
      {ptrDrag && draggingRef.current && (
        <div
          className="qc-ptr-ghost"
          style={{ left: ghostPos.x + 12, top: ghostPos.y + 12 }}
        >
          {ptrDrag.label}
        </div>
      )}

      <div className="qe-table-page">
        <div className="quote-capture quote-editable">
          <table>
            <thead>
              <tr className="title-row">
                <td colSpan={9}>
                  <input
                    className="qc-cell-input qc-title-input"
                    value={data.title}
                    onChange={(e) => updateMeta({ title: e.target.value })}
                    placeholder="项目标题 报价明细"
                  />
                  <span className="qc-static qc-title-static">
                    {data.title || "项目标题 报价明细"}
                  </span>
                </td>
              </tr>
              <tr>
                <th className="c-idx">编号</th>
                <th className="c-name">服务名称</th>
                <th className="c-qty">数量</th>
                <th className="c-dur">时长</th>
                <th className="c-price">单价</th>
                <th className="c-partner">合作价</th>
                <th className="c-spec">交付规格</th>
                <th className="c-note">其它备注</th>
                <th className="c-ops qe-edit-only">操作</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, i) => {
                const labels = labeledSpecTags(row.specs);
                const rowHL =
                  dropHL?.type === "row" && dropHL.rowId === row.id && ptrDrag?.mode === "row";
                const specHL =
                  dropHL?.type === "spec" && dropHL.rowId === row.id;
                return (
                  <tr
                    key={row.id}
                    data-q-row={row.id}
                    className={[
                      rowHL ? "qc-row-drag-over" : "",
                      specHL ? "qc-spec-drop-over" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <td className="c-idx">
                      <span
                        className="qc-drag-handle qe-edit-only"
                        title="按住拖动以调整行顺序"
                        onPointerDown={(e) => beginRowDrag(e, row)}
                      >
                        ⋮⋮
                      </span>
                      <span className="qc-idx-num">{i + 1}</span>
                    </td>
                    <td className="c-name">
                      <textarea
                        className="qc-cell-input qc-textarea"
                        rows={1}
                        value={row.name}
                        onChange={(e) => updateRow(row.id, { name: e.target.value })}
                        placeholder="服务名称"
                      />
                      <span className="qc-static">{row.name || "—"}</span>
                    </td>
                    <td className="c-qty">
                      <input
                        className="qc-cell-input qc-num"
                        type="number"
                        min={0}
                        step={1}
                        value={row.qty}
                        onChange={(e) =>
                          updateRow(row.id, {
                            qty: parseInt(e.target.value || "0", 10) || 0,
                          })
                        }
                      />
                      <span className="qc-static">{qtyLabel(row.qty)}</span>
                    </td>
                    <td className="c-dur">
                      <input
                        className="qc-cell-input"
                        value={row.duration}
                        onChange={(e) => updateRow(row.id, { duration: e.target.value })}
                        placeholder="/"
                      />
                      <span className="qc-static">{row.duration || "/"}</span>
                    </td>
                    <td className="c-price">
                      <span className="qc-edit-wrap qe-edit-only">
                        {row.unitPrice !== "/" && <span className="qc-prefix">¥</span>}
                        <PriceInput
                          value={row.unitPrice}
                          onCommit={(v) => updateRow(row.id, { unitPrice: v })}
                        />
                      </span>
                      <span className="qc-static">{formatPrice(row.unitPrice)}</span>
                    </td>
                    <td className="c-partner">
                      <span className="qc-edit-wrap qe-edit-only">
                        {row.partnerPrice !== "/" && <span className="qc-prefix">¥</span>}
                        <PriceInput
                          value={row.partnerPrice}
                          onCommit={(v) => updateRow(row.id, { partnerPrice: v })}
                        />
                      </span>
                      <span className="qc-static">
                        {row.partnerPrice === "/" ? (
                          "/"
                        ) : (
                          <>
                            <span className="price-lg-symbol">¥</span>
                            <span className="price-lg">
                              {formatMoney(row.partnerPrice as number)}
                            </span>
                          </>
                        )}
                      </span>
                    </td>
                    <td
                      className={`c-spec${specHL ? " qc-spec-cell-active" : ""}`}
                      data-q-spec-row={row.id}
                    >
                      <div className="spec-tags">
                        {row.specs.map((t, j) => {
                          const key = labels[j]?.key || t.kind;
                          const beforeHL =
                            dropHL?.type === "spec" &&
                            dropHL.rowId === row.id &&
                            dropHL.beforeTagId === t.id;
                          return (
                            <span
                              className={`tag tag-edit${beforeHL ? " qc-tag-drop-before" : ""}`}
                              key={t.id}
                              data-q-tag-id={t.id}
                              data-q-tag-row={row.id}
                              title="按住拖动：同行排序，其他行复制"
                              onPointerDown={(e) => {
                                // 点在输入框/删除钮上不启动拖拽
                                const tgt = e.target as HTMLElement;
                                if (
                                  tgt.closest("textarea") ||
                                  tgt.closest("input") ||
                                  tgt.closest("button")
                                ) {
                                  return;
                                }
                                beginTagDrag(e, row, t, key);
                              }}
                            >
                              <span className="qc-tag-grip qe-edit-only">⠿</span>
                              <span className="k">{key}</span>
                              <textarea
                                className="qc-tag-input qc-textarea qe-edit-only"
                                rows={1}
                                value={t.value}
                                placeholder="内容"
                                onChange={(e) => updateSpec(row.id, t.id, e.target.value)}
                                onPointerDown={(e) => e.stopPropagation()}
                              />
                              <span className="qc-static v">{t.value}</span>
                              <button
                                type="button"
                                className="qc-tag-x qe-edit-only"
                                title="删除标签"
                                onClick={() => removeSpec(row.id, t.id)}
                                onPointerDown={(e) => e.stopPropagation()}
                              >
                                ×
                              </button>
                            </span>
                          );
                        })}
                      </div>
                      <div className="qc-tag-bar qe-edit-only">
                        {SPEC_TAG_KINDS.map((k) => (
                          <button
                            key={k}
                            type="button"
                            className="qc-tag-add"
                            onClick={() => addSpec(row.id, k)}
                          >
                            +{k}
                          </button>
                        ))}
                        {row.specs.length > 0 && (
                          <button
                            type="button"
                            className="qc-tag-copy-all"
                            title="点击复制，或按住拖到其他行"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              copyRowSpecs(row);
                            }}
                            onPointerDown={(e) => {
                              // 按住拖动 = 整组复制
                              if ((e.target as HTMLElement).closest("button")) {
                                beginSpecsDrag(e, row);
                              }
                            }}
                          >
                            ⧉ 复制规格
                          </button>
                        )}
                        {specClipboard &&
                          specClipboard.specs.length > 0 &&
                          specClipboard.sourceRowId !== row.id && (
                            <button
                              type="button"
                              className="qc-tag-paste"
                              title="粘贴已复制的规格标签"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                pasteRowSpecs(row.id);
                              }}
                            >
                              📋 粘贴规格
                            </button>
                          )}
                      </div>
                      {row.specs.length === 0 && (
                        <span className="qc-static">—</span>
                      )}
                    </td>
                    <td className="c-note">
                      <textarea
                        className="qc-cell-input qc-textarea"
                        rows={1}
                        value={row.note}
                        onChange={(e) => updateRow(row.id, { note: e.target.value })}
                        placeholder="备注"
                      />
                      <span className="qc-static">{row.note || ""}</span>
                    </td>
                    <td className="c-ops qe-edit-only">
                      <button
                        type="button"
                        className="qc-del-row"
                        onClick={() => removeRow(row.id)}
                        title="删除本行"
                      >
                        删行
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className={`foot-label${mismatch.tax ? " qe-num-mismatch" : ""}`} colSpan={4}>
                  <input
                    className={`qc-cell-input${mismatch.tax ? " qe-num-mismatch" : ""}`}
                    value={data.taxNote}
                    onChange={(e) => updateMeta({ taxNote: e.target.value })}
                    placeholder="总计（含税1%）"
                  />
                  <span className={`qc-static${mismatch.tax ? " qe-num-mismatch" : ""}`}>
                    {data.taxNote || "总计"}
                  </span>
                </td>
                <td className={`foot-amount${mismatch.total ? " qe-num-mismatch" : ""}`} colSpan={2}>
                  <span className="price-lg-symbol">¥</span>
                  <span className={`price-lg${mismatch.total ? " qe-num-mismatch" : ""}`}>
                    {formatMoney(total)}
                  </span>
                </td>
                <td className="foot-note" colSpan={2}>
                  <input
                    className="qc-cell-input"
                    value={data.footNote}
                    onChange={(e) => updateMeta({ footNote: e.target.value })}
                    placeholder="整体备注"
                  />
                  <span className="qc-static">{data.footNote || ""}</span>
                </td>
                <td className="qe-edit-only" />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
