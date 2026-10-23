// Společný stav stránky, konstanty a drobní pomocníci pro DOM. Moduly spolu mluví přes on/emit.

export const CZ_BOUNDS = [[48.55, 12.09], [51.06, 18.86]];
export const PAGE_DESKTOP = 200;
export const PAGE_MOBILE = 50;
export const LIB_FORMS = ["knihovna", "knihovny", "knihoven"];
export const CATEGORIES = [
  ["obecni", "Obecní a městské"],
  ["krajske", "Krajské a Národní knihovna"],
  ["vysokoskolske", "Vysokoškolské"],
  ["odborne", "Odborné (lékařské, vědecké, muzejní…)"],
];
export const CATEGORY_KEYS = CATEGORIES.map(([key]) => key);
export const SERVICES = [
  ["wifi", "Wi-Fi"],
  ["bibliobox", "Bibliobox (vrácení mimo otevírací dobu)"],
];

export const app = {
  libs: [],
  byId: new Map(),
  markers: new Map(),
  places: [],
  states: new Map(),
  visible: { matching: [], unknownHours: [] },
  map: null,
  point: null,
  pointLabel: "",
  selected: null,
  sortMode: null, // null = výchozí podle toho, jestli je známé místo
  pages: 1,
  startDismissed: false,
  generated: "",
  colors: {},
};

export const filters = {
  region: "", district: "", categories: new Set(), mainOnly: false, openNow: false, weekend: false,
  includeUnknown: true, services: new Set(),
};

export const $ = (sel) => document.querySelector(sel);

const mobileQuery = window.matchMedia("(max-width: 899px)");
export const isMobile = () => mobileQuery.matches;

// Přechod mezi počítačem a mobilem (otočení tabletu, zúžení okna); volá fn jen při skutečné změně režimu.
export function onLayoutChange(fn) {
  let last = isMobile();
  const check = () => {
    if (isMobile() === last) return;
    last = isMobile();
    fn();
  };
  mobileQuery.addEventListener("change", check);
  window.addEventListener("resize", check);
}

// Texty z dat se vkládají jako text, nikdy jako HTML.
export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

export function icon(name, cls = "icon") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d}. ${m}. ${y}`;
}

export function formatKm(km) {
  if (km < 1) return `${Math.round((km * 1000) / 10) * 10} m`;
  return km < 10 ? `${km.toFixed(1).replace(".", ",")} km` : `${Math.round(km)} km`;
}

let messageTimer;
export function showMessage(text, ms = 6000) {
  const box = $("#message");
  box.textContent = text;
  box.hidden = false;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => (box.hidden = true), ms);
}

const handlers = {};
export const on = (event, fn) => (handlers[event] ||= []).push(fn);
export const emit = (event, ...args) => (handlers[event] || []).forEach((fn) => fn(...args));
