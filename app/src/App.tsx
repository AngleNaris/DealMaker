import React, { useCallback, useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  amountToChinese,
  amountsEqual,
  autoFixFinal,
  parseAmount,
  splitByRatio,
} from "./lib/amount";
import * as api from "./lib/api";

const APP_VERSION = "2.0.0";

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

function emptyForm(): Record<string, string> {
  const o: Record<string, string> = {};
  for (const g of FORM_GROUPS) for (const f of g.fields) o[f.key] = "";
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
  const [selectedContact, setSelectedContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err" | "info"; text: string } | null>(null);

  const payMismatch = useMemo(() => {
    const total = parseAmount(form["替换的总费用"] || "");
    const prepaid = parseAmount(form["替换的预付款"] || "");
    const finalPay = parseAmount(form["替换的尾款"] || "");
    if (total === null || prepaid === null || finalPay === null) return null;
    const sum = Math.round((prepaid + finalPay) * 100) / 100;
    if (amountsEqual(sum, total)) return null;
    return { total, prepaid, finalPay, sum, diff: Math.round((total - sum) * 100) / 100 };
  }, [form]);

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

  const refreshContacts = async () => {
    const res = await api.listContacts();
    setContactNames(res.names || []);
  };

  useEffect(() => {
    (async () => {
      try {
        await getCurrentWindow().setTitle(`DealMaker v${APP_VERSION}`);
      } catch {
        /* 浏览器预览时忽略 */
      }
      try {
        const settings = await api.loadSettings();
        if (settings.template_path) setTemplatePath(settings.template_path);
        if (settings.output_dir) setOutputDir(settings.output_dir);
        await refreshContacts();
      } catch (e: any) {
        setMsg({ type: "err", text: String(e?.message || e) });
      }
    })();
  }, []);

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

  const loadContact = async (name: string) => {
    if (!name) return;
    try {
      const list = await api.listContacts();
      const found = (list.contacts || []).find(
        (c) => c["替换的乙方名称"] === name || c["乙方名称"] === name
      );
      if (!found) return;
      setForm((prev) => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(found)) {
          if (k in next || FORM_GROUPS.some((g) => g.fields.some((f) => f.key === k))) {
            next[k] = String(v ?? "");
          }
        }
        return next;
      });
      setSelectedContact(name);
      setMsg({ type: "info", text: `已加载联系人：${name}` });
    } catch (e: any) {
      setMsg({ type: "err", text: String(e?.message || e) });
    }
  };

  const saveCurrentContact = async () => {
    try {
      const res = await api.saveContact(form);
      setContactNames(res.names);
      setSelectedContact(res.name);
      setMsg({ type: "ok", text: `联系人「${res.name}」已保存` });
    } catch (e: any) {
      setMsg({ type: "err", text: String(e?.message || e) });
    }
  };

  const deleteCurrentContact = async () => {
    if (!selectedContact) {
      setMsg({ type: "err", text: "请先选择联系人" });
      return;
    }
    if (!confirm(`确定删除联系人「${selectedContact}」？`)) return;
    try {
      const res = await api.deleteContact(selectedContact);
      setContactNames(res.names);
      setSelectedContact("");
      setMsg({ type: "ok", text: "已删除" });
    } catch (e: any) {
      setMsg({ type: "err", text: String(e?.message || e) });
    }
  };

  const clearForm = () => {
    setForm(emptyForm());
    setSelectedContact("");
    setMsg(null);
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
      setMsg({ type: "ok", text: `DOCX 已生成：\n${res.docx || res.path}` });
    } catch (e: any) {
      setMsg({ type: "err", text: String(e?.message || e) });
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
            ? "Microsoft Word"
            : res.pdf_engine || "未知";
      setMsg({
        type: "ok",
        text: `PDF 已导出（引擎: ${engine}）：\n${res.pdf}\n\n同时生成 DOCX：\n${res.docx}`,
      });
    } catch (e: any) {
      setMsg({ type: "err", text: String(e?.message || e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dm-root">
      <header className="dm-titlebar">
        <div className="dm-author">@繁星之子卡萨蒂亚</div>
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
            <GroupBox title="联系人管理" className="dm-contact-group">
              <div className="dm-contact-actions">
                <button type="button" className="dm-btn dm-btn-equal" onClick={saveCurrentContact}>
                  保存
                </button>
                <button type="button" className="dm-btn dm-btn-equal" onClick={clearForm}>
                  新建
                </button>
                <button type="button" className="dm-btn dm-btn-equal" onClick={deleteCurrentContact}>
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
                        className="dm-input grow"
                        value={form[f.key] || ""}
                        placeholder={f.placeholder}
                        onChange={(e) => setField(f.key, e.target.value)}
                      />
                      {f.pick === "image" && (
                        <button type="button" className="dm-btn" onClick={pickImage}>
                          选择
                        </button>
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
