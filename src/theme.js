// UI-only theme preferences. Never reads, changes, or uploads wallet records.
export const DEFAULT_THEME = Object.freeze({
  primary: "#223A5E", secondary: "#79C8D6", navigation: "#F1CCB7",
  background: "#F7FAFC", focus: "#FEDC8B",
  success: "#62CFA5", danger: "#E97A8D",
  category0: "#50ADE1", category1: "#B16BD6", category2: "#FF9E8B",
  category3: "#DF74A8", category4: "#FB8B89",
  category5: "#FEDC8B", category6: "#79C8D6"
});
export const THEME_FIELDS = [
  ["primary", "Primary"], ["secondary", "Secondary"],
  ["navigation", "Navigation"], ["background", "Background"],
  ["focus", "Active / Focus / Progress"],
  ["success", "Success"], ["danger", "Warning & Danger"],
  ...Array.from({length: 7}, (_, n) => ["category" + n, "Category " + (n + 1)])
];
const STORAGE_KEY = "home-wallet-ui-theme-v1";
const LAYOUTS = ["compact", "comfortable", "wide"];
const HEX = /^#[0-9a-fA-F]{6}$/;
const channel = n => Math.max(0, Math.min(255, Math.round(n)));
const parts = hex => [1,3,5].map(i => parseInt(hex.slice(i, i + 2), 16));
const toHex = values => "#" + values.map(n => channel(n).toString(16).padStart(2,"0")).join("").toUpperCase();
const mix = (a,b,t) => toHex(parts(a).map((v,i) => v * (1-t) + parts(b)[i] * t));
const luminance = hex => {
  const linear = parts(hex).map(v => {
    const s = v / 255;
    return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
  });
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
};
export function contrastRatio(a,b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x,y) + .05) / (Math.min(x,y) + .05);
}
function readableOn(bg) {
  const dark = "#172B42", light = "#FFFFFF";
  if (contrastRatio(bg, dark) >= 4.5) return dark;
  if (contrastRatio(bg, light) >= 4.5) return light;
  // Pure black is a safe fallback when a middle shade defeats both choices.
  return "#000000";
}
const sanitize = raw => {
  const colors = {...DEFAULT_THEME};
  for (const key of Object.keys(colors)) {
    if (typeof raw?.colors?.[key] === "string" && HEX.test(raw.colors[key]))
      colors[key] = raw.colors[key].toUpperCase();
  }
  return {colors, layout: LAYOUTS.includes(raw?.layout) ? raw.layout : "comfortable"};
};
function load() {
  try { return sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
  catch { return sanitize(null); }
}
let current = load();
export function getTheme() {
  return {colors:{...current.colors},layout:current.layout};
}
export function setTheme(next) {
  current = sanitize(next);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); }
  catch { /* Browsers may forbid local persistence; theme still works in this tab. */ }
  applyTheme();
}
function setVar(key,value) { document.documentElement.style.setProperty(key,value); }
export function applyTheme() {
  const c = current.colors;
  const root = document.documentElement;
  root.dataset.density = current.layout;
  for (const [key, hex] of Object.entries(c)) {
    setVar("--theme-" + key, hex);
    setVar("--theme-" + key + "-text", readableOn(hex));
    const hover = mix(hex, c.background, .4);
    setVar("--theme-" + key + "-hover", hover);
    setVar("--theme-" + key + "-hover-text", readableOn(hover));
    setVar("--theme-" + key + "-soft", mix(hex, c.background, .84));
    const [r,g,b] = parts(hex);
    setVar("--theme-" + key + "-glow", "rgba(" + r + "," + g + "," + b + ",.4)");
  }
  // Progress inherits Active / Focus, including user changes and glow.
  for (const suffix of ["", "-text", "-hover", "-hover-text", "-soft", "-glow"]) {
    setVar("--theme-progress" + suffix, "var(--theme-focus" + suffix + ")");
  }
  const bodyText = readableOn(c.background);
  const darkBackground = bodyText === "#FFFFFF";
  setVar("--theme-content", bodyText);
  setVar("--theme-content-muted", mix(bodyText,c.background,.34));
  // Surface tone follows the page tone so foreground text stays readable.
  setVar("--theme-surface", mix(c.background, darkBackground ? "#000000" : "#FFFFFF",
    darkBackground ? .18 : .55));
  setVar("--theme-content-panel", mix(c.background,
    darkBackground ? "#000000" : "#FFFFFF", .08));
  setVar("--theme-subtle", mix(c.background,c.primary,.12));
  setVar("--theme-chart-0", c.category0);
  setVar("--theme-chart-1", c.category1);
  setVar("--theme-chart-2", c.category2);
  setVar("--theme-chart-3", c.category3);
  setVar("--theme-chart-4", c.category4);
  window.dispatchEvent(new CustomEvent("wallet-theme-changed"));
}
export function categoryIndex(group) {
  const core = {IN:0,Saving:1,Bills:2,Others:3};
  if (Object.prototype.hasOwnProperty.call(core, group)) return core[group];
  // Stable by category identity, rather than positional numbering.
  let hash = 2166136261;
  for (const codepoint of String(group)) {
    hash ^= codepoint.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return 4 + (hash >>> 0) % 3;
}
export function colorizeCategory(element, group) {
  const i = categoryIndex(group);
  element.style.setProperty("--btn-bg", "var(--theme-category" + i + ")");
  element.style.setProperty("--btn-text", "var(--theme-category" + i + "-text)");
  element.style.setProperty("--btn-hover", "var(--theme-category" + i + "-hover)");
  element.style.setProperty("--btn-hover-text", "var(--theme-category" + i + "-hover-text)");
  // Notes use the same 40% background overlay as category hover states.
  element.style.setProperty("--theme-note-bg", "var(--theme-category" + i + "-hover)");
  element.style.setProperty("--theme-note-fg", "var(--theme-category" + i + "-hover-text)");
}
export function themeWarning(colors) {
  const risks = [];
  if (contrastRatio(colors.primary,colors.background) < 3)
    risks.push("Primary and background colors are too similar.");
  if (contrastRatio(colors.secondary,colors.navigation) < 1.5)
    risks.push("Secondary and navigation colors are difficult to distinguish.");
  if (contrastRatio(colors.success,colors.danger) < 1.5)
    risks.push("Success and danger colors are difficult to distinguish.");
  return risks.join(" ") || "Text contrast is adjusted automatically.";
}
applyTheme();
