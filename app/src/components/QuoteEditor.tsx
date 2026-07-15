import React, { useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import {
  QuoteData,
  QuoteRow,
  SPEC_TAG_KINDS,
  SpecTag,
  SpecTagKind,
  defaultQuote,
  emptyRow,
  sumPartner,
  uid,
} from "../lib/quote";
import { saveQuoteImage } from "../lib/api";
import { QuotePreview } from "./QuotePreview";

type Props = {
  projectName?: string;
  initial?: QuoteData | null;
  onBack: () => void;
  onSaved: (imagePath: string, data: QuoteData) => void;
};

export function QuoteEditor({ projectName, initial, onBack, onSaved }: Props) {
  const [data, setData] = useState<QuoteData>(
    () => initial || defaultQuote(projectName || "")
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const previewRef = useRef<HTMLDivElement>(null);

  const total = useMemo(() => sumPartner(data.rows), [data.rows]);

  const updateMeta = (patch: Partial<QuoteData>) => setData((d) => ({ ...d, ...patch }));

  const updateRow = (id: string, patch: Partial<QuoteRow>) => {
    setData((d) => ({
      ...d,
      rows: d.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
  };

  const addRow = () => setData((d) => ({ ...d, rows: [...d.rows, emptyRow()] }));

  const removeRow = (id: string) => {
    setData((d) => ({
      ...d,
      rows: d.rows.length <= 1 ? d.rows : d.rows.filter((r) => r.id !== id),
    }));
  };

  const moveRow = (id: string, dir: -1 | 1) => {
    setData((d) => {
      const idx = d.rows.findIndex((r) => r.id === id);
      const j = idx + dir;
      if (idx < 0 || j < 0 || j >= d.rows.length) return d;
      const rows = [...d.rows];
      [rows[idx], rows[j]] = [rows[j], rows[idx]];
      return { ...d, rows };
    });
  };

  const addSpec = (rowId: string, kind: SpecTagKind) => {
    const tag: SpecTag = { id: uid("tag"), kind, value: "" };
    setData((d) => ({
      ...d,
      rows: d.rows.map((r) =>
        r.id === rowId ? { ...r, specs: [...r.specs, tag] } : r
      ),
    }));
  };

  const updateSpec = (rowId: string, tagId: string, value: string) => {
    setData((d) => ({
      ...d,
      rows: d.rows.map((r) =>
        r.id !== rowId
          ? r
          : {
              ...r,
              specs: r.specs.map((t) => (t.id === tagId ? { ...t, value } : t)),
            }
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

  const onExport = async () => {
    if (!previewRef.current) return;
    setBusy(true);
    setErr("");
    try {
      const canvas = await html2canvas(previewRef.current, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const dataUrl = canvas.toDataURL("image/png");
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
      const res = await saveQuoteImage({
        base64,
        filename: `报价表_${stamp}.png`,
      });
      onSaved(res.path, data);
    } catch (e: any) {
      setErr(String(e?.message || e).split(/\r?\n/)[0]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dm-root qe-root">
      <header className="dm-titlebar qe-header">
        <button type="button" className="dm-btn" onClick={onBack} disabled={busy}>
          ← 返回合同
        </button>
        <div className="qe-header-title">制作报价表</div>
        <div className="dm-author">@繁星之子卡萨蒂亚</div>
      </header>

      <div className="qe-body">
        <div className="qe-editor se-card">
          <div className="qe-meta">
            <label>
              标题
              <input
                className="dm-input"
                value={data.title}
                onChange={(e) => updateMeta({ title: e.target.value })}
              />
            </label>
            <label>
              合计标签
              <input
                className="dm-input"
                value={data.taxNote}
                onChange={(e) => updateMeta({ taxNote: e.target.value })}
                placeholder="总计（含税1%）"
              />
            </label>
            <label>
              底部备注
              <input
                className="dm-input"
                value={data.footNote}
                onChange={(e) => updateMeta({ footNote: e.target.value })}
              />
            </label>
            <div className="qe-total-hint">
              合作价合计：¥{total.toLocaleString("zh-CN")}
            </div>
          </div>

          <div className="qe-rows">
            {data.rows.map((row, idx) => (
              <div className="qe-row-card" key={row.id}>
                <div className="qe-row-head">
                  <span className="qe-row-no">#{idx + 1}</span>
                  <div className="qe-row-actions">
                    <button type="button" className="dm-btn" onClick={() => moveRow(row.id, -1)}>
                      上移
                    </button>
                    <button type="button" className="dm-btn" onClick={() => moveRow(row.id, 1)}>
                      下移
                    </button>
                    <button type="button" className="dm-btn" onClick={() => removeRow(row.id)}>
                      删除行
                    </button>
                  </div>
                </div>

                <div className="qe-grid">
                  <label>
                    服务名称
                    <input
                      className="dm-input"
                      value={row.name}
                      onChange={(e) => updateRow(row.id, { name: e.target.value })}
                    />
                  </label>
                  <label>
                    数量
                    <input
                      className="dm-input"
                      type="number"
                      min={0}
                      step={1}
                      value={row.qty}
                      onChange={(e) =>
                        updateRow(row.id, { qty: parseInt(e.target.value || "0", 10) || 0 })
                      }
                    />
                  </label>
                  <label>
                    时长
                    <input
                      className="dm-input"
                      value={row.duration}
                      onChange={(e) => updateRow(row.id, { duration: e.target.value })}
                      placeholder="10s / 全案 / /"
                    />
                  </label>
                  <label>
                    单价
                    <input
                      className="dm-input"
                      type="number"
                      min={0}
                      step={1}
                      value={row.unitPrice}
                      onChange={(e) =>
                        updateRow(row.id, { unitPrice: parseFloat(e.target.value || "0") || 0 })
                      }
                    />
                  </label>
                  <label>
                    合作价
                    <input
                      className="dm-input"
                      type="number"
                      min={0}
                      step={1}
                      value={row.partnerPrice}
                      onChange={(e) =>
                        updateRow(row.id, {
                          partnerPrice: parseFloat(e.target.value || "0") || 0,
                        })
                      }
                    />
                  </label>
                  <label className="qe-span2">
                    其它备注
                    <input
                      className="dm-input"
                      value={row.note}
                      onChange={(e) => updateRow(row.id, { note: e.target.value })}
                    />
                  </label>
                </div>

                <div className="qe-specs">
                  <div className="qe-specs-title">交付规格标签</div>
                  <div className="qe-spec-add">
                    {SPEC_TAG_KINDS.map((k) => (
                      <button
                        key={k}
                        type="button"
                        className="dm-btn"
                        onClick={() => addSpec(row.id, k)}
                      >
                        + {k}
                      </button>
                    ))}
                  </div>
                  {row.specs.length === 0 && (
                    <div className="qe-empty">暂无标签，点击上方按钮添加（同名多个会自动编号）</div>
                  )}
                  {row.specs.map((t) => (
                    <div className="qe-spec-line" key={t.id}>
                      <span className="qe-spec-kind">{t.kind}</span>
                      <input
                        className="dm-input grow"
                        value={t.value}
                        placeholder={`${t.kind}内容`}
                        onChange={(e) => updateSpec(row.id, t.id, e.target.value)}
                      />
                      <button
                        type="button"
                        className="dm-btn"
                        onClick={() => removeSpec(row.id, t.id)}
                      >
                        删
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="qe-toolbar">
            <button type="button" className="dm-btn" onClick={addRow}>
              + 添加一行
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
          {err && <div className="dm-msg err">{err}</div>}
        </div>

        <div className="qe-preview-wrap">
          <div className="qe-preview-label">实时预览（导出样式）</div>
          <div className="qe-preview-scroll">
            <QuotePreview ref={previewRef} data={data} />
          </div>
        </div>
      </div>
    </div>
  );
}
