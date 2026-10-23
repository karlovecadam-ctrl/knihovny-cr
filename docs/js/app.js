// Propojení dat, mapy (Leaflet) a panelu se seznamem, detailem a filtry.
import { applyFilters, buildPlaces, distanceKm, searchLocal, sortForList } from "./filters.js";
import { DAY_SHORT, formatFund, formatInterval, mapyUrl, plural, statusText } from "./format.js";
import { createGeocoder } from "./geocode.js";
import { openStatus, pragueNow, stateChanges } from "./status.js";

const LIST_LIMIT = 200;
const CZ_BOUNDS = [[48.55, 12.09], [51.06, 18.86]];
const LIB_FORMS = ["knihovna", "knihovny", "knihoven"];
const CATEGORIES = [
  ["obecni", "Obecní a městské"],
  ["krajske", "Krajské a Národní knihovna"],
  ["vysokoskolske", "Vysokoškolské"],
  ["odborne", "Odborné (lékařské, vědecké, muzejní…)"],
];
const SERVICES = [
  ["wifi", "Wi-Fi"],
  ["bibliobox", "Bibliobox (vrácení mimo otevírací dobu)"],
];

const $ = (sel) => document.querySelector(sel);

// Malý pomocník pro DOM: texty se vkládají jako text, nikdy jako HTML.
function h(tag, props = {}, ...children) {
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

export const app = {
  libs: [],
  byId: new Map(),
  markers: new Map(),
  map: null,
  cluster: null,
  highlight: null,
  places: [],
  point: null,
  pointLabel: "",
  pointMarker: null,
  selected: null,
  visible: { matching: [], unknownHours: [] },
  colors: {},
  states: new Map(),
  generated: "",
};

export const filters = {
  region: "", district: "", categories: new Set(), mainOnly: false, openNow: false, weekend: false,
  includeUnknown: true, services: new Set(),
};

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d}. ${m}. ${y}`;
}

function formatKm(km) {
  if (km < 1) return `${Math.round(km * 1000 / 10) * 10} m`;
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

/* ---------- Mapa ---------- */

function markerStyle(state) {
  return {
    radius: 7,
    weight: state === "unknown" ? 1.5 : 2,
    color: state === "unknown" ? app.colors.closed : "#ffffff",
    fillColor: app.colors[state],
    fillOpacity: 1,
  };
}

function clusterIcon(cluster) {
  const children = cluster.getAllChildMarkers();
  let open = 0;
  let closed = 0;
  for (const m of children) {
    if (m.options.state === "open") open++;
    else if (m.options.state === "closed") closed++;
  }
  const n = children.length;
  const size = n < 10 ? 30 : n < 100 ? 36 : n < 1000 ? 42 : 48;
  const o = (open / n) * 100;
  const c = ((open + closed) / n) * 100;
  return L.divIcon({
    html: `<div class="cluster" style="--o:${o}%;--c:${c}%"><span>${n}</span></div>`,
    className: "",
    iconSize: [size, size],
  });
}

function setupMap() {
  app.colors = { open: cssVar("--m-open"), closed: cssVar("--m-closed"), unknown: cssVar("--m-unknown"), accent: "#2a4f9e" };
  app.map = L.map("map", { preferCanvas: true, attributionControl: false }).fitBounds(CZ_BOUNDS);
  // na mobilu nahoře, aby zdroj mapy a legendu nepřekryl vysouvací panel
  const corner = isMobile() ? "topright" : null;
  L.control.attribution({ position: corner || "bottomright" }).addTo(app.map);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">přispěvatelé OpenStreetMap</a>',
  }).addTo(app.map);
  app.cluster = L.markerClusterGroup({
    chunkedLoading: true,
    showCoverageOnHover: false,
    maxClusterRadius: 50,
    disableClusteringAtZoom: 14,
    iconCreateFunction: clusterIcon,
  });
  app.map.addLayer(app.cluster);

  const legend = L.control({ position: corner || "bottomleft" });
  legend.onAdd = () => {
    const box = L.DomUtil.create("div", "legend");
    box.innerHTML = `<b>Teď</b>
      <div><i style="background:${app.colors.open}"></i>otevřeno</div>
      <div><i style="background:${app.colors.closed}"></i>zavřeno</div>
      <div><i style="background:${app.colors.unknown};border-color:${app.colors.closed}"></i>nelze určit</div>`;
    return box;
  };
  legend.addTo(app.map);
  app.map.on("moveend", () => {
    if (!app.selected) renderList();
  });
}

function buildMarkers() {
  app.states = stateChanges(app.libs, new Map(), new Date()).states;
  for (const lib of app.libs) {
    if (lib.lat == null) continue;
    const state = app.states.get(lib.id);
    const marker = L.circleMarker([lib.lat, lib.lon], markerStyle(state));
    marker.options.state = state;
    // Leaflet vkládá řetězec jako HTML; název z adresáře proto předáváme jako textový uzel
    marker.bindTooltip(() => document.createTextNode(lib.name), { direction: "top", offset: [0, -6] });
    marker.on("click", () => openDetail(lib.id));
    app.markers.set(lib.id, marker);
  }
}

// Každou minutu: překreslit jen knihovny, kterým se stav změnil.
function refreshStates() {
  const { states, changed } = stateChanges(app.libs, app.states, new Date());
  app.states = states;
  if (!changed.length) return;
  const touched = [];
  for (const id of changed) {
    const marker = app.markers.get(id);
    if (!marker) continue;
    marker.options.state = states.get(id);
    marker.setStyle(markerStyle(states.get(id)));
    touched.push(marker);
  }
  if (touched.length) app.cluster.refreshClusters(touched);
  // výběr na mapě závisí na čase jen u „otevřeno teď“ a při skrytých neznámých
  if (filters.openNow || !filters.includeUnknown) applyAndRender();
  else if (!app.selected) renderList();
  if (app.selected && changed.includes(app.selected)) renderDetail(app.byId.get(app.selected));
}

export function applyAndRender() {
  app.visible = applyFilters(app.libs, filters, new Date());
  const shown = [...app.visible.matching, ...app.visible.unknownHours]
    .map((lib) => app.markers.get(lib.id))
    .filter(Boolean);
  app.cluster.clearLayers();
  app.cluster.addLayers(shown);
  updateFilterCount();
  if (!app.selected) renderList();
}

/* ---------- Seznam ---------- */

function listItem(lib, now, today) {
  const st = openStatus(lib.hours, now);
  const dist = app.point && lib.lat != null ? formatKm(distanceKm(app.point, lib)) : null;
  return h("li", {},
    h("button", { class: "item", type: "button", "data-id": lib.id, onclick: () => openDetail(lib.id, { pan: true }) },
      h("span", { class: "item-name" }, lib.name),
      h("span", { class: "item-meta" },
        lib.municipality ? h("span", {}, lib.municipality) : null,
        dist ? h("span", {}, `· ${dist}`) : null),
      h("span", { class: `state state-${st.state}` }, statusText(st, today, Boolean(lib.hours)))));
}

export function renderList() {
  const list = $("#list");
  const summary = $("#list-summary");
  const bounds = app.map.getBounds();
  const inView = (lib) => lib.lat != null && bounds.contains([lib.lat, lib.lon]);
  const main = sortForList(app.visible.matching.filter(inView), app.point);
  const unknown = sortForList(app.visible.unknownHours.filter(inView), app.point);
  const total = main.length + unknown.length;
  const now = new Date();
  const { day } = pragueNow(now);

  summary.replaceChildren(
    total ? `${plural(total, LIB_FORMS)} ve výřezu mapy` : "",
    app.point ? ` · podle vzdálenosti ${app.pointLabel} ` : "",
    app.point ? h("button", { class: "linkish", type: "button", onclick: clearPoint }, "zrušit") : "",
  );
  const focusedId = document.activeElement?.closest?.("#list .item")?.dataset.id;
  list.replaceChildren();

  if (!total) {
    list.append(h("li", { class: "empty" },
      h("span", {}, activeFilterCount()
        ? "Filtrům neodpovídá žádná knihovna v tomto výřezu mapy."
        : "V tomto výřezu mapy není žádná knihovna."),
      activeFilterCount() ? h("button", { class: "btn btn-quiet", type: "button", onclick: resetFilters }, "Zrušit filtry") : null,
      h("button", { class: "btn btn-quiet", type: "button", onclick: () => fitTo(CZ_BOUNDS) }, "Zobrazit celou ČR")));
    return;
  }

  let budget = LIST_LIMIT;
  for (const lib of main.slice(0, budget)) list.append(listItem(lib, now, day));
  budget -= Math.min(main.length, budget);
  if (unknown.length && budget > 0) {
    list.append(h("li", { class: "list-group" }, `Stav nelze určit (${unknown.length})`));
    for (const lib of unknown.slice(0, budget)) list.append(listItem(lib, now, day));
  }
  if (total > LIST_LIMIT) {
    list.append(h("li", { class: "list-group" }, `Zobrazeno prvních ${LIST_LIMIT}. Přibližte mapu pro další.`));
  }
  // po překreslení vrátit fokus klávesnice na stejnou knihovnu
  if (focusedId) focusListItem(focusedId, true);
}

function focusListItem(id, preventScroll) {
  const item = document.querySelector(`#list .item[data-id="${CSS.escape(id)}"]`);
  if (item) item.focus({ preventScroll });
  return Boolean(item);
}

/* ---------- Detail ---------- */

function copyButton(text) {
  return h("button", {
    class: "copy",
    type: "button",
    "aria-label": `Kopírovat ${text}`,
    onclick: async (event) => {
      const button = event.currentTarget;
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = "Zkopírováno";
      } catch {
        const range = document.createRange();
        range.selectNodeContents(button.previousElementSibling);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        button.textContent = "Označeno";
      }
      setTimeout(() => (button.textContent = "Kopírovat"), 1500);
    },
  }, "Kopírovat");
}

const na = () => h("span", { class: "na" }, "neuvedeno");
const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const libLink = (lib) => h("button", { class: "linkish", type: "button", onclick: () => openDetail(lib.id, { pan: true }) }, lib.name);

function hoursBlock(lib, today) {
  const hours = lib.hours;
  if (!hours) {
    return [h("p", { class: "warn" }, lib.parent
      ? "Adresář otevírací dobu této pobočky neuvádí. Zkuste web mateřské knihovny."
      : "Adresář otevírací dobu této knihovny neuvádí. Zkuste web obce nebo pověřené knihovny.")];
  }
  const rows = [];
  if (hours.parsed) {
    hours.days.forEach((intervals, d) => {
      rows.push(h("tr", { class: d === today ? "today" : null },
        h("th", { scope: "row" }, DAY_SHORT[d]),
        h("td", {}, intervals.length ? intervals.map(formatInterval).join(", ") : "zavřeno")));
    });
  } else {
    for (const [code, text] of Object.entries(hours.raw || {})) {
      const d = Number(code) - 1;
      rows.push(h("tr", { class: d === today ? "today" : null }, h("th", { scope: "row" }, DAY_SHORT[d]), h("td", {}, text)));
    }
  }
  return [
    rows.length ? h("table", { class: "hours" }, h("tbody", {}, rows)) : null,
    hours.note ? h("p", { class: "note" }, hours.note) : null,
    h("p", { class: "warn" }, "Otevírací doba je z celostátního adresáře a nemusí být aktuální. Před návštěvou ji ověřte na webu knihovny."),
  ];
}

function row(label, value) {
  return [h("dt", {}, label), h("dd", {}, value ?? na())];
}

function renderDetail(lib) {
  const now = new Date();
  const { day } = pragueNow(now);
  const st = openStatus(lib.hours, now);
  const parent = lib.parent ? app.byId.get(lib.parent) : null;
  const supervisor = lib.supervisor ? app.byId.get(lib.supervisor.id) : null;
  const branches = lib.branches.map((id) => app.byId.get(id)).filter(Boolean);
  const isSigla = /^[A-Z]{3}\d{3}$/.test(lib.id);
  let web = null;
  if (lib.web) {
    let label = lib.web;
    try { label = new URL(lib.web).hostname.replace(/^www\./, ""); } catch { /* ponechat celou adresu */ }
    web = h("a", { href: lib.web, target: "_blank", rel: "noopener" }, `${label} ↗`);
  }

  const parts = [
    h("button", { class: "back", type: "button", onclick: closeDetail }, "← Zpět na seznam"),
    h("h2", { tabindex: "-1" }, lib.name),
    h("div", { class: "badges" },
      h("span", { class: "badge badge-accent" }, lib.typeLabel || "Knihovna"),
      lib.professional === true ? h("span", { class: "badge" }, "profesionální") : null,
      lib.professional === false ? h("span", { class: "badge" }, "neprofesionální") : null,
      parent ? h("span", { class: "badge" }, "pobočka") : null,
      lib.region ? h("span", { class: "badge" }, [lib.region, lib.district].filter(Boolean).join(" · ")) : null),
    h("p", { class: `state state-${st.state}` }, statusText(st, day, Boolean(lib.hours))),
    lib.lat != null || lib.catalog ? h("div", { class: "mobile-actions" },
      lib.lat != null ? h("a", { href: mapyUrl(lib.lat, lib.lon, app.point), target: "_blank", rel: "noopener" }, "Navigovat") : null,
      lib.catalog ? h("a", { href: lib.catalog, target: "_blank", rel: "noopener" }, "Katalog") : null) : null,
    ...hoursBlock(lib, day),
    lib.catalog ? h("a", { class: "cta", href: lib.catalog, target: "_blank", rel: "noopener" }, "Hledat knihu v katalogu ↗") : null,
    h("dl", { class: "rows" },
      row("Adresa", lib.address ? h("span", {}, lib.address,
        lib.approx ? h("span", { class: "na" }, " (poloha na mapě je přibližná)") : null,
        lib.lat == null ? h("span", { class: "na" }, " (poloha není známá, na mapě chybí)") : null) : null),
      row("Web", web),
      row("E-mail", lib.emails.length ? lib.emails.map((e) => h("div", { class: "copy-row" }, h("span", {}, e), copyButton(e))) : null),
      row("Telefon", lib.phones.length ? lib.phones.map((p) => h("div", { class: "copy-row" }, h("span", {}, p), copyButton(p.replace(/\s*\(.*$/, "")))) : null),
      lib.director ? row(capitalize(lib.director.role) || "Vedení", lib.director.name) : null,
      row("Služby", lib.services.length ? h("div", { class: "services" }, lib.services.map((s) => h("span", {}, s))) : null),
      branches.length ? row("Pobočky", h("div", {}, branches.map((b) => h("div", {}, libLink(b))))) : null,
      parent ? row("Mateřská knihovna", libLink(parent)) : null,
      lib.supervisor ? row("Spadá pod", supervisor ? libLink(supervisor) : lib.supervisor.name) : null,
      row("Fond", formatFund(lib.fund))),
    h("div", { class: "links" },
      lib.lat != null ? h("a", { href: mapyUrl(lib.lat, lib.lon, app.point), target: "_blank", rel: "noopener" }, "Navigovat (Mapy.cz) ↗") : null),
    h("p", { class: "meta" },
      isSigla ? [h("span", {}, "Sigla "), h("code", {}, lib.id), " · "] : null,
      `Zdroj: Adresář knihoven NK ČR, stav k ${formatDate(app.generated)}`),
  ];
  $("#detail-view").replaceChildren(...parts.flat().filter((p) => p != null && p !== false));
}

export function openDetail(id, { pan = false } = {}) {
  const lib = app.byId.get(id);
  if (!lib) return;
  app.selected = id;
  renderDetail(lib);
  $("#list-view").hidden = true;
  $("#detail-view").hidden = false;
  $("#panel").scrollTop = 0;
  document.body.dataset.view = "detail";
  if (isMobile()) setSheet("full");
  if (lib.lat != null) {
    const ll = [lib.lat, lib.lon];
    if (!app.highlight) {
      app.highlight = L.circleMarker(ll, { radius: 13, weight: 3, color: app.colors.accent, fill: false, interactive: false });
    }
    app.highlight.setLatLng(ll).addTo(app.map);
    if (pan || isMobile()) centerOn(ll, Math.max(app.map.getZoom(), 15));
  }
  $("#detail-view h2").focus({ preventScroll: true });
  window.dispatchEvent(new CustomEvent("detail-opened"));
}

export function closeDetail() {
  const last = app.selected;
  app.selected = null;
  if (app.highlight) app.highlight.remove();
  $("#detail-view").hidden = true;
  $("#list-view").hidden = false;
  delete document.body.dataset.view;
  if (isMobile()) setSheet("half");
  renderList();
  if (!last || !focusListItem(last, false)) $("#list-summary").focus?.();
}

/* ---------- Filtry ---------- */

function activeFilterCount() {
  return [
    filters.region, filters.region && filters.district, filters.categories.size > 0, filters.mainOnly,
    filters.openNow, filters.weekend, !filters.includeUnknown,
  ].filter(Boolean).length + filters.services.size;
}

function updateFilterCount() {
  const n = activeFilterCount();
  const badge = $("#filter-count");
  badge.textContent = n;
  badge.hidden = n === 0;
  $("#quick-open").setAttribute("aria-pressed", String(filters.openNow));
}

function fillSelect(select, values, placeholder) {
  select.replaceChildren(h("option", { value: "" }, placeholder), ...values.map((v) => h("option", { value: v }, v)));
}

function readFilters() {
  filters.region = $("#f-region").value;
  filters.district = $("#f-district").value;
  const checked = [...document.querySelectorAll("#f-categories input:checked")].map((i) => i.value);
  filters.categories = checked.length === CATEGORIES.length ? new Set() : new Set(checked.length ? checked : ["__none__"]);
  filters.mainOnly = $("#f-main").checked;
  filters.openNow = $("#f-open").checked;
  filters.weekend = $("#f-weekend").checked;
  filters.includeUnknown = $("#f-unknown").checked;
  filters.services = new Set([...document.querySelectorAll("#f-services input:checked")].map((i) => i.value));
}

function updateDistricts() {
  const region = $("#f-region").value;
  const select = $("#f-district");
  const districts = [...new Set(app.libs.filter((l) => l.region === region).map((l) => l.district).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "cs"));
  fillSelect(select, region ? districts : [], "Všechny okresy");
  select.disabled = !region;
}

// Po výběru kraje nebo okresu přiblíží mapu na jeho knihovny.
function zoomToArea() {
  if (!filters.region) {
    fitTo(CZ_BOUNDS);
    return;
  }
  const inArea = app.libs.filter((l) => l.lat != null && l.region === filters.region
    && (!filters.district || l.district === filters.district));
  if (inArea.length) fitTo(L.latLngBounds(inArea.map((l) => [l.lat, l.lon])), 24);
}

export function resetFilters() {
  $("#f-region").value = "";
  updateDistricts();
  document.querySelectorAll("#f-categories input").forEach((i) => (i.checked = true));
  document.querySelectorAll("#f-services input").forEach((i) => (i.checked = false));
  $("#f-main").checked = false;
  $("#f-open").checked = false;
  $("#f-weekend").checked = false;
  $("#f-unknown").checked = true;
  readFilters();
  applyAndRender();
}

function setupFilters() {
  const regions = [...new Set(app.libs.map((l) => l.region).filter(Boolean))].sort((a, b) => a.localeCompare(b, "cs"));
  fillSelect($("#f-region"), regions, "Všechny kraje");
  $("#f-categories").append(...CATEGORIES.map(([value, label]) =>
    h("label", { class: "check" }, h("input", { type: "checkbox", value, checked: true }), ` ${label}`)));
  $("#f-services").append(...SERVICES.map(([value, label]) =>
    h("label", { class: "check" }, h("input", { type: "checkbox", value }), ` ${label}`)));

  $("#f-region").addEventListener("change", updateDistricts);
  $("#filter-body").addEventListener("change", (event) => {
    readFilters();
    applyAndRender();
    if (event.target.id === "f-region" || event.target.id === "f-district") zoomToArea();
  });
  $("#f-reset").addEventListener("click", resetFilters);
  $("#toggle-filters").addEventListener("click", (event) => {
    const open = event.currentTarget.getAttribute("aria-expanded") !== "true";
    event.currentTarget.setAttribute("aria-expanded", String(open));
    $("#filter-body").hidden = !open;
    if (open && isMobile()) setSheet("full");
  });
  $("#quick-open").addEventListener("click", () => {
    $("#f-open").checked = !$("#f-open").checked;
    readFilters();
    applyAndRender();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && app.selected && !event.target.closest?.(".search")) closeDetail();
  });
}

/* ---------- Hledání a poloha ---------- */

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const geocode = createGeocoder({
  fetchJson: async (query) => {
    const params = new URLSearchParams({ format: "jsonv2", countrycodes: "cz", limit: "1", "accept-language": "cs", q: query });
    const res = await fetch(`${NOMINATIM}?${params}`);
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  },
});

export function setPoint(lat, lon, label, zoom, isUser = false) {
  app.point = { lat, lon };
  app.pointLabel = label;
  if (app.pointMarker) app.pointMarker.remove();
  app.pointMarker = L.circleMarker([lat, lon], {
    radius: isUser ? 8 : 6, weight: 3, color: "#ffffff", fillColor: app.colors.accent, fillOpacity: 1, interactive: false,
  }).addTo(app.map);
  if (isUser) app.pointMarker.bindTooltip("Vy", { permanent: true, direction: "right", offset: [8, 0] });
  if (app.selected) closeDetail();
  centerOn([lat, lon], zoom);
  renderList();
}

function clearPoint() {
  app.point = null;
  app.pointLabel = "";
  if (app.pointMarker) app.pointMarker.remove();
  renderList();
}

function setupSearch() {
  const input = $("#search");
  const box = $("#suggestions");
  const form = $("#search-form");
  let results = [];
  let active = -1;

  const close = () => {
    box.hidden = true;
    input.setAttribute("aria-expanded", "false");
    active = -1;
  };
  const choose = (result) => {
    close();
    if (result.kind === "place") {
      input.value = result.item.name;
      setPoint(result.item.lat, result.item.lon, `od obce ${result.item.name}`, 13);
    } else {
      input.value = result.item.name;
      openDetail(result.item.id, { pan: true });
    }
  };
  const paint = () => {
    box.replaceChildren(...results.map((r, i) => h("li", {
      role: "option",
      id: `sugg-${i}`,
      "aria-selected": String(i === active),
      onmousedown: (event) => {
        event.preventDefault();
        choose(r);
      },
    }, h("span", {}, r.item.name),
    h("span", { class: "kind" }, r.kind === "place"
      ? `obec${r.item.district ? ` · okres ${r.item.district}` : ""}`
      : r.item.municipality || "knihovna"))));
    box.hidden = results.length === 0;
    input.setAttribute("aria-expanded", String(!box.hidden));
    if (active >= 0) input.setAttribute("aria-activedescendant", `sugg-${active}`);
    else input.removeAttribute("aria-activedescendant");
  };

  input.addEventListener("input", () => {
    results = searchLocal(app.libs, app.places, input.value);
    active = -1;
    paint();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && results.length) {
      active = (active + 1) % results.length;
      paint();
      event.preventDefault();
    } else if (event.key === "ArrowUp" && results.length) {
      active = (active - 1 + results.length) % results.length;
      paint();
      event.preventDefault();
    } else if (event.key === "Escape") {
      close();
    } else if (event.key === "Enter" && active >= 0 && !box.hidden) {
      event.preventDefault();
      choose(results[active]);
    }
  });
  input.addEventListener("blur", () => setTimeout(close, 150));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (!query) return;
    close();
    const button = $("#search-btn");
    button.disabled = true;
    try {
      const hit = await geocode(query);
      if (hit === undefined) return; // jiné hledání ještě běží
      if (!hit) {
        showMessage("Místo se nepodařilo najít. Zkuste zadat obec.");
        return;
      }
      const settlement = ["city", "town", "village", "municipality", "hamlet", "suburb"].includes(hit.addresstype);
      // u adresy ukázat, co uživatel zadal (Nominatim vrací i název podniku na adrese)
      const label = settlement && hit.name ? hit.name : query;
      setPoint(Number(hit.lat), Number(hit.lon), `od místa ${label}`, settlement ? 13 : 16);
    } catch {
      showMessage("Hledání teď nefunguje. Zkuste to znovu nebo vyberte obec z nabídky.");
    } finally {
      button.disabled = false;
    }
  });
}

function setupLocate() {
  const buttons = [$("#locate"), $("#quick-locate")];
  const fail = () => showMessage("Polohu se nepodařilo zjistit. Vyhledejte obec nebo adresu.");
  const locate = () => {
    if (!navigator.geolocation) {
      fail();
      return;
    }
    buttons.forEach((b) => (b.disabled = true));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        buttons.forEach((b) => (b.disabled = false));
        setPoint(pos.coords.latitude, pos.coords.longitude, "od vaší polohy", 14, true);
      },
      () => {
        buttons.forEach((b) => (b.disabled = false));
        fail();
      },
      { timeout: 10000, maximumAge: 60000 },
    );
  };
  buttons.forEach((b) => b.addEventListener("click", locate));
}

/* ---------- Mobilní vysouvací panel ---------- */

const SHEET_STATES = ["peek", "half", "full"];
const mobileQuery = window.matchMedia("(max-width: 767px)");
const isMobile = () => mobileQuery.matches;
// Na mobilu překrývá spodek mapy panel; výřez se počítá jen z viditelné části.
const sheetPadding = () => (isMobile() ? $("#panel").offsetHeight : 0);

function fitTo(bounds, padding = 0) {
  app.map.fitBounds(bounds, { paddingTopLeft: [padding, padding], paddingBottomRight: [padding, padding + sheetPadding()] });
}

function centerOn(ll, zoom) {
  app.map.setView(ll, zoom, { animate: false });
  const offset = sheetPadding();
  if (offset) app.map.panBy([0, offset / 2], { animate: false });
}

function setSheet(state) {
  $("#panel").dataset.sheet = state;
  if (state === "peek") $("#panel").scrollTop = 0;
}

function setupSheet() {
  const handle = $("#sheet-handle");
  const step = (dir) => {
    const i = SHEET_STATES.indexOf($("#panel").dataset.sheet);
    setSheet(SHEET_STATES[Math.max(0, Math.min(SHEET_STATES.length - 1, i + dir))]);
  };
  let startY = null;
  handle.addEventListener("pointerdown", (event) => {
    startY = event.clientY;
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointerup", (event) => {
    if (startY == null) return;
    const dy = event.clientY - startY;
    startY = null;
    if (dy < -30) step(1);
    else if (dy > 30) step(-1);
    else step($("#panel").dataset.sheet === "full" ? -2 : 1);
  });
  handle.addEventListener("keydown", (event) => {
    if (event.key === "ArrowUp") step(1);
    if (event.key === "ArrowDown") step(-1);
  });
  // posun mapy na mobilu stáhne panel, aby byla mapa vidět
  app.map.on("dragstart", () => {
    if (isMobile() && !app.selected && $("#panel").dataset.sheet === "full") setSheet("half");
  });
}

/* ---------- Start ---------- */

async function init() {
  setupMap();
  let data;
  try {
    const res = await fetch("data/knihovny.json");
    if (!res.ok) throw new Error(String(res.status));
    data = await res.json();
  } catch {
    $("#list-summary").textContent = "Data knihoven se nepodařilo načíst. Zkuste stránku obnovit.";
    return;
  }
  app.libs = data.libraries;
  app.generated = data.generated;
  for (const lib of app.libs) app.byId.set(lib.id, lib);
  $("#generated").textContent = formatDate(data.generated);
  // kontejner mapy má rozměry až po načtení stylů
  app.map.invalidateSize();
  fitTo(CZ_BOUNDS);
  buildMarkers();
  app.places = buildPlaces(app.libs);
  setupFilters();
  setupSearch();
  setupLocate();
  setupSheet();
  applyAndRender();
  setInterval(refreshStates, 60_000);
}

init();
