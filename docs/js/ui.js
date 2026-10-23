// Ovládání: filtry a jejich štítky, řazení, hledání, poloha, přepínač Seznam | Mapa, dialog O datech.
import { searchLocal } from "./filters.js";
import { plural } from "./format.js";
import { createGeocoder } from "./geocode.js";
import { centerOn, clearPointMarker, inViewTest, invalidateMap, setPointMarker, zoomToArea } from "./map.js";
import {
  $, CATEGORIES, CATEGORY_KEYS, LIB_FORMS, SERVICES, app, emit, filters, h, icon, isMobile, showMessage,
} from "./store.js";
import { activeFilterChips, clearFilter } from "./view.js";

/* ---------- Filtry ---------- */

function fillSelect(select, values, placeholder) {
  select.replaceChildren(h("option", { value: "" }, placeholder), ...values.map((v) => h("option", { value: v }, v)));
}

function fillDistricts() {
  const region = $("#f-region").value;
  const districts = [...new Set(app.libs.filter((l) => l.region === region).map((l) => l.district).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "cs"));
  fillSelect($("#f-district"), region ? districts : [], "Všechny okresy");
  $("#f-district").disabled = !region;
}

function readInputs() {
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

// Po zrušení filtru štítkem nebo tlačítkem nastavit ovládací prvky podle stavu.
function syncInputs() {
  $("#f-region").value = filters.region;
  fillDistricts();
  $("#f-district").value = filters.district;
  document.querySelectorAll("#f-categories input").forEach((i) => {
    i.checked = filters.categories.size === 0 || filters.categories.has(i.value);
  });
  $("#f-main").checked = filters.mainOnly;
  $("#f-open").checked = filters.openNow;
  $("#f-weekend").checked = filters.weekend;
  $("#f-unknown").checked = filters.includeUnknown;
  document.querySelectorAll("#f-services input").forEach((i) => (i.checked = filters.services.has(i.value)));
}

export function renderChips() {
  const chips = activeFilterChips(filters, CATEGORIES, SERVICES);
  const box = $("#active-chips");
  box.replaceChildren(...chips.map(({ key, label }) => h("button", {
    class: "chip", type: "button", "aria-label": `Zrušit filtr ${label}`,
    onclick: () => {
      const regionCleared = key === "region" || key === "district";
      Object.assign(filters, clearFilter(filters, key, CATEGORY_KEYS));
      syncInputs();
      emit("apply");
      if (regionCleared) zoomToArea(filters.region, filters.district);
    },
  }, label, icon("close"))));
  if (chips.length > 1) {
    box.append(h("button", { class: "link-btn", type: "button", onclick: resetFilters }, "Zrušit vše"));
  }
  const n = chips.length;
  $("#filter-count").textContent = n;
  $("#filter-count").hidden = n === 0;
  $("#quick-open").setAttribute("aria-pressed", String(filters.openNow));
}

// Na mobilu počet všech knihoven podle filtrů, na počítači počet ve výřezu mapy (jako seznam).
export function updateApplyLabel() {
  const all = [...app.visible.matching, ...app.visible.unknownHours];
  const n = isMobile() ? all.length : all.filter(inViewTest()).length;
  $("#f-apply").textContent = `Zobrazit ${plural(n, LIB_FORMS)}`;
}

export function resetFilters() {
  Object.assign(filters, {
    region: "", district: "", categories: new Set(), mainOnly: false, openNow: false, weekend: false,
    includeUnknown: true, services: new Set(),
  });
  syncInputs();
  emit("apply");
}

function openFilters() {
  document.body.dataset.filters = "open";
  $("#filters-toggle").setAttribute("aria-expanded", "true");
  if (isMobile()) history.pushState({ filters: true }, "");
  $("#filters .filters-body input, #filters .filters-body select")?.focus();
}

export function closeFilters({ fromPop = false } = {}) {
  if (document.body.dataset.filters !== "open") return;
  delete document.body.dataset.filters;
  $("#filters-toggle").setAttribute("aria-expanded", "false");
  if (isMobile() && !fromPop && history.state?.filters) history.back();
  $("#filters-toggle").focus({ preventScroll: true });
}

export function setupFilters() {
  const regions = [...new Set(app.libs.map((l) => l.region).filter(Boolean))].sort((a, b) => a.localeCompare(b, "cs"));
  fillSelect($("#f-region"), regions, "Všechny kraje");
  $("#f-categories").append(...CATEGORIES.map(([value, label]) =>
    h("label", { class: "check" }, h("input", { type: "checkbox", value, checked: true }), ` ${label}`)));
  $("#f-services").append(...SERVICES.map(([value, label]) =>
    h("label", { class: "check" }, h("input", { type: "checkbox", value }), ` ${label}`)));

  $("#f-region").addEventListener("change", fillDistricts);
  $("#filters").addEventListener("change", (event) => {
    readInputs();
    emit("apply");
    if (event.target.id === "f-region" || event.target.id === "f-district") zoomToArea(filters.region, filters.district);
  });
  $("#f-reset").addEventListener("click", resetFilters);
  $("#f-apply").addEventListener("click", () => closeFilters());
  $("#filters-close").addEventListener("click", () => closeFilters());
  $("#filters-toggle").addEventListener("click", () => {
    if (document.body.dataset.filters === "open") closeFilters();
    else openFilters();
  });
  $("#quick-open").addEventListener("click", () => {
    $("#f-open").checked = !$("#f-open").checked;
    readInputs();
    emit("apply");
  });
  $("#sort").addEventListener("change", (event) => {
    app.sortMode = event.target.value;
    emit("render");
  });
  $("#more").addEventListener("click", () => {
    app.pages += 1;
    emit("render", { keepPages: true });
  });
}

/* ---------- Místo, hledání, poloha ---------- */

export function setPoint(lat, lon, label, zoom, isUser = false) {
  app.point = { lat, lon };
  app.pointLabel = label;
  app.sortMode = null;
  setPointMarker(lat, lon, isUser);
  emit("close-detail");
  centerOn([lat, lon], zoom);
  emit("render");
}

export function clearPoint() {
  app.point = null;
  app.pointLabel = "";
  app.sortMode = null;
  clearPointMarker();
  emit("render");
}

const geocode = createGeocoder({
  fetchJson: async (query) => {
    const params = new URLSearchParams({ format: "jsonv2", countrycodes: "cz", limit: "1", "accept-language": "cs", q: query });
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  },
});

export function setupSearch() {
  const input = $("#search");
  const box = $("#suggestions");
  let results = [];
  let active = -1;

  const close = () => {
    box.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  };
  const choose = (r) => {
    close();
    input.value = r.item.name;
    if (r.kind === "place") setPoint(r.item.lat, r.item.lon, `od obce ${r.item.name}`, 13);
    else emit("open-detail", r.item.id, { pan: true, zoom: true });
  };
  const paint = () => {
    box.replaceChildren(...results.map((r, i) => h("li", {
      role: "option", id: `sugg-${i}`, "aria-selected": String(i === active),
      onmousedown: (event) => {
        event.preventDefault();
        choose(r);
      },
    }, h("span", {}, r.item.name), h("span", { class: "kind" }, r.kind === "place"
      ? `obec${r.item.district ? ` · okres ${r.item.district}` : ""}`
      : r.item.municipality || "knihovna"))));
    box.hidden = results.length === 0;
    input.setAttribute("aria-expanded", String(!box.hidden));
    if (active >= 0) input.setAttribute("aria-activedescendant", `sugg-${active}`);
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

  $("#search-form").addEventListener("submit", async (event) => {
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

export function setupLocate() {
  const buttons = [$("#locate"), $("#start-locate")];
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
  $("#start-browse").addEventListener("click", () => {
    app.startDismissed = true;
    emit("render");
    $("#list .card-link")?.focus();
  });
}

/* ---------- Mobil: Seznam | Mapa ---------- */

export function setTab(name) {
  document.body.dataset.tab = name;
  for (const [id, tab] of [["tab-list", "list"], ["tab-map", "map"]]) {
    const button = $(`#${id}`);
    button.setAttribute("aria-selected", String(tab === name));
    button.tabIndex = tab === name ? 0 : -1;
  }
  if (name === "map") invalidateMap();
  emit("tab", name);
}

export function setupTabs() {
  const tabs = [$("#tab-list"), $("#tab-map")];
  tabs[0].addEventListener("click", () => setTab("list"));
  tabs[1].addEventListener("click", () => setTab("map"));
  for (const tab of tabs) {
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const next = tab === tabs[0] ? tabs[1] : tabs[0];
      next.focus();
      next.click();
    });
  }
}

/* ---------- O datech ---------- */

export function setupAbout() {
  const dialog = $("#about");
  document.querySelectorAll("#about-open, [data-open-about]").forEach((b) => b.addEventListener("click", () => dialog.showModal()));
  dialog.querySelector("[data-close-about]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close(); // klik mimo obsah
  });
}
