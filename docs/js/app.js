// Start stránky: načtení dat, propojení modulů, obnovování stavů a práce s adresou (#id, Zpět).
import { closeDetail, openDetail, renderDetail } from "./detail.js";
import { applyFilters, buildPlaces } from "./filters.js";
import { highlightCard, hideMapCard, markSelectedCard, renderList, focusCard, showMapCard } from "./list.js";
import {
  adaptLegend, buildMarkers, centerOn, fitTo, hoverMarker, invalidateMap, restyleMarkers, setupMap, showMarkers,
} from "./map.js";
import { stateChanges } from "./status.js";
import { $, CZ_BOUNDS, app, filters, formatDate, isMobile, on, onLayoutChange } from "./store.js";
import {
  clearPoint, closeFilters, renderChips, resetFilters, setTab, setupAbout, setupFilters, setupLocate, setupSearch,
  setupTabs, updateApplyLabel,
} from "./ui.js";
import { hashFor, parseHash } from "./view.js";

function applyAndRender() {
  app.visible = applyFilters(app.libs, filters, new Date());
  showMarkers([...app.visible.matching, ...app.visible.unknownHours]);
  renderChips();
  updateApplyLabel();
  renderList();
}

// Každou minutu: překreslit jen knihovny, kterým se stav změnil.
function refreshStates() {
  const { states, changed } = stateChanges(app.libs, app.states, new Date());
  app.states = states;
  if (!changed.length) return;
  restyleMarkers(changed);
  if (filters.openNow || !filters.includeUnknown) applyAndRender();
  else renderList({ keepPages: true });
  if (app.selected && changed.includes(app.selected)) renderDetail(app.byId.get(app.selected));
}

// Odkaz #id: přiblížit na knihovnu, otevřít detail a pod ním ukázat běžný seznam (ne úvodní obrazovku).
function openFromLink(id, { push = true } = {}) {
  const lib = app.byId.get(id);
  app.startDismissed = true;
  if (lib && lib.lat != null) centerOn([lib.lat, lib.lon], Math.max(app.map.getZoom(), 15));
  if (!openDetail(id, { pan: true, push })) history.replaceState(null, "", `${location.pathname}${location.search}`);
  renderList();
}

function wire() {
  on("apply", applyAndRender);
  on("render", (opts) => renderList(opts));
  on("map-moved", () => {
    if (isMobile()) return;
    if (app.skipListOnMove) {
      app.skipListOnMove = false;
      return;
    }
    renderList();
    updateApplyLabel();
  });
  on("open-detail", (id, opts = {}) => {
    const lib = app.byId.get(id);
    if (opts.zoom && lib && lib.lat != null) centerOn([lib.lat, lib.lon], Math.max(app.map.getZoom(), 15));
    hideMapCard();
    openDetail(id, opts);
  });
  on("close-detail", () => closeDetail());
  on("detail-closed", (id) => {
    if (isMobile() && document.body.dataset.tab !== "list") return;
    if (!focusCard(id)) $("#list-summary").focus({ preventScroll: true });
  });
  on("selected", (id) => markSelectedCard(id));
  on("marker-click", (id) => {
    if (isMobile()) showMapCard(id);
    else openDetail(id, { pan: true }); // posune jen, když bod zakryje zásuvka
  });
  on("map-click", () => {
    if (isMobile()) hideMapCard();
    else if (app.selected) closeDetail();
  });
  on("marker-hover", (id) => {
    if (!isMobile()) highlightCard(id);
  });
  on("card-hover", (id) => hoverMarker(id ? app.byId.get(id) : null));
  on("clear-point", clearPoint);
  on("reset-filters", resetFilters);
  on("show-country", () => fitTo(CZ_BOUNDS));
  on("tab", (name) => {
    if (name === "list") hideMapCard();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.target.closest?.(".search") || $("#about").open) return;
    if (document.body.dataset.filters === "open") closeFilters();
    else if (app.selected) closeDetail();
  });
  // Zpět/vpřed i ruční změna #: řídit se záznamem v historii, jinak adresou
  window.addEventListener("popstate", (event) => {
    const state = event.state || {};
    const id = state.detail || parseHash(location.hash);
    if (id) {
      if (id !== app.selected) openDetail(id, { push: false, pan: true });
    } else if (app.selected) {
      closeDetail({ fromPop: true });
    }
    if (!state.filters) closeFilters({ fromPop: true });
  });
  window.addEventListener("hashchange", () => {
    const id = parseHash(location.hash);
    if (id && id !== app.selected) openFromLink(id, { push: false });
  });
  onLayoutChange(() => {
    adaptLegend();
    invalidateMap();
    closeFilters({ fromPop: true });
    if (!isMobile()) setTab("list");
    // otevřený detail se na mobilu stane samostatnou obrazovkou: potřebuje záznam v historii, aby Zpět nevedlo pryč
    if (isMobile() && app.selected && !history.state?.detail) {
      history.replaceState(null, "", `${location.pathname}${location.search}`);
      history.pushState({ detail: app.selected }, "", hashFor(app.selected));
    }
    renderList();
  });
}

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
  $("#about-generated").textContent = formatDate(data.generated);

  // kontejner mapy má rozměry až po načtení stylů
  invalidateMap();
  fitTo(CZ_BOUNDS);
  app.states = stateChanges(app.libs, new Map(), new Date()).states;
  buildMarkers();
  app.places = buildPlaces(app.libs);
  setupFilters();
  setupSearch();
  setupLocate();
  setupTabs();
  setupAbout();
  wire();
  applyAndRender();

  const linked = parseHash(location.hash);
  if (linked) {
    // na mobilu nejdřív záznam se seznamem, aby systémové Zpět vedlo na něj
    if (isMobile()) history.replaceState(null, "", `${location.pathname}${location.search}`);
    openFromLink(linked);
  }
  setInterval(refreshStates, 60_000);
}

init();
