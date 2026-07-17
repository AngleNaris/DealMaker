/** 报价表明细数据与渲染辅助 */

export const SPEC_TAG_KINDS = ["尺寸", "格式", "码率", "需求", "交付"] as const;
export type SpecTagKind = (typeof SPEC_TAG_KINDS)[number];

export type SpecTag = {
  id: string;
  kind: SpecTagKind;
  value: string;
};

/** 价格：数字，或占位符 "/"（代表该项另行计价 / 暂不填，不计入合计） */
export type PriceValue = number | "/";

export type QuoteRow = {
  id: string;
  name: string;
  qty: number;
  duration: string;
  unitPrice: PriceValue;
  partnerPrice: PriceValue;
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

/** Windows 非法文件名字符清理 */
function safeFilenamePart(s: string, maxLen = 80): string {
  let t = String(s || "")
    .trim()
    .replace(/[\\/:*?"<>|\r\n]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^[.\s_]+|[.\s_]+$/g, "");
  if (t.length > maxLen) t = t.slice(0, maxLen).replace(/[.\s_]+$/g, "");
  return t;
}

/** 同项目稳定文件名：项目名称_合同编号.png（再次导出覆盖） */
export function quotePngFilename(projectName?: string, contractNo?: string): string {
  const a = safeFilenamePart(projectName || "");
  const b = safeFilenamePart(contractNo || "");
  const stem = a && b ? `${a}_${b}` : a || b || "报价表";
  return `${stem}.png`;
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

export type QuoteDefaults = {
  projectName?: string;
  /** 表单「替换的总费用」 */
  formTotal?: number | null;
  /** 表单「替换的税率」 */
  formTaxRate?: number | null;
};

export function defaultQuote(projectNameOrOpts: string | QuoteDefaults = ""): QuoteData {
  const opts: QuoteDefaults =
    typeof projectNameOrOpts === "string" ? { projectName: projectNameOrOpts } : projectNameOrOpts || {};
  const projectName = (opts.projectName || "").trim();
  const tax =
    opts.formTaxRate != null && Number.isFinite(opts.formTaxRate) ? opts.formTaxRate : null;
  const total =
    opts.formTotal != null && Number.isFinite(opts.formTotal) && opts.formTotal > 0
      ? opts.formTotal
      : null;
  const row = emptyRow();
  if (total != null) {
    row.partnerPrice = total;
    row.name = row.name || "服务项目";
  }
  return {
    title: projectName ? `${projectName} 报价明细` : "项目标题 报价明细",
    taxNote: tax != null ? `总计（含税${tax}%）` : "总计（含税1%）",
    footNote: "",
    rows: [row],
  };
}

/** 从 taxNote 解析含税百分比，如 总计（含税3%） → 3 */
export function parseTaxRateFromNote(taxNote: string): number | null {
  const m = String(taxNote || "").match(/含税\s*([0-9]+(?:\.[0-9]+)?)\s*%/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** 报价合计与表单总费用/税率是否一致（容差 0.01） */
export function quoteFormMismatch(
  quote: QuoteData | null | undefined,
  formTotal: number | null,
  formTaxRate: number | null
): { total: boolean; tax: boolean } {
  if (!quote?.rows?.length) return { total: false, tax: false };
  const qTotal = Math.round(sumPartner(quote.rows) * 100) / 100;
  let totalMis = false;
  if (formTotal != null && Number.isFinite(formTotal)) {
    totalMis = Math.abs(qTotal - formTotal) > 0.009;
  }
  let taxMis = false;
  const qTax = parseTaxRateFromNote(quote.taxNote || "");
  if (formTaxRate != null && Number.isFinite(formTaxRate) && qTax != null) {
    taxMis = Math.abs(qTax - formTaxRate) > 0.001;
  }
  return { total: totalMis, tax: taxMis };
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

/** 价格展示："/" 原样返回，数字前加 ¥。用于表格静态展示。 */
export function formatPrice(v: PriceValue): string {
  return v === "/" ? "/" : "¥" + formatMoney(v as number);
}

/** 单行金额：合作价≠0 用合作价（行总价）；否则 单价×数量；合作价为 / → 0 */
export function lineAmount(row: QuoteRow): number {
  const qty = Math.max(0, Number(row.qty) || 0);
  if (row.partnerPrice === "/") return 0;
  const p = Number(row.partnerPrice) || 0;
  if (Math.abs(p) > 1e-12) return Math.round(p * 100) / 100;
  if (row.unitPrice === "/") return 0;
  const u = Number(row.unitPrice) || 0;
  return Math.round(u * qty * 100) / 100;
}

export function sumPartner(rows: QuoteRow[]): number {
  return Math.round(rows.reduce((s, r) => s + lineAmount(r), 0) * 100) / 100;
}

export function qtyLabel(qty: number): string {
  const n = Math.max(0, Math.floor(Number(qty) || 0));
  return `${n} 项`;
}

const QUOTE_DRAFT_KEY = "dealmaker_quote_draft_v1";

export function loadQuoteDraft(): QuoteData | null {
  try {
    const raw = localStorage.getItem(QUOTE_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as QuoteData;
    if (!parsed || !Array.isArray(parsed.rows)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveQuoteDraft(data: QuoteData): void {
  try {
    localStorage.setItem(QUOTE_DRAFT_KEY, JSON.stringify(data));
  } catch {
    /* ignore quota */
  }
}

export function clearQuoteDraft(): void {
  try {
    localStorage.removeItem(QUOTE_DRAFT_KEY);
  } catch {
    /* ignore */
  }
}
