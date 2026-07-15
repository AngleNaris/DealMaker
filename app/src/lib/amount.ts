/** 金额大写与付款拆分（前端即时计算，与 backend 逻辑一致） */

const DIGITS = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
const UNITS = ["", "拾", "佰", "仟"];
const BIG = ["", "万", "亿", "兆"];

export function amountToChinese(amount: number): string {
  if (!Number.isFinite(amount)) return "";
  if (amount === 0) return "零元整";
  if (amount < 0) return "负" + amountToChinese(-amount);

  amount = Math.round(amount * 100) / 100;
  const intPart = Math.trunc(amount);
  const decPart = Math.round((amount - intPart) * 100);
  let result = "";

  if (intPart > 0) {
    const intStr = String(intPart);
    const n = intStr.length;
    let zeroFlag = false;
    for (let i = 0; i < n; i++) {
      const d = Number(intStr[i]);
      const pos = n - i - 1;
      const unitIdx = pos % 4;
      const bigIdx = Math.floor(pos / 4);
      if (d === 0) {
        zeroFlag = true;
        if (unitIdx === 0 && bigIdx > 0) result += BIG[bigIdx];
      } else {
        if (zeroFlag) {
          result += "零";
          zeroFlag = false;
        }
        result += DIGITS[d] + UNITS[unitIdx];
        if (unitIdx === 0 && bigIdx > 0) result += BIG[bigIdx];
      }
    }
    result += "元";
  }

  if (decPart === 0) {
    result += "整";
  } else {
    const jiao = Math.floor(decPart / 10);
    const fen = decPart % 10;
    if (jiao > 0) result += DIGITS[jiao] + "角";
    else if (fen > 0) result += "零";
    if (fen > 0) result += DIGITS[fen] + "分";
  }
  return result;
}

export function splitByRatio(total: number, ratioPercent: number): { prepaid: number; final: number } {
  const prepaid = Math.round((total * ratioPercent) / 100 * 100) / 100;
  const final = Math.round((total - prepaid) * 100) / 100;
  return { prepaid, final };
}

/** 策略 A：锁预付，修正尾款 */
export function autoFixFinal(total: number, prepaid: number): { prepaid: number; final: number } {
  let p = Math.round(prepaid * 100) / 100;
  if (p > total) {
    p = Math.round(total * 100) / 100;
    return { prepaid: p, final: 0 };
  }
  if (p < 0) p = 0;
  return { prepaid: p, final: Math.round((total - p) * 100) / 100 };
}

export function parseAmount(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function amountsEqual(a: number, b: number, eps = 0.005): boolean {
  return Math.abs(a - b) <= eps;
}
