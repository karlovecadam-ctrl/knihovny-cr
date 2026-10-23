// Mapa: dlaždice OSM, body knihoven a shluky, zvýraznění, místo hledání a posuny výřezu.
import { CZ_BOUNDS, app, cssVar, emit, isMobile } from "./store.js";

let cluster;
let legend;
let selectRing;
let hoverRing;
let pointMarker;

function markerStyle(state) {
  return { radius: 7, weight: 2, color: "#ffffff", fillColor: app.colors[state], fillOpacity: 1, bubblingMouseEvents: false };
}

function clusterIcon(group) {
  const children = group.getAllChildMarkers();
  let open = 0;
  let closed = 0;
  for (const m of children) {
    if (m.options.state === "open") open++;
    else if (m.options.state === "closed") closed++;
  }
  const n = children.length;
  const size = n < 10 ? 30 : n < 100 ? 36 : n < 1000 ? 42 : 48;
  return L.divIcon({
    html: `<div class="cluster" style="--o:${(open / n) * 100}%;--c:${((open + closed) / n) * 100}%"><span>${n}</span></div>`,
    className: "",
    iconSize: [size, size],
  });
}

export function setupMap() {
  app.colors = {
    open: cssVar("--m-open"), closed: cssVar("--m-closed"), unknown: cssVar("--m-unknown"),
    select: cssVar("--m-select"), hover: cssVar("--m-hover"),
  };
  app.map = L.map("map", { preferCanvas: true }).fitBounds(CZ_BOUNDS);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">přispěvatelé OpenStreetMap</a>',
  }).addTo(app.map);
  cluster = L.markerClusterGroup({
    chunkedLoading: true, showCoverageOnHover: false, maxClusterRadius: 50, disableClusteringAtZoom: 14,
    iconCreateFunction: clusterIcon,
  });
  app.map.addLayer(cluster);

  legend = L.control({ position: isMobile() ? "topright" : "bottomleft" });
  legend.onAdd = () => {
    const box = L.DomUtil.create("div", "legend");
    box.innerHTML = `<b>Teď</b>
      <div><i style="background:${app.colors.open}"></i>otevřeno</div>
      <div><i style="background:${app.colors.closed}"></i>zavřeno</div>
      <div><i style="background:${app.colors.unknown}"></i>nelze určit</div>`;
    return box;
  };
  legend.addTo(app.map);
  app.map.on("moveend", () => emit("map-moved"));
  app.map.on("click", () => emit("map-click"));
}

export function adaptLegend() {
  legend.setPosition(isMobile() ? "topright" : "bottomleft");
}

export function buildMarkers() {
  for (const lib of app.libs) {
    if (lib.lat == null) continue;
    const state = app.states.get(lib.id);
    const marker = L.circleMarker([lib.lat, lib.lon], markerStyle(state));
    marker.options.state = state;
    // Leaflet vkládá řetězec jako HTML; název z adresáře proto předáváme jako textový uzel
    marker.bindTooltip(() => document.createTextNode(lib.name), { direction: "top", offset: [0, -6] });
    marker.on("click", () => emit("marker-click", lib.id));
    marker.on("mouseover", () => emit("marker-hover", lib.id));
    marker.on("mouseout", () => emit("marker-hover", null));
    app.markers.set(lib.id, marker);
  }
}

export function showMarkers(libs) {
  cluster.clearLayers();
  cluster.addLayers(libs.map((lib) => app.markers.get(lib.id)).filter(Boolean));
}

export function restyleMarkers(ids) {
  const touched = [];
  for (const id of ids) {
    const marker = app.markers.get(id);
    if (!marker) continue;
    marker.options.state = app.states.get(id);
    marker.setStyle(markerStyle(marker.options.state));
    touched.push(marker);
  }
  if (touched.length) cluster.refreshClusters(touched);
}

function ring(existing, lib, color, radius) {
  const ll = [lib.lat, lib.lon];
  const r = existing || L.circleMarker(ll, { radius, weight: 3, color, fill: false, interactive: false });
  return r.setLatLng(ll).addTo(app.map);
}

export function selectMarker(lib) {
  if (!lib || lib.lat == null) {
    if (selectRing) selectRing.remove();
    return;
  }
  selectRing = ring(selectRing, lib, app.colors.select, 13);
}

export function hoverMarker(lib) {
  if (!lib || lib.lat == null) {
    if (hoverRing) hoverRing.remove();
    return;
  }
  hoverRing = ring(hoverRing, lib, app.colors.hover, 12);
}

export function inViewTest() {
  const bounds = app.map.getBounds();
  return (lib) => lib.lat != null && bounds.contains([lib.lat, lib.lon]);
}

export const fitTo = (bounds, padding = 0) => app.map.fitBounds(bounds, { padding: [padding, padding] });
export const centerOn = (ll, zoom) => app.map.setView(ll, zoom);

// Posune mapu tak, aby knihovna byla uprostřed části mapy, kterou nezakrývá zásuvka detailu.
export function panToVisible(lib, drawerWidth) {
  if (lib.lat == null) return;
  const size = app.map.getSize();
  const target = app.map.latLngToContainerPoint([lib.lat, lib.lon]);
  const wantX = (size.x - drawerWidth) / 2;
  app.map.panBy([target.x - wantX, target.y - size.y / 2]);
}

export function zoomToArea(region, district) {
  if (!region) {
    fitTo(CZ_BOUNDS);
    return;
  }
  const inArea = app.libs.filter((l) => l.lat != null && l.region === region && (!district || l.district === district));
  if (inArea.length) fitTo(L.latLngBounds(inArea.map((l) => [l.lat, l.lon])), 24);
}

export function setPointMarker(lat, lon, isUser) {
  if (pointMarker) pointMarker.remove();
  pointMarker = L.circleMarker([lat, lon], {
    radius: isUser ? 8 : 6, weight: 3, color: "#ffffff", fillColor: app.colors.select, fillOpacity: 1, interactive: false,
  }).addTo(app.map);
  if (isUser) pointMarker.bindTooltip("Vy", { permanent: true, direction: "right", offset: [8, 0] });
}

export function clearPointMarker() {
  if (pointMarker) pointMarker.remove();
}

export const invalidateMap = () => app.map.invalidateSize();
