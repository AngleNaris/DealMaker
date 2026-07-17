/** 生成与模板一致的报价表 HTML，供浏览器无头截图 */

import {
  QuoteData,
  formatMoney,
  formatPrice,
  labeledSpecTags,
  qtyLabel,
  sumPartner,
} from "./quote";

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const CSS = `
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: #ffffff;
}
body {
  color: #000000;
  font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Heiti SC", "Source Han Sans SC", "Noto Sans CJK SC", sans-serif;
  font-size: 12.5px;
  line-height: 1.4;
  -webkit-font-smoothing: antialiased;
  width: fit-content;
}
table {
  width: 1100px;
  max-width: 1100px;
  border-collapse: collapse;
  border: 1px solid #000000;
  font-size: 12.5px;
}
.title-row td {
  border: 1px solid #000000;
  background: #d6d6d6;
  color: #000000;
  text-align: center;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 3px;
  padding: 11px 8px;
}
thead th {
  border: 1px solid #000000;
  background: #ececec;
  color: #000000;
  font-weight: 700;
  font-size: 12.5px;
  text-align: center !important;
  vertical-align: middle;
  padding: 8px 6px;
  white-space: nowrap;
}
tbody td {
  border: 1px solid #000000;
  padding: 9px 8px;
  vertical-align: middle;
  color: #000000;
}
.c-idx { width: 42px; }
.c-name { width: 132px; }
.c-qty { width: 64px; }
.c-dur { width: 56px; }
.c-price { width: 104px; }
.c-partner { width: 104px; }
.c-spec { width: auto; min-width: 250px; }
.c-note { width: 124px; }
tbody .c-idx { text-align: center; }
tbody .c-name { text-align: center; font-weight: 600; word-break: break-word; }
tbody .c-qty { text-align: center; }
tbody .c-dur { text-align: center; }
tbody .c-price {
  text-align: right;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, "Courier New", monospace;
  font-size: 14px;
}
tbody .c-partner { text-align: right; }
tbody .c-spec { text-align: left; }
tbody .c-note { text-align: left; font-size: 11px; word-break: break-word; }
.price-lg {
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, "Courier New", monospace;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.3px;
}
.price-lg-symbol {
  font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  font-size: 15px;
  font-weight: 700;
  margin-right: 1px;
}
.spec-tags { display: flex; flex-wrap: wrap; gap: 4px 6px; margin: 0; }
.tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border: 1px solid #c4c4c4;
  background: #f0f0f0;
  font-size: 12px;
  line-height: 1.6;
  white-space: nowrap;
  color: #000000;
  max-width: 100%;
}
.tag .k { font-weight: 700; margin-right: 4px; }
.tag .v { color: #000000; white-space: normal; word-break: break-word; }
tfoot td {
  border: 1px solid #000000;
  padding: 10px 8px;
  background: #f2f2f2;
  font-weight: 700;
  font-size: 12.5px;
  color: #000000;
}
.foot-label { text-align: center; }
.foot-amount { text-align: right; }
.foot-amount .price-lg { font-size: 17px; }
.foot-amount .price-lg-symbol { font-size: 16px; }
.foot-note { text-align: center; font-weight: 400; word-break: break-word; }
`;

export function buildQuoteHtml(data: QuoteData): string {
  const total = sumPartner(data.rows);
  const rowsHtml = data.rows
    .map((row, i) => {
      const tags = labeledSpecTags(row.specs);
      const tagsHtml =
        tags.length > 0
          ? `<div class="spec-tags">${tags
              .map(
                (t) =>
                  `<span class="tag"><span class="k">${esc(t.key)}</span><span class="v">${esc(
                    t.value
                  )}</span></span>`
              )
              .join("")}</div>`
          : "—";
      const unitCell =
        row.unitPrice === "/"
          ? "/"
          : `¥${esc(formatMoney(row.unitPrice as number))}`;
      const partnerCell =
        row.partnerPrice === "/"
          ? "/"
          : `<span class="price-lg-symbol">¥</span><span class="price-lg">${esc(
              formatMoney(row.partnerPrice as number)
            )}</span>`;
      return `<tr>
  <td class="c-idx">${i + 1}</td>
  <td class="c-name">${esc(row.name || "—")}</td>
  <td class="c-qty">${esc(qtyLabel(row.qty))}</td>
  <td class="c-dur">${esc(row.duration || "/")}</td>
  <td class="c-price">${unitCell}</td>
  <td class="c-partner">${partnerCell}</td>
  <td class="c-spec">${tagsHtml}</td>
  <td class="c-note">${esc(row.note || "")}</td>
</tr>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>${CSS}</style>
</head>
<body>
<table>
  <thead>
    <tr class="title-row"><td colspan="8">${esc(data.title || "项目标题 报价明细")}</td></tr>
    <tr>
      <th class="c-idx">编号</th>
      <th class="c-name">服务名称</th>
      <th class="c-qty">数量</th>
      <th class="c-dur">时长</th>
      <th class="c-price">单价</th>
      <th class="c-partner">合作价</th>
      <th class="c-spec">交付规格</th>
      <th class="c-note">其它备注</th>
    </tr>
  </thead>
  <tbody>
${rowsHtml}
  </tbody>
  <tfoot>
    <tr>
      <td class="foot-label" colspan="4">${esc(data.taxNote || "总计")}</td>
      <td class="foot-amount" colspan="2"><span class="price-lg-symbol">¥</span><span class="price-lg">${esc(
        formatMoney(total)
      )}</span></td>
      <td class="foot-note" colspan="2">${esc(data.footNote || "")}</td>
    </tr>
  </tfoot>
</table>
</body>
</html>`;
}
