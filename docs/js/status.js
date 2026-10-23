// Stav otevírací doby. Počítá se vždy v pražském čase, bez ohledu na časové pásmo návštěvníka.
// hours.days[0] = pondělí … hours.days[6] = neděle, intervaly ["HH:MM", "HH:MM"].
// hours.qualified: "always" = poznámka rozvrh omezuje (sudé týdny, uzavřeno…), "summer" = jen v červenci a srpnu.

const WEEKDAY = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Prague", year: "numeric", month: "numeric", day: "numeric",
  weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const FIXED_HOLIDAYS = new Set(["1-1", "5-1", "5-8", "7-5", "7-6", "9-28", "10-28", "11-17", "12-24", "12-25", "12-26"]);

function pragueParts(date) {
  const p = Object.fromEntries(FORMAT.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year), month: Number(p.month), date: Number(p.day),
    day: WEEKDAY[p.weekday], minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

export function pragueNow(date) {
  const { day, minutes } = pragueParts(date);
  return { day, minutes };
}

export function pragueDate(date) {
  const { year, month, date: day } = pragueParts(date);
  return { year, month, day };
}

// Velikonoční neděle (gregoriánský výpočet, „anonymní“ algoritmus)
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day);
}

export function isHoliday(year, month, day) {
  if (FIXED_HOLIDAYS.has(`${month}-${day}`)) return true;
  const t = Date.UTC(year, month - 1, day);
  const easter = easterSunday(year);
  const DAY = 86_400_000;
  return t === easter - 2 * DAY || t === easter + DAY; // Velký pátek, Velikonoční pondělí
}

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export function openStatus(hours, date) {
  if (!hours || !hours.parsed || !hours.days) return { state: "unknown" };
  const now = pragueParts(date);
  if (isHoliday(now.year, now.month, now.date)) return { state: "unknown", reason: "holiday" };
  if (hours.qualified === "always" || (hours.qualified === "summer" && (now.month === 7 || now.month === 8))) {
    return { state: "unknown", reason: "qualified" };
  }
  const { day, minutes } = now;
  for (const [from, to] of hours.days[day]) {
    if (toMinutes(from) <= minutes && minutes < toMinutes(to)) return { state: "open", until: to };
  }
  for (let offset = 0; offset <= 7; offset++) {
    const d = (day + offset) % 7;
    const next = hours.days[d].find(([from]) => offset > 0 || toMinutes(from) > minutes);
    if (next) return { state: "closed", next: { day: d, time: next[0] } };
  }
  return { state: "closed" };
}

export function openOnWeekend(hours) {
  if (!hours || !hours.parsed || !hours.days || hours.qualified === "always") return null;
  return hours.days[5].length > 0 || hours.days[6].length > 0;
}
