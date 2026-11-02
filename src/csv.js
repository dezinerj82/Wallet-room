// Spreadsheet-compatible UTF-8 CSV. No personal information in the template.
export const TEMPLATE_FIELDS = Object.freeze([
  "Category", "Item", "Month", "Amount", "OpeningBalance",
  "MonthlySaving", "AdjustableSaving", "AllowWithdrawal",
  "Repeat", "RepeatMonths", "RepeatEvery", "EndMonth",
  "ChangeFrom", "ChangeAmount", "RemindBefore", "LastService",
  "ServiceEvery", "HoverNote", "HoldOrder", "ShowRemaining",
  "ReminderDates"
]);

export function csvTemplate() {
  return "\uFEFF" + TEMPLATE_FIELDS.join(",") + "\r\n" +
    TEMPLATE_FIELDS.map(() => "").join(",") + "\r\n";
}

function decodeCsv(text) {
  if (typeof text !== "string" || text.length > 102400) {
    throw new Error("CSV file is too large.");
  }
  const rows = [];
  let row = [], cell = "", quoted = false, justClosed = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const char = src[i];
    if (quoted) {
      if (char === '"') {
        if (src[i+1] === '"') { cell += '"'; i++; }
        else { quoted = false; justClosed = true; }
      } else cell += char;
      continue;
    }
    if (char === '"') {
      if (cell.length || justClosed) throw new Error("Invalid CSV quote.");
      quoted = true;
    } else if (char === "," || char === "\n" || char === "\r") {
      row.push(cell);
      cell = "";
      justClosed = false;
      if (char !== ",") {
        rows.push(row);
        row = [];
        if (char === "\r" && src[i+1] === "\n") i++;
      }
    } else {
      if (justClosed) throw new Error("Invalid CSV field.");
      cell += char;
    }
  }
  if (quoted) throw new Error("Unclosed CSV quote.");
  if (cell.length || row.length || justClosed) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function bool(value, field) {
  if (!value) return false;
  if (/^(yes|y|true|1)$/i.test(value)) return true;
  if (/^(no|n|false|0)$/i.test(value)) return false;
  throw new Error("Invalid " + field + ".");
}

function money(value, field) {
  if (!value) return null;
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value)) {
    throw new Error("Invalid " + field + ".");
  }
  const amount = Number(value);
  if (!Number.isSafeInteger(Math.round(amount * 100))) {
    throw new Error("Amount is too large.");
  }
  return amount;
}

function keyMonth(value, field) {
  const s = value.replace(/-/g, "");
  if (!/^(?:19|20|21)\d{2}(?:0[1-9]|1[0-2])$/.test(s)) {
    throw new Error("Invalid " + field + ". Use YYYYMM.");
  }
  return s;
}

function exactInteger(value, name, options) {
  if (!/^\d+$/.test(value)) throw new Error("Invalid " + name + ".");
  const num = Number(value);
  if (!options.includes(num)) throw new Error("Invalid " + name + ".");
  return num;
}

export function parseWalletCsv(text, today = new Date()) {
  const rows = decodeCsv(text);
  const header = rows.shift();
  if (!header || header.length !== TEMPLATE_FIELDS.length ||
      !header.every((field,i) => field === TEMPLATE_FIELDS[i])) {
    throw new Error("Use Download template for this CSV.");
  }
  const current = String(today.getFullYear()) +
    String(today.getMonth()+1).padStart(2,"0");
  const items = [];
  for (let i = 0; i < rows.length; i++) {
    const fields = rows[i];
    if (fields.every(v => !v.trim())) continue;
    if (fields.length !== TEMPLATE_FIELDS.length) {
      throw new Error("CSV row " + (i+2) + " has missing columns.");
    }
    const data = Object.fromEntries(TEMPLATE_FIELDS.map((field,k) =>
      [field, fields[k].trim()]));
    const group = data.Category === "Income" ? "IN" : data.Category;
    if (!group || !data.Item) throw new Error("CSV row " + (i+2) + " needs Category and Item.");
    if (items.length >= 100) throw new Error("Too many CSV items.");
    const rowMonth = keyMonth(data.Month || current, "Month");
    if (rowMonth < current) {
      throw new Error("Past months are locked. Check row " + (i+2) + ".");
    }
    const amount = money(data.Amount,"Amount");
    const opening = money(data.OpeningBalance,"OpeningBalance");
    const savings = money(data.MonthlySaving,"MonthlySaving");
    const entry = { group, item:data.Item };
    if (opening !== null) entry.openingBalance = opening;
    if (group === "Saving" && amount !== null && amount > 0) {
      throw new Error("Use MonthlySaving for a savings target.");
    }
    if (amount !== null && amount > 0 && !data.Repeat) {
      entry.record = {month:rowMonth, amount};
    }

    let meta = {};
    if (data.HoverNote) meta.note = data.HoverNote;
    if (data.LastService) meta.lastService = keyMonth(data.LastService,"LastService");
    if (data.ServiceEvery) meta.interval =
      exactInteger(data.ServiceEvery,"ServiceEvery",[3,6,12]);
    if (data.RemindBefore && (data.LastService || data.ServiceEvery || !data.Repeat)) meta.remindBefore =
      exactInteger(data.RemindBefore,"RemindBefore",[0,1,2]);
    if (group === "Saving") {
      if (savings !== null) {
        meta.monthlySaving = savings;
        meta.savingFromMonth = rowMonth;
      }
      if (data.AdjustableSaving) meta.adjustableSaving = bool(data.AdjustableSaving,"AdjustableSaving");
      if (data.AllowWithdrawal) meta.access =
        bool(data.AllowWithdrawal,"AllowWithdrawal") ? "accessible" : "protected";
    } else if (data.AdjustableSaving || data.AllowWithdrawal || savings !== null || opening !== null) {
      throw new Error("Saving fields belong in Saving category.");
    }
    if (data.HoldOrder) {
      if (group !== "Bills") throw new Error("HoldOrder is for Bills only.");
      meta.holdPriority = exactInteger(data.HoldOrder,"HoldOrder",[0,1,2,3,4,5]);
    }
    if (data.ShowRemaining) meta.hoverUnpaid = bool(data.ShowRemaining,"ShowRemaining");
    if (Object.keys(meta).length) entry.meta = meta;

    if (data.Repeat) {
      if (!amount || amount <= 0) throw new Error("Recurring items need Amount.");
      const type = data.Repeat.toLowerCase();
      if (!["monthly","annual","interval"].includes(type)) {
        throw new Error("Repeat must be monthly, annual, or interval.");
      }
      const rule = {
        group,item:data.Item,type,start:rowMonth,amount,active:true
      };
      if (type === "annual") {
        const months = data.RepeatMonths.split(/[;|]/).map(s => s.trim()).filter(Boolean);
        if (!months.length) throw new Error("RepeatMonths required.");
        rule.months = months.map(m => exactInteger(m,"RepeatMonths",
          [1,2,3,4,5,6,7,8,9,10,11,12]));
      }
      if (type === "interval") rule.interval = exactInteger(
        data.RepeatEvery,"RepeatEvery",[1,3,6,12]);
      if (data.EndMonth) rule.end = keyMonth(data.EndMonth,"EndMonth");
      if (data.ChangeFrom || data.ChangeAmount) {
        if (!data.ChangeFrom || !data.ChangeAmount) {
          throw new Error("ChangeFrom and ChangeAmount must both be set.");
        }
        rule.changes = [{
          from:keyMonth(data.ChangeFrom,"ChangeFrom"),
          amount:money(data.ChangeAmount,"ChangeAmount")
        }];
      }
      if (data.RemindBefore) rule.remindBefore = exactInteger(
        data.RemindBefore,"RemindBefore",[0,1,2]);
      if (data.ReminderDates) {
        const alerts = [];
        for (const token of data.ReminderDates.split(/[;|]/)) {
          const match = /^(\d{2})-(\d{2}):(.+)$/.exec(token.trim());
          if (!match) throw new Error("Use MM-DD:Reminder for ReminderDates.");
          alerts.push({
            month:exactInteger(match[1],"Reminder month",[1,2,3,4,5,6,7,8,9,10,11,12]),
            day:exactInteger(match[2],"Reminder day",Array.from({length:31},(_,i)=>i+1)),
            text:match[3].trim()
          });
        }
        rule.alerts = alerts;
      }
      entry.schedule = rule;
    }
    items.push(entry);
  }
  if (!items.length) throw new Error("CSV is empty.");
  return { version:1, month:current, items };
}


/* Friendly Excel bulk-import format; advanced settings remain editable in the wallet. */
export const SIMPLE_FIELDS = Object.freeze(["Category", "Item", "Amount (RM)", "Start Month", "Repeat"]);
export function simpleWorkbook() {
  if (!globalThis.XLSX) throw new Error("Excel template is unavailable. Refresh and retry.");
  const ws = XLSX.utils.aoa_to_sheet([SIMPLE_FIELDS]);
  ws["!cols"] = [{wch:24},{wch:33},{wch:18},{wch:19},{wch:19}];
  ws["!autofilter"] = {ref:"A1:E101"};
  const explanations = [
    "Type Income, Saving, Bills, Others, or your own new category name. A new category will be created when imported.",
    "Name the item. Use one row per unique item in its category.",
    "Enter the amount in Malaysian ringgit, without RM. Leave blank if you are creating an item without an amount. For Saving, set the monthly target here.",
    "Type the starting month as YYYY-MM (example: 2026-11). Leave blank to start in the current month.",
    "Choose One-time, Monthly, or Yearly. Leave blank for One-time. For Saving, leave this blank."
  ];
  for (let i=0;i<5;i++) {
    const cell=ws[XLSX.utils.encode_cell({r:0,c:i})];
    cell.c=[{a:"Wallet guide",t:explanations[i]}];
  }
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,"Wallet Items");
  return XLSX.write(wb,{bookType:"xlsx",type:"array"});
}
export function parseSimpleWorkbook(bytes, today=new Date()) {
  if (!globalThis.XLSX) throw new Error("Excel reader is unavailable. Refresh and retry.");
  let book;
  try { book=XLSX.read(bytes,{type:"array",cellDates:false}); }
  catch { throw new Error("Could not read this Excel file. Use the downloaded Wallet template."); }
  if (book.SheetNames.length!==1) throw new Error("Use one sheet only. Download the current Wallet template.");
  const rows=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1,defval:"",raw:false,blankrows:false});
  if (!rows.length || SIMPLE_FIELDS.some((f,i)=>String(rows[0][i]||"").trim()!==f))
    throw new Error("The Excel headings have changed. Download the current Wallet template.");
  const current=String(today.getFullYear())+String(today.getMonth()+1).padStart(2,"0");
  const result=[]; const used=new Set();
  for(let i=1;i<rows.length;i++){
    const fields=rows[i];
    if(fields.every(v=>!String(v).trim()))continue;
    if(fields.slice(5).some(v=>String(v).trim()))throw new Error("Row "+(i+1)+": use only the five template columns.");
    const [category,item,amountText,monthText,repeatText]=Array.from({length:5},(_,k)=>String(fields[k]??"").trim());
    if(!category||!item)throw new Error("Row "+(i+1)+": enter Category and Item.");
    const group=category.toLowerCase()==="income"?"IN":category.toLowerCase()==="saving"?"Saving":category.toLowerCase()==="bills"?"Bills":category.toLowerCase()==="others"?"Others":category;
    const key=JSON.stringify([group.toLowerCase(),item.toLowerCase()]);
    if(used.has(key))throw new Error("Row "+(i+1)+": this item already appears in the same category.");
    used.add(key);
    if(result.length>=100)throw new Error("Only 100 items can be imported at a time.");
    let month=current;
    if(monthText){
      const m=/^((?:19|20|21)\d{2})[-/]?(0[1-9]|1[0-2])$/.exec(monthText);
      if(!m)throw new Error("Row "+(i+1)+": Start Month must be YYYY-MM.");
      month=m[1]+m[2];
    }
    if(month<current)throw new Error("Row "+(i+1)+": past months are locked.");
    const amount=amountText===""?null:Number(amountText);
    if(amount!==null&&(!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(amountText)||!Number.isSafeInteger(Math.round(amount*100))))
      throw new Error("Row "+(i+1)+": enter a valid positive amount in RM.");
    const repeat=repeatText.toLowerCase();
    if(!["","one-time","one time","monthly","yearly"].includes(repeat))
      throw new Error("Row "+(i+1)+": Repeat must be One-time, Monthly or Yearly.");
    if(group==="Saving"&&repeat&&!["one-time","one time"].includes(repeat))
      throw new Error("Row "+(i+1)+": Saving targets do not use Repeat.");
    const entry={group,item};
    if(group==="Saving"){
      if(amount!==null)entry.meta={monthlySaving:amount,savingFromMonth:month};
    }else if(repeat==="monthly"||repeat==="yearly"){
      if(amount===null||amount<=0)throw new Error("Row "+(i+1)+": repeating items need an amount above zero.");
      entry.schedule={group,item,type:repeat==="yearly"?"annual":"monthly",start:month,amount,active:true};
      if(repeat==="yearly")entry.schedule.months=[Number(month.slice(4))];
    }else if(amount!==null&&amount>0)entry.record={month,amount};
    result.push(entry);
  }
  if(!result.length)throw new Error("The Excel sheet has no items.");
  return {version:1,month:current,items:result};
}
