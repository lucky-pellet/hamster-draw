// Small display helpers. Everything returns plain strings; rendering escapes them.

export const shortHex = (hex, head = 6, tail = 4) =>
  typeof hex === "string" && hex.length > head + tail + 1 ? `${hex.slice(0, head)}…${hex.slice(-tail)}` : hex ?? "";

export const serial = (n, width = 4) => String(n).padStart(width, "0");

export const thousands = (value) => (value === null || value === undefined ? "–" : BigInt(value).toLocaleString("en-US"));

export function ordinal(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th"}`;
}

/** "21:40 UTC" */
export const utcClock = (date) => `${date.toISOString().slice(11, 16)} UTC`;

/** "28 Oct, 21:40 UTC" */
export function utcStamp(date) {
  const month = date.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  return `${date.getUTCDate()} ${month}, ${utcClock(date)}`;
}

/** "in 7 min", "2 h 5 min ago", "now" */
export function relative(targetMs, nowMs = Date.now()) {
  const diff = Math.round((targetMs - nowMs) / 1000);
  const abs = Math.abs(diff);
  if (abs < 45) return "now";
  const minutes = Math.round(abs / 60);
  const text = minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  return diff > 0 ? `in ${text}` : `${text} ago`;
}

/** "4:07" countdown, or "0:00" once passed. */
export function countdown(targetMs, nowMs = Date.now()) {
  const total = Math.max(0, Math.round((targetMs - nowMs) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** "455 m", "9.82 km" */
export function distance(meters) {
  if (meters === null || meters === undefined) return "–";
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(2)} km`;
}

/** Strict patterns for turning an entry into a link; anything else stays plain text. */
export function entryLink(entry, explorer) {
  const handle = /^@([A-Za-z0-9_]{1,15})$/.exec(entry);
  if (handle) return { href: `https://x.com/${handle[1]}`, label: "X profile" };
  if (explorer && /^0x[0-9a-fA-F]{40}$/.test(entry)) return { href: `${explorer}/address/${entry}`, label: "address" };
  return null;
}
