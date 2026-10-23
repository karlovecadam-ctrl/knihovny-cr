// Seznam knihoven: úvodní obrazovka, karty, řazení a stránkování.
// Na počítači podle výřezu mapy (po 200), na mobilu všechny podle filtrů (po 50).
import { distanceKm } from "./filters.js";
import { groupDigits, mapyUrl, plural, statusText } from "./format.js";
import { inViewTest } from "./map.js";
import { openStatus, pragueNow } from "./status.js";
import {
  $, CATEGORIES, LIB_FORMS, PAGE_DESKTOP, PAGE_MOBILE, SERVICES, app, emit, filters, formatKm, h, icon, isMobile,
} from "./store.js";
import { activeFilterChips, defaultSort, page, shouldShowStart, sortLibraries } from "./view.js";

const GROUP = Symbol("skupina nelze určit");

function card(lib, now, today) {
  const st = openStatus(lib.hours, now);
  const dist = app.point && lib.lat != null ? formatKm(distanceKm(app.point, lib)) : null;
  const node = h("article", { class: `card${app.selected === lib.id ? " is-selected" : ""}`, "data-id": lib.id },
    h("h3", { class: "card-title" },
      h("button", { class: "card-link", type: "button", onclick: () => emit("open-detail", lib.id, { pan: true }) }, lib.name)),
    h("div", { class: "card-row" },
      h("span", { class: `pill pill-${st.state}` }, statusText(st, today, Boolean(lib.hours))),
      lib.address ? h("span", {}, lib.address) : null,
      dist ? h("span", { class: "card-dist" }, dist) : null),
    lib.lat != null || lib.catalog ? h("div", { class: "card-actions" },
      lib.lat != null ? h("a", { href: mapyUrl(lib.lat, lib.lon, app.point), target: "_blank", rel: "noopener" }, icon("nav"), "Navigovat") : null,
      lib.catalog ? h("a", { href: lib.catalog, target: "_blank", rel: "noopener" }, icon("book"), "Katalog") : null) : null);
  if (!isMobile()) {
    const enter = () => emit("card-hover", lib.id);
    const leave = () => emit("card-hover", null);
    node.addEventListener("mouseenter", enter);
    node.addEventListener("mouseleave", leave);
    node.addEventListener("focusin", enter);
    node.addEventListener("focusout", leave);
  }
  return h("li", {}, node);
}

function renderStart() {
  const open = [...app.states.values()].filter((s) => s === "open").length;
  $("#stat-total").textContent = groupDigits(app.markers.size);
  $("#stat-open").textContent = groupDigits(open);
}

function summaryText(total, mobile) {
  const parts = [h("b", {}, plural(total, LIB_FORMS))];
  if (!mobile) parts.push(" ve výřezu mapy");
  if (app.point) {
    parts.push(` · podle vzdálenosti ${app.pointLabel} `);
    parts.push(h("button", { class: "link-btn", type: "button", onclick: () => emit("clear-point") }, "zrušit"));
  }
  return parts;
}

export function renderList({ keepPages = false } = {}) {
  if (!keepPages) app.pages = 1;
  const mobile = isMobile();
  const list = $("#list");
  const more = $("#more");
  const summary = $("#list-summary");
  const now = new Date();
  const { day } = pragueNow(now);
  const focusedId = document.activeElement?.closest?.(".card")?.dataset.id;

  const filtersActive = activeFilterChips(filters, CATEGORIES, SERVICES).length > 0;
  const start = shouldShowStart({
    dismissed: app.startDismissed, point: app.point, filtersActive, zoom: app.map.getZoom(),
  });
  $("#start").hidden = !start;
  $(".summary-row").hidden = start;
  if (start) {
    renderStart();
    list.replaceChildren();
    more.hidden = true;
    return;
  }
  app.startDismissed = true;

  const mode = app.sortMode || defaultSort(app.point);
  const sort = $("#sort");
  sort.value = mode;
  sort.querySelector('option[value="distance"]').disabled = !app.point;

  let { matching, unknownHours } = app.visible;
  if (!mobile) {
    const inView = inViewTest();
    matching = matching.filter(inView);
    unknownHours = unknownHours.filter(inView);
  }
  matching = sortLibraries(matching, mode, app.point, now);
  unknownHours = sortLibraries(unknownHours, mode, app.point, now);
  const total = matching.length + unknownHours.length;

  summary.replaceChildren(...summaryText(total, mobile));
  list.replaceChildren();
  if (!total) {
    list.append(h("li", { class: "empty" },
      h("span", {}, filtersActive
        ? `Filtrům neodpovídá žádná knihovna${mobile ? "" : " v tomto výřezu mapy"}.`
        : "Žádná knihovna v tomto výřezu mapy."),
      filtersActive ? h("button", { class: "link-btn", type: "button", onclick: () => emit("reset-filters") }, "Zrušit filtry") : null,
      mobile ? null : h("button", { class: "link-btn", type: "button", onclick: () => emit("show-country") }, "Zobrazit celou ČR")));
    more.hidden = true;
    return;
  }

  const combined = unknownHours.length ? [...matching, GROUP, ...unknownHours] : matching;
  const { items, hasMore } = page(combined, mobile ? PAGE_MOBILE : PAGE_DESKTOP, app.pages);
  for (const item of items) {
    list.append(item === GROUP
      ? h("li", { class: "list-group" }, `Stav nelze určit (${unknownHours.length})`)
      : card(item, now, day));
  }
  more.hidden = !hasMore;
  if (hasMore) more.textContent = `Zobrazit další (zbývá ${groupDigits(total - items.filter((i) => i !== GROUP).length)})`;
  if (focusedId) focusCard(focusedId, true);
}

export function focusCard(id, preventScroll = false) {
  const button = document.querySelector(`.card[data-id="${CSS.escape(id)}"] .card-link`);
  if (button) button.focus({ preventScroll });
  return Boolean(button);
}

export function highlightCard(id) {
  document.querySelectorAll(".card.is-hover").forEach((c) => c.classList.remove("is-hover"));
  if (!id) return;
  const node = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
  if (!node) return;
  node.classList.add("is-hover");
  const box = $(".results").getBoundingClientRect();
  const r = node.getBoundingClientRect();
  if (r.top < box.top || r.bottom > box.bottom) node.scrollIntoView({ block: "nearest" });
}

export function markSelectedCard(id) {
  document.querySelectorAll(".card.is-selected").forEach((c) => c.classList.remove("is-selected"));
  if (id) document.querySelector(`.card[data-id="${CSS.escape(id)}"]`)?.classList.add("is-selected");
}

// Karta knihovny dole na mobilní mapě po klepnutí na bod.
export function showMapCard(id) {
  const box = $("#map-card");
  const lib = app.byId.get(id);
  if (!lib) {
    box.hidden = true;
    return;
  }
  const now = new Date();
  box.replaceChildren(card(lib, now, pragueNow(now).day).firstChild);
  box.hidden = false;
}

export const hideMapCard = () => ($("#map-card").hidden = true);
