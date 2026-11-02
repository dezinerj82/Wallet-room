// Private Bills-only monthly recurrence. No amounts or rules are stored on GitHub.
// @RECUR directives live inside each app-owned item's private TXT history.
const DIRECTIVE = "@RECUR";
const MONTH_RE = /^(?:19|20|21)\d{2}(?:0[1-9]|1[0-2])$/;
import { isExpenseGroup } from "./groups.js";
const AMOUNT_RE = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;

function cleanText(text, max) {
  return typeof text === "string" && text.length <= max &&
    !/[\t\r\n\x00-\x1f]/.test(text);
}

export function parseRecurringDirective(line) {
  if (line?.startsWith("@RECUR2\t")) {
    try {
      const r = JSON.parse(line.slice(8));
      if (!isExpenseGroup(r.group) || typeof r.item !== "string" || !r.item.trim() ||
          r.item.length > 120 || !MONTH_RE.test(r.month) ||
          (r.end && (!MONTH_RE.test(r.end) || r.end < r.month)) ||
          !["monthly","weekly","annual"].includes(r.type) || typeof r.active !== "boolean" ||
          !Number.isFinite(r.amount) || r.amount < 0) return null;
      if (r.type === "weekly" && (!Array.isArray(r.days) || !r.days.length ||
          r.days.length > 7 || new Set(r.days.map(d=>d.day)).size !== r.days.length ||
          !r.days.every(d=>Number.isInteger(d.day) && d.day>=0 && d.day<=6 &&
            Number.isFinite(d.amount) && d.amount>0 &&
            Number.isSafeInteger(Math.round(d.amount*100))))) return null;
      return r;
    } catch { return null; }
  }
  if (typeof line !== "string") return null;
  const fields = line.replace(/\r$/, "").split("\t");
  if (fields.length !== 7 || fields[0] !== DIRECTIVE ||
      fields[1] !== "Bills" || !cleanText(fields[2], 120) ||
      !fields[2].trim() || !MONTH_RE.test(fields[3]) ||
      !AMOUNT_RE.test(fields[4]) || !cleanText(fields[5], 300) ||
      !["ON", "OFF"].includes(fields[6])) return null;
  const amount = Number(fields[4]);
  if (!Number.isSafeInteger(Math.round(amount * 100))) return null;
  return {
    group:"Bills", item: fields[2], month: fields[3], amount,
    remark: fields[5], active: fields[6] === "ON", type:"monthly", end:""
  };
}

export function recurringDirectiveLine(rule, active) {
  if (["weekly","monthly","annual"].includes(rule.type) || rule.end) {
    const value={group:rule.group||"Bills",item:rule.item,month:rule.month,
      amount:Number(rule.amount),remark:String(rule.remark||""),
      type:rule.type||"monthly",end:rule.end||"",
      days:rule.type==="weekly"?rule.days:undefined,active:Boolean(active)};
    if (!parseRecurringDirective("@RECUR2\t"+JSON.stringify(value)))
      throw new Error("Check recurring days, rates and end month.");
    return "@RECUR2\t"+JSON.stringify(value)+"\n";
  }
  const month = String(rule?.month || "");
  const item = String(rule?.item || "");
  const remark = String(rule?.remark || "");
  const rawAmount = String(rule?.amount ?? "");
  if (!cleanText(item, 120) || !item.trim() ||
      !MONTH_RE.test(month) || !AMOUNT_RE.test(rawAmount) ||
      !Number.isSafeInteger(Math.round(Number(rawAmount) * 100)) ||
      !cleanText(remark, 300)) {
    throw new Error("Invalid recurring bill.");
  }
  return [DIRECTIVE, "Bills", item, month,
    Number(rawAmount).toFixed(2), remark, active ? "ON" : "OFF"].join("\t") + "\n";
}

export function latestRecurringRule(content, item, group="Bills") {
  if (typeof content !== "string") return null;
  let rule = null;
  for (const line of content.split("\n")) {
    if (!line.startsWith(DIRECTIVE + "\t") && !line.startsWith("@RECUR2\t")) continue;
    const parsed = parseRecurringDirective(line);
    if (parsed && parsed.group === group && parsed.item.toLocaleLowerCase("en") ===
        String(item).toLocaleLowerCase("en")) rule = parsed;
  }
  return rule;
}

// Initial window: 2026–27. From June 2027, add 2028–29.
// From June 2029 add 2030–31, and so on every two years.
export function recurringHorizon(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (year < 2027 || (year === 2027 && month < 6)) return "202712";
  const cycle = Math.max(0, Math.floor(
    (year - 2027 - (month < 6 ? 1 : 0)) / 2
  ));
  const lastYear = Math.min(2199, 2029 + 2 * cycle);
  return String(lastYear) + "12";
}

export function recurringMonthsDue(content, rule, now = new Date()) {
  if (!rule?.active) return [];
  const cutoff = recurringHorizon(now);
  const current = String(now.getFullYear()) +
    String(now.getMonth() + 1).padStart(2, "0");
  const start = [current, rule.month].sort().at(-1);
  if (start > cutoff) return [];

  // Any earlier snapshot, edit or DELETE tombstone blocks regeneration.
  const seen = new Set();
  for (const line of content.split("\n")) {
    const fields = line.replace(/\r$/, "").split("\t");
    if (fields[0] === (rule.group||"Bills") &&
        String(fields[1] || "").toLocaleLowerCase("en") ===
          rule.item.toLocaleLowerCase("en") && MONTH_RE.test(fields[2])) {
      seen.add(fields[2]);
    }
  }
  const due = [];
  const startYear = Number(start.slice(0, 4));
  const endYear = Number(cutoff.slice(0, 4));
  for (let year = startYear; year <= endYear; year++) {
    for (let m = 1; m <= 12; m++) {
      const key = String(year) + String(m).padStart(2, "0");
      if (key >= start && key <= cutoff && (!rule.end || key <= rule.end) &&
          (rule.type !== "annual" || key.slice(4) === rule.month.slice(4)) && !seen.has(key)) due.push(key);
    }
  }
  return due;
}

export function recurringAmount(rule, month) {
  if (rule?.type !== "weekly") return Number(rule?.amount||0);
  const year=Number(month.slice(0,4)), mon=Number(month.slice(4,6))-1;
  const last=new Date(year,mon+1,0).getDate();
  let cents=0;
  for(let d=1;d<=last;d++) {
    const weekday=new Date(year,mon,d).getDay();
    const rate=rule.days.find(v=>v.day===weekday);
    if(rate)cents+=Math.round(rate.amount*100);
  }
  return cents/100;
}
export function recurringBillLine(rule, month) {
  if (!rule?.active || !MONTH_RE.test(month) || !cleanText(rule.item, 120) ||
      !rule.item.trim() || !Number.isFinite(rule.amount) || rule.amount < 0 ||
      !Number.isSafeInteger(Math.round(rule.amount * 100)) ||
      !cleanText(rule.remark, 300)) throw new Error("Invalid recurring bill.");
  const money = recurringAmount(rule,month).toFixed(2);
  const fields = [rule.group||"Bills", rule.item, month, money, "0.00", money];
  if ((rule.group||"Bills")==="Others") fields.push("","","");
  if (rule.remark) fields.push(rule.remark);
  return fields.join("\t") + "\n";
}
