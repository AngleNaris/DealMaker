import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  amountToChinese,
  amountsEqual,
  autoFixFinal,
  parseAmount,
  splitByRatio,
} from "./lib/amount";
import * as api from "./lib/api";
import type { ProjectSummary, WorkspaceState } from "./lib/api";
import {
  QuoteData,
  clearQuoteDraft,
  defaultQuote,
  loadQuoteDraft,
  quoteFormMismatch,
  saveQuoteDraft,
} from "./lib/quote";
import { QuoteEditor } from "./components/QuoteEditor";
import { APP_VERSION } from "./version";

type FieldDef = { key: string; label: string; placeholder: string; pick?: "image" };
type GroupDef = { title: string; fields: FieldDef[] };

const FORM_GROUPS: GroupDef[] = [
  {
    title: "合同基本信息",
    fields: [
      { key: "替换的合同编号", label: "合同编号", placeholder: "请输入合同编号" },
      { key: "替换的项目名称", label: "项目名称", placeholder: "请输入项目名称" },
    ],
  },
  {
    title: "乙方基本信息",
    fields: [{ key: "替换的乙方名称", label: "乙方名称", placeholder: "请输入乙方公司名称" }],
  },
  {
    title: "服务内容",
    fields: [
      { key: "替换的服务内容", label: "服务内容", placeholder: "请输入服务内容描述" },
      { key: "替换的交付格式", label: "交付格式", placeholder: "请输入交付物格式" },
      { key: "替换的交付时间", label: "交付时间", placeholder: "请输入交付时间" },
    ],
  },
  {
    title: "费用信息",
    fields: [
      { key: "替换的总费用", label: "总费用", placeholder: "输入数字，自动转换大写" },
      { key: "替换的总费用大写", label: "总费用大写", placeholder: "自动转换，也可手动修改" },
      { key: "替换的税率", label: "税率", placeholder: "请输入税率，如：3" },
      { key: "替换的预付款", label: "预付款", placeholder: "输入数字，自动转换大写" },
      { key: "替换的预付款大写", label: "预付款大写", placeholder: "自动转换，也可手动修改" },
      { key: "替换的尾款", label: "尾款", placeholder: "输入数字，自动转换大写" },
      { key: "替换的尾款大写", label: "尾款大写", placeholder: "自动转换，也可手动修改" },
      {
        key: "替换的费用表格图片",
        label: "费用表格图片",
        placeholder: "请粘贴费用表格图片路径",
        pick: "image",
      },
    ],
  },
  {
    title: "开票信息",
    fields: [{ key: "替换的开票内容", label: "开票内容", placeholder: "请输入开票内容" }],
  },
  {
    title: "乙方财务信息",
    fields: [
      { key: "乙方银行账号", label: "乙方银行账号", placeholder: "请输入银行账号" },
      { key: "乙方银行开户行", label: "乙方银行开户行", placeholder: "请输入开户行名称" },
    ],
  },
  {
    title: "乙方联系人信息",
    fields: [
      { key: "替换的乙方代表名称", label: "乙方代表名称", placeholder: "请输入联系人姓名" },
      { key: "替换的乙方代表电话", label: "乙方代表电话", placeholder: "请输入联系电话" },
      { key: "替换的乙方代表邮箱", label: "乙方代表邮箱", placeholder: "请输入联系邮箱" },
    ],
  },
  {
    title: "乙方地址",
    fields: [{ key: "乙方地址", label: "乙方地址", placeholder: "请输入完整地址，将自动分行" }],
  },
];

/** 联系人只存乙方相关字段，不含合同编号/项目/费用等项目信息 */
const CONTACT_FIELD_KEYS: string[] = FORM_GROUPS.filter((g) => g.title.startsWith("乙方")).flatMap((g) =>
  g.fields.map((f) => f.key)
);

function emptyForm(): Record<string, string> {
  const o: Record<string, string> = {};
  for (const g of FORM_GROUPS) for (const f of g.fields) o[f.key] = "";
  return o;
}

function pickContactFields(form: Record<string, string>): Record<string, string> {
  const o: Record<string, string> = {};
  for (const k of CONTACT_FIELD_KEYS) {
    o[k] = form[k] ?? "";
  }
  return o;
}

/** Qt 风格 GroupBox */
function GroupBox({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <fieldset className={`dm-group ${className}`.trim()}>
      <legend className="dm-group-title">{title}</legend>
      {children}
    </fieldset>
  );
}

export function App() {
  const [form, setForm] = useState<Record<string, string>>(emptyForm);
  const [templatePath, setTemplatePath] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [outputName, setOutputName] = useState("");
  const [ratio, setRatio] = useState(50);
  const [contactNames, setContactNames] = useState<string[]>([]);
  /** 联系人完整数据缓存，避免点选时再冷启动后端 */
  const [contactsCache, setContactsCache] = useState<Record<string, string>[]>([]);
  const [selectedContact, setSelectedContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err" | "info"; text: string } | null>(null);
  const [view, setView] = useState<"main" | "quote">("main");
  const [quoteDraft, setQuoteDraft] = useState<QuoteData | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  /** 与 CLI/AI 共享工作区：rev 用于探测外部更新 */
  const workspaceRevRef = useRef(0);
  const skipWorkspacePushRef = useRef(false);
  const [quoteSyncKey, setQuoteSyncKey] = useState(0);
  const [coeditHint, setCoeditHint] = useState("");

  const applyWorkspaceState = useCallback((ws: WorkspaceState, opts?: { silent?: boolean }) => {
    skipWorkspacePushRef.current = true;
    workspaceRevRef.current = typeof ws.rev === "number" ? ws.rev : 0;
    const nextForm = emptyForm();
    const src = ws.form || {};
    for (const k of Object.keys(nextForm)) {
      if (src[k] != null) nextForm[k] = String(src[k]);
    }
    for (const [k, v] of Object.entries(src)) {
      nextForm[k] = String(v ?? "");
    }
    setForm(nextForm);
    if (typeof ws.ratio === "number" && Number.isFinite(ws.ratio)) setRatio(ws.ratio);
    if (ws.template_path) setTemplatePath(ws.template_path);
    if (ws.output_dir != null) setOutputDir(ws.output_dir);
    if (ws.output_name != null) setOutputName(ws.output_name);
    if (ws.selected_project_id != null) setSelectedProjectId(ws.selected_project_id || "");
    if (ws.selected_contact != null) setSelectedContact(ws.selected_contact || "");
    if (ws.quote && typeof ws.quote === "object") {
      const q = ws.quote as QuoteData;
      setQuoteDraft(q);
      saveQuoteDraft(q);
      setQuoteSyncKey((n) => n + 1);
    }
    if (!opts?.silent && ws.updated_by && ws.updated_by !== "gui") {
      setCoeditHint(`已同步外部编辑（${ws.updated_by}）· rev ${ws.rev ?? 0}`);
      setMsg({ type: "info", text: `工作区已更新（来自 ${ws.updated_by}）` });
    }
  }, []);

  const payMismatch = useMemo(() => {
    const total = parseAmount(form["替换的总费用"] || "");
    const prepaid = parseAmount(form["替换的预付款"] || "");
    const finalPay = parseAmount(form["替换的尾款"] || "");
    if (total === null || prepaid === null || finalPay === null) return null;
    const sum = Math.round((prepaid + finalPay) * 100) / 100;
    if (amountsEqual(sum, total)) return null;
    return { total, prepaid, finalPay, sum, diff: Math.round((total - sum) * 100) / 100 };
  }, [form]);

  /** 费用信息 vs 报价表 总费用/税率 是否不一致 */
  const feeQuoteMismatch = useMemo(() => {
    const q = quoteDraft || loadQuoteDraft();
    const formTotal = parseAmount(form["替换的总费用"] || "");
    const formTax = parseAmount(form["替换的税率"] || "");
    return quoteFormMismatch(q, formTotal, formTax);
  }, [quoteDraft, form]);

  const openQuoteEditor = () => {
    const existing = quoteDraft || loadQuoteDraft();
    const hasContent =
      existing &&
      existing.rows?.some(
        (r) =>
          (r.name && r.name.trim()) ||
          (Number(r.partnerPrice) || 0) > 0 ||
          (Number(r.unitPrice) || 0) > 0 ||
          (r.specs && r.specs.length > 0)
      );
    if (!hasContent) {
      const seeded = defaultQuote({
        projectName: form["替换的项目名称"] || "",
        formTotal: parseAmount(form["替换的总费用"] || ""),
        formTaxRate: parseAmount(form["替换的税率"] || ""),
      });
      setQuoteDraft(seeded);
      saveQuoteDraft(seeded);
      setQuoteSyncKey((n) => n + 1);
    }
    setView("quote");
  };

  const applyAmountChinese = useCallback((key: string, text: string, prev: Record<string, string>) => {
    const next = { ...prev, [key]: text };
    const amountKeys = ["替换的总费用", "替换的预付款", "替换的尾款"] as const;
    if ((amountKeys as readonly string[]).includes(key)) {
      const n = parseAmount(text);
      const bigKey = key + "大写";
      if (n !== null) next[bigKey] = amountToChinese(n);
    }
    return next;
  }, []);

  const applySplitFromTotal = useCallback(
    (totalText: string, ratioPercent: number, prev: Record<string, string>) => {
      const total = parseAmount(totalText);
      let next = applyAmountChinese("替换的总费用", totalText, prev);
      if (total === null) return next;
      const { prepaid, final } = splitByRatio(total, ratioPercent);
      next = applyAmountChinese("替换的预付款", String(prepaid), next);
      next = applyAmountChinese("替换的尾款", String(final), next);
      return next;
    },
    [applyAmountChinese]
  );

  const setField = (key: string, value: string) => {
    setForm((prev) => {
      if (key === "替换的总费用") return applySplitFromTotal(value, ratio, prev);
      if (key === "替换的预付款" || key === "替换的尾款") return applyAmountChinese(key, value, prev);
      return { ...prev, [key]: value };
    });
  };

  const onRatioChange = (v: string) => {
    const n = Number(v);
    const r = Number.isFinite(n) ? n : 50;
    setRatio(r);
    setForm((prev) => applySplitFromTotal(prev["替换的总费用"] || "", r, prev));
  };

  const onAutoFix = () => {
    if (!payMismatch) return;
    const fixed = autoFixFinal(payMismatch.total, payMismatch.prepaid);
    setForm((prev) => {
      let next = applyAmountChinese("替换的预付款", String(fixed.prepaid), prev);
      next = applyAmountChinese("替换的尾款", String(fixed.final), next);
      return next;
    });
  };

  const applyContactsResult = (res: { names?: string[]; contacts?: Record<string, string>[] }) => {
    setContactNames(res.names || []);
    setContactsCache(res.contacts || []);
  };

  const refreshContacts = async () => {
    const res = await api.listContacts();
    applyContactsResult(res);
  };

  const refreshProjects = async () => {
    try {
      const res = await api.listProjects();
      setProjects(res.projects || []);
    } catch (e: any) {
      console.warn("list_projects failed", e);
      setProjects([]);
    }
  };

  const contactCompanyName = (c: Record<string, string>) =>
    (c["替换的乙方名称"] || c["乙方名称"] || "").trim();

  /** 导出合同/PDF 时自动保存项目快照（按 合同编号+项目名称 新建或更新） */
  const persistProject = async (opts?: { silent?: boolean }): Promise<string | null> => {
    const contract_no = (form["替换的合同编号"] || "").trim();
    const project_name = (form["替换的项目名称"] || "").trim();
    if (!contract_no && !project_name) {
      return null;
    }
    try {
      const quote = quoteDraft || loadQuoteDraft();
      const res = await api.saveProject({
        contract_no,
        project_name,
        form,
        ratio,
        quote: quote || null,
        template_path: templatePath,
        output_dir: outputDir,
        output_name: outputName,
      });
      setProjects(res.projects || []);
      setSelectedProjectId(res.project.id);
      return res.action === "created" ? "已新建项目" : "已更新项目";
    } catch (e: any) {
      // 自动保存失败不阻断导出；手动保存时抛出由调用方处理
      if (!opts?.silent) throw e;
      console.warn("save project failed", e);
      return null;
    }
  };

  /** 用户手动保存当前项目 */
  const saveCurrentProject = async () => {
    const contract_no = (form["替换的合同编号"] || "").trim();
    const project_name = (form["替换的项目名称"] || "").trim();
    if (!contract_no && !project_name) {
      setMsg({ type: "err", text: "请至少填写合同编号或项目名称后再保存项目" });
      return;
    }
    setBusy(true);
    try {
      const note = await persistProject();
      setMsg({ type: "ok", text: note || "项目已保存" });
    } catch (e: any) {
      setMsg({ type: "err", text: String(e?.message || e) });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        await getCurrentWindow().setTitle(`DealMaker v${APP_VERSION}`);
      } catch {
        /* 浏览器预览时忽略 */
      }
      try {
        // 一次进程调用加载全部启动数据，避免三次冷启动
        const boot = await api.bootstrap();
        const settings = boot.settings || {};
        if (settings.template_path) setTemplatePath(settings.template_path);
        if (settings.output_dir) setOutputDir(settings.output_dir);
        applyContactsResult(boot.contacts || {});
        setProjects(boot.projects || []);
        // 与 CLI 共享工作区：启动时载入
        if (boot.workspace && (boot.workspace.rev || 0) > 0) {
          applyWorkspaceState(boot.workspace, { silent: true });
          setCoeditHint(`已加载共享工作区 rev ${boot.workspace.rev}`);
        } else if (boot.workspace) {
          workspaceRevRef.current = boot.workspace.rev || 0;
        }
      } catch (e: any) {
        setMsg({ type: "err", text: String(e?.message || e) });
      }
    })();
  }, [applyWorkspaceState]);

  // GUI → 工作区：用户编辑后防抖写入，供 AI CLI 读取
  useEffect(() => {
    if (skipWorkspacePushRef.current) {
      skipWorkspacePushRef.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      const quote = quoteDraft || loadQuoteDraft();
      const body: WorkspaceState = {
        form,
        quote: quote || undefined,
        ratio,
        template_path: templatePath,
        output_dir: outputDir,
        output_name: outputName,
        selected_project_id: selectedProjectId,
        selected_contact: selectedContact,
      };
      void api
        .putWorkspace(body, "gui")
        .then((ws) => {
          if (typeof ws.rev === "number") workspaceRevRef.current = ws.rev;
        })
        .catch((e) => console.warn("workspace put failed", e));
    }, 450);
    return () => window.clearTimeout(t);
  }, [
    form,
    ratio,
    templatePath,
    outputDir,
    outputName,
    quoteDraft,
    selectedProjectId,
    selectedContact,
  ]);

  // CLI/AI → GUI：轮询 rev，实时显示外部编辑
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const meta = await api.workspaceMeta();
        if (!alive) return;
        if ((meta.rev || 0) > workspaceRevRef.current) {
          const ws = await api.getWorkspace();
          if (!alive) return;
          applyWorkspaceState(ws);
        }
      } catch {
        /* 轮询失败忽略 */
      }
    };
    const id = window.setInterval(tick, 900);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [applyWorkspaceState]);

  const persistSettings = async (tpl: string, out: string) => {
    try {
      await api.saveSettings({ template_path: tpl, output_dir: out });
    } catch {
      /* ignore */
    }
  };

  const pickTemplate = async () => {
    const p = await api.pickPath("docx");
    if (p) {
      setTemplatePath(p);
      await persistSettings(p, outputDir);
    }
  };

  const pickOutputDir = async () => {
    const p = await api.pickPath("dir");
    if (p) {
      setOutputDir(p);
      await persistSettings(templatePath, p);
    }
  };

  const pickImage = async () => {
    const p = await api.pickPath("image");
    if (p) setField("替换的费用表格图片", p);
  };

  const loadContact = (name: string) => {
    if (!name) return;
    const found = contactsCache.find((c) => contactCompanyName(c) === name);
    if (!found) {
      // 缓存未命中时回退到后端
      void (async () => {
        try {
          const list = await api.listContacts();
          applyContactsResult(list);
          const c = (list.contacts || []).find((x) => contactCompanyName(x) === name);
          if (!c) {
            setMsg({ type: "err", text: `联系人不存在：${name}` });
            return;
          }
          applyContactToForm(c, name);
        } catch (e: any) {
          setMsg({ type: "err", text: String(e?.message || e) });
        }
      })();
      return;
    }
    applyContactToForm(found, name);
  };

  const applyContactToForm = (found: Record<string, string>, name: string) => {
    // 只回填乙方字段，不覆盖合同编号/项目名称/费用等项目信息
    setForm((prev) => {
      const next = { ...prev };
      for (const k of CONTACT_FIELD_KEYS) {
        if (found[k] != null) next[k] = String(found[k] ?? "");
      }
      // 兼容旧数据里的「乙方名称」
      if (!next["替换的乙方名称"] && found["乙方名称"]) {
        next["替换的乙方名称"] = String(found["乙方名称"]);
      }
      return next;
    });
    setSelectedContact(name);
    setMsg({ type: "info", text: `已加载联系人：${name}` });
  };

  const saveCurrentContact = async () => {
    setBusy(true);
    try {
      const contactData = pickContactFields(form);
      const res = await api.saveContact(contactData);
      setContactNames(res.names);
      setSelectedContact(res.name);
      // 同步本地缓存（仅乙方字段）
      setContactsCache((prev) => {
        const name = res.name;
        const snapshot = { ...contactData };
        const idx = prev.findIndex((c) => contactCompanyName(c) === name);
        if (idx >= 0) {
          const next = prev.slice();
          next[idx] = snapshot;
          return next;
        }
        return [...prev, snapshot];
      });
      setMsg({ type: "ok", text: `联系人「${res.name}」已保存` });
    } catch (e: any) {
      setMsg({ type: "err", text: String(e?.message || e) });
    } finally {
      setBusy(false);
    }
  };

  const deleteCurrentContact = async () => {
    if (!selectedContact) {
      setMsg({ type: "err", text: "请先选择联系人" });
      return;
    }
    if (!confirm(`确定删除联系人「${selectedContact}」？`)) return;
    setBusy(true);
    try {
      const res = await api.deleteContact(selectedContact);
      setContactNames(res.names);
      setContactsCache((prev) => prev.filter((c) => contactCompanyName(c) !== selectedContact));
      setSelectedContact("");
      setMsg({ type: "ok", text: "已删除" });
    } catch (e: any) {
      setMsg({ type: "err", text: String(e?.message || e) });
    } finally {
      setBusy(false);
    }
  };

  const clearForm = () => {
    setForm(emptyForm());
    setSelectedContact("");
    setSelectedProjectId("");
    setQuoteDraft(null);
    clearQuoteDraft();
    setRatio(50);
    setMsg(null);
  };

  const loadProject = async (id: string) => {
    if (!id) return;
    try {
      const p = await api.getProject(id);
      const nextForm = emptyForm();
      const src = p.form || {};
      for (const k of Object.keys(nextForm)) {
        if (src[k] != null) nextForm[k] = String(src[k]);
      }
      // 兼容多存的字段
      for (const [k, v] of Object.entries(src)) {
        nextForm[k] = String(v ?? "");
      }
      setForm(nextForm);
      if (typeof p.ratio === "number" && Number.isFinite(p.ratio)) {
        setRatio(p.ratio);
      }
      if (p.template_path) setTemplatePath(p.template_path);
      if (p.output_dir != null) setOutputDir(p.output_dir);
      if (p.output_name != null) setOutputName(p.output_name);
      if (p.quote && typeof p.quote === "object") {
        const q = p.quote as QuoteData;
        setQuoteDraft(q);
        saveQuoteDraft(q);
      } else {
        setQuoteDraft(null);
        clearQuoteDraft();
      }
      setSelectedProjectId(p.id);
      setMsg({
        type: "info",
        text: `已加载项目：${p.contract_no || "无编号"} · ${p.project_name || "未命名"}`,
      });
    } catch (e: any) {
      setMsg({ type: "err", text: String(e?.message || e) });
    }
  };

  const deleteSelectedProject = async () => {
    if (!selectedProjectId) {
      setMsg({ type: "err", text: "请先选择历史项目" });
      return;
    }
    const item = projects.find((p) => p.id === selectedProjectId);
    if (!confirm(`确定删除历史项目？\n${item?.label || selectedProjectId}`)) return;
    try {
      const res = await api.deleteProject(selectedProjectId);
      setProjects(res.projects || []);
      setSelectedProjectId("");
      setMsg({ type: "ok", text: "历史项目已删除" });
    } catch (e: any) {
      setMsg({ type: "err", text: String(e?.message || e) });
    }
  };

  const validateBeforeGenerate = (): boolean => {
    if (!templatePath) {
      setMsg({ type: "err", text: "请先选择模板文件" });
      return false;
    }
    if (payMismatch) {
      setMsg({ type: "err", text: "预付款 + 尾款 ≠ 总费用，请先修正后再生成" });
      return false;
    }
    const empty = Object.entries(form)
      .filter(([, v]) => !String(v).trim())
      .map(([k]) => k);
    if (empty.length) {
      if (!confirm(`以下字段为空（示例）：\n${empty.slice(0, 5).join("\n")}\n\n仍要继续生成吗？`)) {
        return false;
      }
    }
    return true;
  };

  const onGenerateDocx = async () => {
    if (!validateBeforeGenerate()) return;
    setBusy(true);
    try {
      const res = await api.generateContract({
        template: templatePath,
        data: form,
        output_dir: outputDir,
        output_name: outputName,
      });
      const projNote = await persistProject({ silent: true });
      const extra = projNote ? ` · ${projNote}` : "";
      setMsg({ type: "ok", text: `DOCX 已生成：${res.docx || res.path}${extra}` });
    } catch (e: any) {
      setMsg({ type: "err", text: String(e?.message || e).replace(/\s+/g, " ").trim() });
    } finally {
      setBusy(false);
    }
  };

  const onGeneratePdf = async () => {
    if (!validateBeforeGenerate()) return;
    setBusy(true);
    try {
      const res = await api.exportPdf({
        template: templatePath,
        data: form,
        output_dir: outputDir,
        output_name: outputName,
      });
      const engine =
        res.pdf_engine === "wps"
          ? "WPS"
          : res.pdf_engine === "word"
            ? "Word"
            : res.pdf_engine || "未知";
      const projNote = await persistProject({ silent: true });
      const extra = projNote ? ` · ${projNote}` : "";
      setMsg({
        type: "ok",
        text: `PDF 已导出（${engine}）：${res.pdf}${extra}`,
      });
    } catch (e: any) {
      const raw = String(e?.message || e);
      const oneLine = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || raw;
      setMsg({ type: "err", text: oneLine });
    } finally {
      setBusy(false);
    }
  };

  if (view === "quote") {
    return (
      <QuoteEditor
        key={quoteSyncKey}
        projectName={form["替换的项目名称"] || ""}
        contractNo={form["替换的合同编号"] || ""}
        formTotal={parseAmount(form["替换的总费用"] || "")}
        formTaxRate={parseAmount(form["替换的税率"] || "")}
        initial={quoteDraft}
        onBack={(draft) => {
          setQuoteDraft(draft);
          setView("main");
        }}
        onSaved={(imagePath, data) => {
          // 仅把图片路径写入「费用表格图片」，不直接改合同文档
          setQuoteDraft(data);
          setForm((prev) => ({
            ...prev,
            "替换的费用表格图片": imagePath,
          }));
          setView("main");
          setMsg({ type: "ok", text: `报价表图片已填入：${imagePath}` });
        }}
      />
    );
  }

  return (
    <div className="dm-root">
      <header className="dm-titlebar">
        <div className="dm-author">@繁星之子卡萨蒂亚</div>
        {coeditHint ? (
          <div className="dm-coedit-hint" title="GUI 与 AI CLI 共享 .contract_tool/workspace.json">
            {coeditHint}
          </div>
        ) : (
          <div className="dm-coedit-hint dim" title="同一 DealMaker.exe 带参数即为 CLI，与界面共编">
            AI 共编就绪
          </div>
        )}
      </header>

      <div className="dm-body">
        <GroupBox title="模板文件">
          <div className="dm-row">
            <input
              type="text"
              className="dm-input grow"
              value={templatePath}
              placeholder="选择合同模板文件..."
              readOnly
            />
            <button type="button" className="dm-btn" onClick={pickTemplate}>
              选择文件
            </button>
          </div>
        </GroupBox>

        <div className="dm-splitter">
          <div className="dm-left">
            <GroupBox
              title={`历史项目${projects.length ? ` (${projects.length})` : ""}`}
              className="dm-project-group"
            >
              <div className="dm-contact-actions">
                <button type="button" className="dm-btn dm-btn-equal" onClick={clearForm}>
                  新建
                </button>
                <button
                  type="button"
                  className="dm-btn dm-btn-equal"
                  onClick={saveCurrentProject}
                  disabled={busy}
                >
                  保存
                </button>
                <button
                  type="button"
                  className="dm-btn dm-btn-equal"
                  onClick={deleteSelectedProject}
                  disabled={!selectedProjectId || busy}
                >
                  删除
                </button>
              </div>
              <div className="dm-contact-list dm-project-list">
                {projects.length === 0 ? (
                  <div className="dm-list-empty">
                    暂无历史项目
                    <br />
                    可点保存，或生成时自动保存
                  </div>
                ) : (
                  <ul>
                    {projects.map((p) => (
                      <li
                        key={p.id}
                        className={p.id === selectedProjectId ? "active" : ""}
                        title={`${p.label}\n${p.updated_at || ""}`}
                        onClick={() => loadProject(p.id)}
                      >
                        <div className="dm-project-label">{p.label}</div>
                        {p.party_b ? (
                          <div className="dm-project-sub">{p.party_b}</div>
                        ) : null}
                        {p.updated_at ? (
                          <div className="dm-project-time">{p.updated_at}</div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </GroupBox>

            <GroupBox title="联系人管理" className="dm-contact-group">
              <div className="dm-contact-actions">
                <button
                  type="button"
                  className="dm-btn dm-btn-equal"
                  onClick={saveCurrentContact}
                  disabled={busy}
                >
                  保存
                </button>
                <button
                  type="button"
                  className="dm-btn dm-btn-equal"
                  onClick={deleteCurrentContact}
                  disabled={busy}
                >
                  删除
                </button>
              </div>
              <div className="dm-contact-list">
                {contactNames.length === 0 ? (
                  <div className="dm-list-empty">暂无联系人，点击列表项加载</div>
                ) : (
                  <ul>
                    {contactNames.map((n) => (
                      <li
                        key={n}
                        className={n === selectedContact ? "active" : ""}
                        onClick={() => {
                          setSelectedContact(n);
                          loadContact(n);
                        }}
                      >
                        {n}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </GroupBox>
          </div>

          <div className="dm-right">
            {FORM_GROUPS.map((group) => (
              <GroupBox key={group.title} title={group.title}>
                {group.title === "费用信息" && (
                  <div className="dm-form-row">
                    <label className="dm-label">预付款比例:</label>
                    <div className="dm-field-line">
                      <input
                        type="number"
                        className="dm-input dm-ratio-input"
                        min={0}
                        max={100}
                        step={1}
                        value={ratio}
                        onChange={(e) => onRatioChange(e.target.value)}
                      />
                      <span className="dm-hint">%（默认 50，改总费用/比例时自动拆分）</span>
                    </div>
                  </div>
                )}
                {group.fields.map((f) => (
                  <div className="dm-form-row" key={f.key}>
                    <label className="dm-label">{f.label}:</label>
                    <div className="dm-field-line">
                      <input
                        type="text"
                        className={`dm-input grow${
                          (f.key === "替换的总费用" && feeQuoteMismatch.total) ||
                          (f.key === "替换的税率" && feeQuoteMismatch.tax)
                            ? " dm-input-mismatch"
                            : ""
                        }`}
                        value={form[f.key] || ""}
                        placeholder={f.placeholder}
                        onChange={(e) => setField(f.key, e.target.value)}
                        title={
                          (f.key === "替换的总费用" && feeQuoteMismatch.total) ||
                          (f.key === "替换的税率" && feeQuoteMismatch.tax)
                            ? "与报价表中的合计/税率不一致"
                            : undefined
                        }
                      />
                      {f.pick === "image" && (
                        <>
                          <button type="button" className="dm-btn" onClick={pickImage}>
                            选择
                          </button>
                          <button
                            type="button"
                            className="dm-btn dm-btn-outline"
                            onClick={openQuoteEditor}
                          >
                            制作报价表
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                {group.title === "费用信息" && payMismatch && (
                  <div className="dm-pay-warn">
                    <div className="dm-warn-text">
                      预付款 + 尾款 = {payMismatch.sum}，不等于总费用 {payMismatch.total}
                      （差额 {payMismatch.diff}）。自动修正将以预付款为准重算尾款。
                    </div>
                    <button type="button" className="dm-btn dm-btn-outline" onClick={onAutoFix}>
                      自动修正
                    </button>
                  </div>
                )}
              </GroupBox>
            ))}
          </div>
        </div>

        <GroupBox title="输出设置">
          <div className="dm-row dm-output-row">
            <span className="dm-inline-label">输出目录:</span>
            <input
              type="text"
              className="dm-input grow"
              value={outputDir}
              placeholder="默认与模板同目录"
              readOnly
            />
            <button type="button" className="dm-btn" onClick={pickOutputDir}>
              选择
            </button>
            <span className="dm-inline-label">文件名:</span>
            <input
              type="text"
              className="dm-input dm-filename"
              value={outputName}
              placeholder="合同编号_乙方名称"
              onChange={(e) => setOutputName(e.target.value)}
            />
          </div>
        </GroupBox>

        {msg && <div className={`dm-msg ${msg.type}`}>{msg.text}</div>}

        <div className="dm-gen-row">
          <button
            type="button"
            className="dm-gen-btn"
            onClick={onGenerateDocx}
            disabled={busy}
          >
            {busy ? "处理中…" : "生成 DOCX"}
          </button>
          <button
            type="button"
            className="dm-gen-btn"
            onClick={onGeneratePdf}
            disabled={busy}
          >
            {busy ? "处理中…" : "导出 PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}
