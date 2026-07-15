import React, { useCallback, useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button, DetailLabel, FieldGrid, HintLabel, InfoCard, SectionTitle, TextField, WarnLabel } from "./components/ui";
import {
  amountToChinese,
  amountsEqual,
  autoFixFinal,
  parseAmount,
  splitByRatio,
} from "./lib/amount";
import * as api from "./lib/api";

const APP_VERSION = "2.0.0";

type FieldDef = { key: string; label: string; placeholder: string };
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
      { key: "替换的总费用", label: "总费用", placeholder: "输入数字，自动拆分预付/尾款" },
      { key: "替换的总费用大写", label: "总费用大写", placeholder: "自动转换，也可手动修改" },
      { key: "替换的税率", label: "税率", placeholder: "请输入税率，如：3" },
      { key: "替换的预付款", label: "预付款", placeholder: "可手动修改" },
      { key: "替换的预付款大写", label: "预付款大写", placeholder: "自动转换" },
      { key: "替换的尾款", label: "尾款", placeholder: "可手动修改" },
      { key: "替换的尾款大写", label: "尾款大写", placeholder: "自动转换" },
      { key: "替换的费用表格图片", label: "费用表格图片", placeholder: "图片路径，可点选择" },
    ],
  },
  {
    title: "开票信息",
    fields: [{ key: "替换的开票内容", label: "开票内容", placeholder: "请输入开票内容" }],
  },
  {
    title: "乙方财务信息",
    fields: [
      { key: "乙方银行账号", label: "银行账号", placeholder: "请输入银行账号" },
      { key: "乙方银行开户行", label: "开户行", placeholder: "请输入开户行名称" },
    ],
  },
  {
    title: "乙方联系人信息",
    fields: [
      { key: "替换的乙方代表名称", label: "代表名称", placeholder: "请输入联系人姓名" },
      { key: "替换的乙方代表电话", label: "代表电话", placeholder: "请输入联系电话" },
      { key: "替换的乙方代表邮箱", label: "代表邮箱", placeholder: "请输入联系邮箱" },
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

export function App() {
  const [form, setForm] = useState<Record<string, string>>(emptyForm);
  const [templatePath, setTemplatePath] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [outputName, setOutputName] = useState("");
  const [ratio, setRatio] = useState(50);
  const [contactNames, setContactNames] = useState<string[]>([]);
  const [selectedContact, setSelectedContact] = useState("");
  const [status, setStatus] = useState("就绪");
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
      if (key === "替换的总费用") {
        return applySplitFromTotal(value, ratio, prev);
      }
      if (key === "替换的预付款" || key === "替换的尾款") {
        return applyAmountChinese(key, value, prev);
      }
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
    getCurrentWindow().setTitle(`DealMaker v${APP_VERSION}`);
    (async () => {
      try {
        const settings = await api.loadSettings();
        if (settings.template_path) setTemplatePath(settings.template_path);
        if (settings.output_dir) setOutputDir(settings.output_dir);
        await refreshContacts();
        setStatus("就绪");
      } catch (e: any) {
        setStatus("后端未就绪");
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

  const onGenerate = async () => {
    if (!templatePath) {
      setMsg({ type: "err", text: "请先选择模板文件" });
      return;
    }
    if (payMismatch) {
      setMsg({ type: "err", text: "预付款 + 尾款 ≠ 总费用，请先修正后再生成" });
      return;
    }
    const empty = Object.entries(form)
      .filter(([, v]) => !String(v).trim())
      .map(([k]) => k);
    if (empty.length) {
      if (!confirm(`以下字段为空（示例）：\n${empty.slice(0, 5).join("\n")}\n\n仍要继续生成吗？`)) {
        return;
      }
    }
    setBusy(true);
    setStatus("生成中…");
    try {
      const res = await api.generateContract({
        template: templatePath,
        data: form,
        output_dir: outputDir,
        output_name: outputName,
      });
      setMsg({ type: "ok", text: `DOCX 已生成：\n${res.path}` });
      setStatus("生成成功");
    } catch (e: any) {
      setMsg({ type: "err", text: String(e?.message || e) });
      setStatus("生成失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dm-root">
      <header className="dm-header">
        <div className="dm-brand">DealMaker</div>
        <div className="dm-header-right">
          <span className="se-hint-label">v{APP_VERSION}</span>
          <span className="author">@繁星之子卡萨蒂亚</span>
        </div>
      </header>

      <section className="dm-toolbar se-card">
        <SectionTitle>模板文件</SectionTitle>
        <div className="se-btn-row" style={{ alignItems: "center" }}>
          <TextField value={templatePath} placeholder="选择合同模板文件…" readOnly />
          <Button onClick={pickTemplate}>选择文件</Button>
        </div>
      </section>

      <div className="dm-main">
        <aside className="dm-left se-card">
          <SectionTitle>联系人管理</SectionTitle>
          <div className="se-btn-row">
            <select
              value={selectedContact}
              onChange={(e) => setSelectedContact(e.target.value)}
              style={{ flex: 1 }}
            >
              <option value="">-- 选择已有联系人 --</option>
              {contactNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <Button onClick={() => loadContact(selectedContact)} disabled={!selectedContact}>
              加载
            </Button>
          </div>
          <div className="se-btn-row">
            <Button onClick={saveCurrentContact}>保存当前为联系人</Button>
            <Button onClick={clearForm}>新建</Button>
            <Button onClick={deleteCurrentContact}>删除选中</Button>
          </div>
          <div className="dm-contact-list">
            {contactNames.length === 0 ? (
              <div className="se-hint-label" style={{ padding: 10 }}>
                暂无联系人
              </div>
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
        </aside>

        <main className="dm-right">
          {FORM_GROUPS.map((group) => (
            <InfoCard key={group.title} title={group.title}>
              {group.title === "费用信息" && (
                <div className="dm-ratio-row">
                  <DetailLabel>预付款比例</DetailLabel>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={ratio}
                    onChange={(e) => onRatioChange(e.target.value)}
                    style={{ width: 90 }}
                  />
                  <HintLabel>%（默认 50，改总费用/比例时自动拆分）</HintLabel>
                </div>
              )}
              <FieldGrid>
                {group.fields.map((f) => (
                  <React.Fragment key={f.key}>
                    <DetailLabel>{f.label}</DetailLabel>
                    <div className="dm-field-with-btn">
                      <TextField
                        value={form[f.key] || ""}
                        placeholder={f.placeholder}
                        onChange={(v) => setField(f.key, v)}
                      />
                      {f.key === "替换的费用表格图片" && (
                        <Button onClick={pickImage}>选择</Button>
                      )}
                    </div>
                  </React.Fragment>
                ))}
              </FieldGrid>
              {group.title === "费用信息" && payMismatch && (
                <div className="dm-pay-warn">
                  <WarnLabel>
                    预付款 + 尾款 = {payMismatch.sum}，不等于总费用 {payMismatch.total}
                    （差额 {payMismatch.diff}）。点击自动修正将以预付款为准重算尾款。
                  </WarnLabel>
                  <Button primary onClick={onAutoFix}>
                    自动修正
                  </Button>
                </div>
              )}
            </InfoCard>
          ))}
        </main>
      </div>

      <section className="dm-output se-card">
        <SectionTitle>输出设置</SectionTitle>
        <div className="se-btn-row" style={{ alignItems: "center" }}>
          <DetailLabel>输出目录</DetailLabel>
          <TextField value={outputDir} placeholder="默认与模板同目录" readOnly />
          <Button onClick={pickOutputDir}>选择</Button>
          <DetailLabel>文件名</DetailLabel>
          <TextField
            value={outputName}
            placeholder="合同编号_项目名称（乙方）"
            onChange={setOutputName}
          />
        </div>
        <div className="se-btn-row" style={{ marginTop: 10 }}>
          <Button primary onClick={onGenerate} disabled={busy}>
            {busy ? "生成中…" : "生成 DOCX"}
          </Button>
        </div>
        {msg && (
          <div className={`dm-msg ${msg.type}`} style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>
            {msg.text}
          </div>
        )}
      </section>

      <footer className="se-statusbar">
        <span className="grow">{status}</span>
        <span className="author">@繁星之子卡萨蒂亚</span>
      </footer>
    </div>
  );
}
