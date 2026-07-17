import React, { forwardRef } from "react";
import {
  QuoteData,
  formatMoney,
  formatPrice,
  labeledSpecTags,
  qtyLabel,
  sumPartner,
} from "../lib/quote";
import "../styles/quote-preview.css";

type Props = { data: QuoteData; forExport?: boolean };

export const QuotePreview = forwardRef<HTMLDivElement, Props>(function QuotePreview(
  { data, forExport = false },
  ref
) {
  const total = sumPartner(data.rows);

  return (
    <div
      className={`quote-capture${forExport ? " quote-capture--export" : ""}`}
      ref={ref}
    >
      <table>
        <thead>
          <tr className="title-row">
            <td colSpan={8}>{data.title || "项目标题 报价明细"}</td>
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
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, i) => {
            const tags = labeledSpecTags(row.specs);
            return (
              <tr key={row.id}>
                <td className="c-idx">{i + 1}</td>
                <td className="c-name">{row.name || "—"}</td>
                <td className="c-qty">{qtyLabel(row.qty)}</td>
                <td className="c-dur">{row.duration || "/"}</td>
                <td className="c-price">{formatPrice(row.unitPrice)}</td>
                <td className="c-partner">
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
                </td>
                <td className="c-spec">
                  {tags.length > 0 ? (
                    <div className="spec-tags">
                      {tags.map((t, j) => (
                        <span className="tag" key={`${row.id}_t${j}`}>
                          <span className="k">{t.key}</span>
                          <span className="v">{t.value}</span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="c-note">{row.note || ""}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td className="foot-label" colSpan={4}>
              {data.taxNote || "总计"}
            </td>
            <td className="foot-amount" colSpan={2}>
              <span className="price-lg-symbol">¥</span>
              <span className="price-lg">{formatMoney(total)}</span>
            </td>
            <td className="foot-note" colSpan={2}>
              {data.footNote || ""}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
});
