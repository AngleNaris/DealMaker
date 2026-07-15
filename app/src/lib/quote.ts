/** 报价表明细数据与渲染辅助 */

export const SPEC_TAG_KINDS = ["尺寸", "格式", "码率", "需求", "交付"] as const;
export type SpecTagKind = (typeof SPEC_TAG_KINDS)[number];

export type SpecTag = {
  id: string;
  kind: SpecTagKind;
  value: string;
};

export type QuoteRow = {
  id: string;
  name: string;
  qty: number;
  duration: string;
  unitPrice: number;
  partnerPrice: number;
  specs: SpecTag[];
  note: string;
};

export type QuoteData = {
  title: string;
  taxNote: string;
  footNote: string;
  rows: QuoteRow[];
};

export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export function emptyRow(): QuoteRow {
  return {
    id: uid("row"),
    name: "",
    qty: 1,
    duration: "/",
    unitPrice: 0,
    partnerPrice: 0,
    specs: [],
    note: "",
  };
}

export function defaultQuote(projectName = ""): QuoteData {
  return {
    title: projectName ? `${projectName} 报价明细` : "项目标题 报价明细",
    taxNote: "总计（含税1%）",
    footNote: "",
    rows: [emptyRow()],
  };
}

/** 同名标签多于 1 个时自动加编号：需求1、交付2… */
export function labeledSpecTags(specs: SpecTag[]): { key: string; value: string }[] {
  const counts: Record<string, number> = {};
  const totals: Record<string, number> = {};
  for (const t of specs) {
    totals[t.kind] = (totals[t.kind] || 0) + 1;
  }
  return specs.map((t) => {
    counts[t.kind] = (counts[t.kind] || 0) + 1;
    const key = totals[t.kind] > 1 ? `${t.kind}${counts[t.kind]}` : t.kind;
    return { key, value: t.value };
  });
}

export function formatMoney(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function sumPartner(rows: QuoteRow[]): number {
  return rows.reduce((s, r) => s + (Number(r.partnerPrice) || 0), 0);
}

export function qtyLabel(qty: number): string {
  const n = Math.max(0, Math.floor(Number(qty) || 0));
  return `${n} 项`;
}
