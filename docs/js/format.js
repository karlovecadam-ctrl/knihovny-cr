// Texty pro zobrazení: české tvary počtu, stav otevírací doby, odkazy.

export const DAY_SHORT = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];
export const DAY_LONG = ["Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek", "Sobota", "Neděle"];
// „ve 13:00“, ale „v 9:00“: předložka ve před číslovkami začínajícími souhláskovou skupinou
const VE_HOURS = new Set([2, 3, 4, 12, 13, 14, 20, 21, 22, 23, 24]);

export function groupDigits(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

// forms = [1, 2–4, 5+], např. ["knihovna", "knihovny", "knihoven"]
export function plural(n, forms) {
  const form = n === 1 ? forms[0] : n >= 2 && n <= 4 ? forms[1] : forms[2];
  return `${groupDigits(n)} ${form}`;
}

export const formatTime = (hhmm) => hhmm.replace(/^0(\d)/, "$1");
export const formatInterval = ([from, to]) => `${formatTime(from)}–${formatTime(to)}`;

function at(time) {
  const hour = Number(time.split(":")[0]);
  return `${VE_HOURS.has(hour) ? "ve" : "v"} ${formatTime(time)}`;
}

// today = pražský den (0 = pondělí); hasRaw = knihovna má otevírací dobu, ale nejde převést
export function statusText(status, today, hasRaw = false) {
  if (status.state === "open") return `Otevřeno · dnes do ${formatTime(status.until)}`;
  if (status.reason === "holiday") return "Dnes je státní svátek, otevření ověřte";
  if (status.reason === "qualified") return "Otevírací doba má výjimky, viz poznámka";
  if (status.state === "unknown") return hasRaw ? "Otevírací dobu nelze určit" : "Otevírací doba neuvedena";
  if (!status.next) return "Zavřeno";
  const { day, time } = status.next;
  if (day === today) return `Zavřeno · otevírá ${at(time)}`;
  if (day === (today + 1) % 7) return `Zavřeno · otevírá zítra ${at(time)}`;
  return `Zavřeno · otevírá ${DAY_SHORT[day]} ${formatTime(time)}`;
}

// Trasa v Mapy.com; bez startu si ho doplní aplikace (na mobilu z aktuální polohy).
export function mapyUrl(lat, lon, start = null) {
  const from = start ? `start=${start.lon},${start.lat}&` : "";
  return `https://mapy.com/fnc/v1/route?${from}end=${lon},${lat}&routeType=car_fast&navigate=true`;
}

export function formatFund(fund) {
  if (!fund) return null;
  const parts = [];
  if (fund.books) parts.push(`${groupDigits(fund.books)} knih`);
  if (fund.periodicals) parts.push(`${groupDigits(fund.periodicals)} titulů periodik`);
  if (!parts.length) return null;
  return parts.join(" · ") + (fund.year ? ` (${fund.year})` : "");
}
