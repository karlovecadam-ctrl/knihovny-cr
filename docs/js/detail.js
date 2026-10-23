// Detail knihovny: na počítači zásuvka přes mapu, na mobilu samostatná obrazovka; odkaz #id a sdílení.
import { DAY_SHORT, formatFund, formatInterval, mapyUrl, statusText } from "./format.js";
import { panToVisible, selectMarker } from "./map.js";
import { openStatus, pragueNow } from "./status.js";
import { $, app, emit, formatDate, h, icon, isMobile, showMessage } from "./store.js";
import { hashFor } from "./view.js";

const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const na = () => h("span", { class: "na" }, "neuvedeno");
const libRef = (lib) => h("button", { class: "libref", type: "button", onclick: () => openDetail(lib.id, { pan: true }) }, lib.name);

function copyButton(text) {
  return h("button", {
    class: "copy", type: "button", "aria-label": `Kopírovat ${text}`,
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

async function share(lib) {
  const url = `${location.origin}${location.pathname}${hashFor(lib.id)}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: lib.name, url });
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    showMessage("Odkaz zkopírován.");
  } catch {
    showMessage(`Odkaz na knihovnu: ${url}`, 12000);
  }
}

function todayLine(lib, day) {
  const hours = lib.hours;
  if (!hours) return null;
  if (hours.parsed && hours.days) {
    const intervals = hours.days[day];
    return intervals.length ? `dnes ${intervals.map(formatInterval).join(", ")}` : "dnes zavřeno";
  }
  const raw = hours.raw?.[String(day + 1)];
  return raw ? `dnes: ${raw}` : null;
}

function week(lib, day) {
  const hours = lib.hours;
  if (!hours) {
    return [h("p", { class: "warn" }, lib.parent
      ? "Adresář otevírací dobu této pobočky neuvádí. Zkuste web mateřské knihovny."
      : "Adresář otevírací dobu této knihovny neuvádí. Zkuste web obce nebo pověřené knihovny.")];
  }
  const rows = [];
  if (hours.parsed) {
    hours.days.forEach((intervals, d) => rows.push(h("tr", { class: d === day ? "today-row" : null },
      h("th", { scope: "row" }, DAY_SHORT[d]),
      h("td", {}, intervals.length ? intervals.map(formatInterval).join(", ") : "zavřeno"))));
  } else {
    for (const [code, text] of Object.entries(hours.raw || {})) {
      const d = Number(code) - 1;
      rows.push(h("tr", { class: d === day ? "today-row" : null }, h("th", { scope: "row" }, DAY_SHORT[d]), h("td", {}, text)));
    }
  }
  return [
    rows.length ? h("table", { class: "week" }, h("caption", { class: "sr-only" }, "Otevírací doba"), h("tbody", {}, rows)) : null,
    hours.note ? h("p", { class: "note" }, hours.note) : null,
    h("p", { class: "warn" }, "Otevírací doba je z celostátního adresáře a nemusí být aktuální. Před návštěvou ji ověřte na webu knihovny."),
  ];
}

function info(name, label, value) {
  return [icon(name), h("div", { class: "info-value" }, h("span", { class: "info-label" }, label), value ?? na())];
}

export function renderDetail(lib) {
  const now = new Date();
  const { day } = pragueNow(now);
  const st = openStatus(lib.hours, now);
  const parent = lib.parent ? app.byId.get(lib.parent) : null;
  const supervisor = lib.supervisor ? app.byId.get(lib.supervisor.id) : null;
  const branches = lib.branches.map((id) => app.byId.get(id)).filter(Boolean);
  const nav = lib.lat != null ? mapyUrl(lib.lat, lib.lon, app.point) : null;
  let webLabel = lib.web;
  try { if (lib.web) webLabel = new URL(lib.web).hostname.replace(/^www\./, ""); } catch { /* celá adresa */ }
  const today = todayLine(lib, day);
  const link = (href, name, text) => (href ? h("a", { href, target: "_blank", rel: "noopener" }, icon(name), text) : null);

  const parts = [
    h("div", { class: "detail-head" },
      h("button", { class: "link-btn back", type: "button", onclick: () => closeDetail() }, icon("back"), "Zpět"),
      h("span", {}),
      h("button", { class: "link-btn share-top", type: "button", onclick: () => share(lib) }, "Sdílet"),
      h("button", { class: "icon-btn close", type: "button", "aria-label": "Zavřít detail", onclick: () => closeDetail() }, icon("close"))),
    h("h2", { id: "detail-title", tabindex: "-1" }, lib.name),
    h("div", { class: "badges" },
      h("span", { class: "badge badge-accent" }, lib.typeLabel || "Knihovna"),
      lib.professional === true ? h("span", { class: "badge" }, "profesionální") : null,
      lib.professional === false ? h("span", { class: "badge" }, "neprofesionální") : null,
      parent ? h("span", { class: "badge" }, "pobočka") : null),
    lib.region ? h("p", { class: "place", style: "margin:0" }, [lib.region, lib.district].filter(Boolean).join(" · ")) : null,
    h("div", { class: `today today-${st.state}` },
      h("strong", {}, statusText(st, day, Boolean(lib.hours))),
      today && st.state !== "open" ? h("span", {}, today) : null),
    h("div", { class: "actions" },
      link(nav, "nav", "Navigovat"), link(lib.catalog, "book", "Katalog"), link(lib.web, "web", "Web"),
      h("button", { type: "button", onclick: () => share(lib) }, icon("share"), "Sdílet")),
    ...week(lib, day),
    h("div", { class: "info" },
      ...info("pin", "Adresa", lib.address ? h("span", {}, lib.address,
        lib.approx ? h("span", { class: "na" }, " (poloha na mapě je přibližná)") : null,
        lib.lat == null ? h("span", { class: "na" }, " (poloha není známá)") : null) : null),
      ...info("web", "Web", lib.web ? h("a", { href: lib.web, target: "_blank", rel: "noopener" }, `${webLabel} ↗`) : null),
      ...info("mail", "E-mail", lib.emails.length ? lib.emails.map((e) => h("div", { class: "copy-row" }, h("span", {}, e), copyButton(e))) : null),
      ...info("phone", "Telefon", lib.phones.length ? lib.phones.map((p) => h("div", { class: "copy-row" }, h("span", {}, p), copyButton(p.replace(/\s*\(.*$/, "")))) : null),
      ...(lib.director ? info("person", capitalize(lib.director.role) || "Vedení", lib.director.name) : []),
      ...info("star", "Služby", lib.services.length ? h("div", { class: "services" }, lib.services.map((s) => h("span", {}, s))) : null),
      ...(branches.length ? info("branch", "Pobočky", h("div", {}, branches.map((b) => h("div", {}, libRef(b))))) : []),
      ...(parent ? info("branch", "Mateřská knihovna", libRef(parent)) : []),
      ...(lib.supervisor ? info("branch", "Spadá pod", supervisor ? libRef(supervisor) : lib.supervisor.name) : []),
      ...info("shelf", "Fond", formatFund(lib.fund))),
    h("p", { class: "meta" },
      /^[A-Z]{3}\d{3}$/.test(lib.id) ? [`Sigla ${lib.id} · `] : null,
      `Zdroj: Adresář knihoven NK ČR, stav k ${formatDate(app.generated)}`),
    h("div", { class: "bottom-bar" }, link(nav, "nav", "Navigovat"), link(lib.catalog || lib.web, lib.catalog ? "book" : "web", lib.catalog ? "Katalog" : "Web")),
  ];
  $("#detail").replaceChildren(...parts.flat().filter((p) => p != null && p !== false));
}

// push: na mobilu přidat záznam do historie (systémové Zpět detail zavře)
export function openDetail(id, { pan = false, push = true } = {}) {
  const lib = app.byId.get(id);
  if (!lib) {
    showMessage("Knihovna z odkazu nebyla nalezena.");
    return false;
  }
  const mobile = isMobile();
  const wasOpen = Boolean(app.selected);
  app.selected = id;
  renderDetail(lib);
  const box = $("#detail");
  box.hidden = false;
  box.scrollTop = 0;
  emit("selected", id);
  selectMarker(lib);
  // posun kvůli detailu nemá přestavět seznam (uživatel by ztratil místo v seznamu)
  if (!mobile && pan && panToVisible(lib, box.offsetWidth)) app.skipListOnMove = true;
  if (mobile) {
    if (push && !wasOpen) history.pushState({ detail: id }, "", hashFor(id));
    else history.replaceState({ detail: id }, "", hashFor(id));
  } else {
    history.replaceState(null, "", hashFor(id));
  }
  $("#detail-title").focus({ preventScroll: true });
  return true;
}

export function closeDetail({ fromPop = false } = {}) {
  if (!app.selected) return;
  const last = app.selected;
  app.selected = null;
  $("#detail").hidden = true;
  selectMarker(null);
  emit("selected", null);
  if (isMobile() && !fromPop && history.state?.detail) {
    history.back();
  } else if (location.hash) {
    history.replaceState(null, "", `${location.pathname}${location.search}`);
  }
  emit("detail-closed", last);
}
