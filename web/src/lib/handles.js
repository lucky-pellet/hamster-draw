// Pulls X handles out of whatever a giveaway host copies from x.com: a reply thread, a quote list, a reposts
// list, or a plain list of handles. Pure functions: the X helper and the unit tests import this file as shipped.
//
// X's rule for a handle is 1 to 15 of A-Z, a-z, 0-9 and _. A mention is an @ (or the fullwidth ＠) that is not
// glued to the word before it, so bob@example.com is an email, not @example. When a letter like é is glued
// straight after the name, X does not link the mention at all, and neither does this.

/** Zero-width and direction marks that ride along when text is copied out of a web page. */
const INVISIBLE = /[​-‏‪-‮⁠-⁩﻿]/g;

const MAX = 15;

// One pass over a line finds, left to right: an email, an x.com or twitter.com link, some other web link
// (ignored, so example.com/@name is not read as a mention), or an @ with whatever is glued after it.
// No lookbehind for "glued before": Safari only parses that from 16.4, so scanLine() checks it by hand.
const TOKEN = new RegExp(
  [
    String.raw`(?<email>[A-Za-z0-9._%+-]+[@＠][A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)`,
    String.raw`(?<xurl>\b(?:https?:\/\/)?(?:www\.|mobile\.)?(?:[xX]|[tT]witter)\.com\/(?<path>[A-Za-z0-9_]*)\S*)`,
    String.raw`(?<link>\bhttps?:\/\/\S+)`,
    String.raw`(?<at>[@＠])(?<name>[A-Za-z0-9_]*)(?<tail>[\p{L}\p{M}\p{N}_]*)`,
  ].join("|"),
  "gu",
);
/** What may not come right before a mention's @ (X's own rule): x@y and #@y are not mentions. */
const GLUED = /[\p{L}\p{N}\p{M}_!#$%&*@＠]$/u;

/** First path segments on x.com that are pages, not people. */
const NOT_PROFILES = new Set([
  "i", "home", "explore", "search", "hashtag", "intent", "share", "settings", "messages",
  "notifications", "compose", "login", "signup", "tos", "privacy", "about", "download", "jobs",
]);

// How X's web page copies out: a reply's header is the name, the @handle and "·" plus a time (on one line or
// several), then "Replying to @someone" (also spread over lines: "Replying to", "@a", " and ", "@b").
const REPLYING = /^\s*replying to\b/i;
const OPEN_END = /(?:\bto|\band|,|&)\s*$/i;
const JOINS_ON = /^\s*(?:and\b|,|&)/i;
const DOT_LINE = /^\s*·\s*$/;
const FOLLOW_LINE = /^\s*(?:follow|following|follows you|follow back)\s*$/i;

/** Why something was left out, in the order the helper lists them. */
export const DROP_REASONS = Object.freeze({
  host: "The host, left out on purpose",
  repeat: "More than once, counted once",
  tagged: "Only tagged inside someone's post",
  replying: "Only in a \"Replying to\" line",
  "too-long": "Longer than the 15 characters X allows",
  "bad-chars": "X handles only use A to Z, 0 to 9 and _",
  "not-profile": "An X link, but not to anyone's profile",
  email: "An email address, not a handle",
  "not-handle": "Not a handle: 1 to 15 letters, digits or _",
});
const ORDER = Object.keys(DROP_REASONS);

const noLetters = (text) => !/\p{L}/u.test(text);

/** What a host typed as their own handle: "@name", "name" or an x.com link. */
export function readHost(raw) {
  const text = String(raw ?? "").replace(INVISIBLE, "").trim();
  if (!text) return { key: null, name: null, problem: null };
  const match = /^(?:(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/)?[@＠]?([A-Za-z0-9_]+)\/?$/i.exec(text);
  if (!match || match[1].length > MAX) return { key: null, name: null, problem: "not-handle" };
  return { key: match[1].toLowerCase(), name: match[1], problem: null };
}

/** One token from TOKEN: { name } for a usable handle, { drop, text } for a rejected one, null to ignore. */
function readToken(groups) {
  if (groups.email) return { drop: "email", text: groups.email };
  if (groups.link !== undefined) return null;
  if (groups.xurl !== undefined) {
    const path = groups.path;
    if (!path || NOT_PROFILES.has(path.toLowerCase())) return { drop: "not-profile", text: groups.xurl };
    if (path.length > MAX) return { drop: "too-long", text: `@${path}` };
    return { name: path };
  }
  const { name, tail } = groups;
  if (!name && !tail) return null; // a lone @, as in "see you @ 9"
  if (!name || /^[\p{Script=Latin}\p{M}]/u.test(tail)) return { drop: "bad-chars", text: `@${name}${tail}` };
  if (name.length > MAX) return { drop: "too-long", text: `@${name}` };
  return { name }; // anything else glued on (さん, 님) ends the mention, as on X
}

/** Tokens on one line, plus the line with the tokens cut out (to see whether anything else is on it). */
function scanLine(line) {
  const tokens = [];
  let rest = "";
  let last = 0;
  for (const match of line.matchAll(TOKEN)) {
    rest += `${line.slice(last, match.index)} `;
    last = match.index + match[0].length;
    // Two code units before the @ cover one whole code point, even an astral one.
    if (match.groups.at && GLUED.test(line.slice(Math.max(0, match.index - 2), match.index))) continue;
    const token = readToken(match.groups);
    if (!token) continue;
    // "Name @handle · 2h": a handle followed by X's dot is the post's author.
    token.header = Boolean(token.name) && /^\s*·/.test(line.slice(last));
    tokens.push(token);
  }
  return { tokens, rest: rest + line.slice(last) };
}

/**
 * Finds the X handles in pasted text.
 *
 * Copied posts (anything with X's "·" header, "Replying to" lines or Follow buttons) count the people who
 * posted: a handle on a line of its own, or in a "Name @handle · 2h" header. Handles tagged inside a post, and
 * the ones in "Replying to" lines, do not count unless `tagged` is true. Anything else is read as a list, where
 * every handle counts. With no @ and no x.com link anywhere, each line (or comma-separated piece) is read as one
 * bare handle.
 *
 * Handles keep the spelling of their first counted appearance and the order they first appear in; repeats are
 * matched ignoring case, like the raffle list itself. `host` (as "@name", "name" or a profile link) is left out.
 *
 * Returns { handles: ["@name", ...], dropped: [{ reason, text, count, line }], readAs: "posts" | "list" |
 * "bare" | "empty", taggedCounted, taggedFound, host: "@name" | null, hostProblem, busiest }. `count` is how many
 * times that text was seen for that reason (for "repeat", how many times it was seen as an entry), `line` the
 * first line it was on. `busiest` ({ handle, count } or null) is the handle that shows up most in copied posts,
 * offered as a guess at the host when none is given.
 */
export function extractHandles(text, { host = "", tagged = "auto" } = {}) {
  const hostInfo = readHost(host);
  const source = String(text ?? "").normalize("NFC").replace(INVISIBLE, "");
  const lines = source.split(/\r\n|\r|\n/);
  const seen = []; // { key, name, kind: "own" | "tagged" | "replying", line }
  const rejected = []; // { reason, text, line }
  let posts = false;

  const bare = !/[@＠]/.test(source) && !/(?:^|[^A-Za-z0-9])(?:x|twitter)\.com\//i.test(source);
  if (bare) {
    lines.forEach((raw, i) => {
      for (const piece of raw.split(/[,;\t]+/)) {
        const value = piece.replace(/^\s*(?:[-*•·]+|\d{1,4}[.)])\s+/, "").trim();
        if (!value) continue;
        if (/^[A-Za-z0-9_]+$/.test(value)) {
          if (value.length > MAX) rejected.push({ reason: "too-long", text: value, line: i + 1 });
          else seen.push({ key: value.toLowerCase(), name: value, kind: "own", line: i + 1 });
        } else {
          rejected.push({ reason: "not-handle", text: value.length > 40 ? `${value.slice(0, 39)}…` : value, line: i + 1 });
        }
      }
    });
  } else {
    let block = null; // inside a "Replying to" run: "open" wants another handle, "closed" only goes on after "and" or ","
    lines.forEach((raw, i) => {
      const line = i + 1;
      const { tokens, rest } = scanLine(raw);
      const record = (kindOf) => {
        for (const token of tokens) {
          if (token.drop) rejected.push({ reason: token.drop, text: token.text, line });
          else seen.push({ key: token.name.toLowerCase(), name: token.name, kind: kindOf(token), line });
        }
      };

      if (REPLYING.test(raw)) {
        posts = true;
        record(() => "replying");
        block = OPEN_END.test(raw) ? "open" : "closed";
        return;
      }
      if (block) {
        if (!raw.trim()) return;
        const onlyNames = noLetters(rest.replace(/\b(?:and|others?)\b|&/gi, ""));
        if (onlyNames && (block === "open" || JOINS_ON.test(raw))) {
          record(() => "replying");
          block = OPEN_END.test(raw) ? "open" : "closed";
          return;
        }
        block = null;
      }

      if (DOT_LINE.test(raw) || FOLLOW_LINE.test(raw)) posts = true;
      const listLine = noLetters(rest.replace(/\b(?:and|or)\b|&/gi, ""));
      record((token) => {
        if (token.header) posts = true;
        return listLine || token.header ? "own" : "tagged";
      });
    });
  }

  const ownFound = seen.some((s) => s.kind === "own");
  const taggedCounted = tagged === true || (tagged === "auto" && !(posts && ownFound));
  const counts = (s) => s.kind === "own" || (s.kind === "tagged" && taggedCounted);

  const counted = new Map(); // key -> { handle, times, line }
  const passed = new Map(); // key -> { name, tagged, times, line }: seen, but never in a way that counts
  let hostSeen = null;
  for (const s of seen) {
    if (hostInfo.key && s.key === hostInfo.key) {
      hostSeen ??= { times: 0, line: s.line };
      hostSeen.times += 1;
    } else if (counts(s)) {
      const entry = counted.get(s.key);
      if (entry) entry.times += 1;
      else counted.set(s.key, { handle: `@${s.name}`, times: 1, line: s.line });
    } else {
      const entry = passed.get(s.key) ?? { name: s.name, tagged: false, times: 0, line: s.line };
      entry.times += 1;
      entry.tagged ||= s.kind === "tagged";
      passed.set(s.key, entry);
    }
  }

  const dropped = [];
  if (hostSeen) dropped.push({ reason: "host", text: `@${hostInfo.name}`, count: hostSeen.times, line: hostSeen.line });
  for (const entry of counted.values()) {
    if (entry.times > 1) dropped.push({ reason: "repeat", text: entry.handle, count: entry.times, line: entry.line });
  }
  for (const [key, entry] of passed) {
    if (counted.has(key)) continue;
    dropped.push({ reason: entry.tagged ? "tagged" : "replying", text: `@${entry.name}`, count: entry.times, line: entry.line });
  }
  const grouped = new Map();
  for (const r of rejected) {
    const key = `${r.reason}|${r.text.toLowerCase()}`;
    const entry = grouped.get(key);
    if (entry) entry.count += 1;
    else grouped.set(key, { ...r, count: 1 });
  }
  dropped.push(...grouped.values());
  dropped.sort((a, b) => ORDER.indexOf(a.reason) - ORDER.indexOf(b.reason) || a.line - b.line);

  let busiest = null;
  if (posts && !hostInfo.key) {
    const tally = new Map();
    for (const s of seen) {
      const entry = tally.get(s.key) ?? { handle: `@${s.name}`, count: 0 };
      entry.count += 1;
      tally.set(s.key, entry);
    }
    const [top, next] = [...tally.values()].sort((a, b) => b.count - a.count);
    if (top && top.count >= 3 && (next?.count ?? 0) < top.count) busiest = top;
  }

  const empty = !source.trim();
  return {
    handles: [...counted.values()].map((entry) => entry.handle),
    dropped,
    readAs: empty ? "empty" : bare ? "bare" : posts ? "posts" : "list",
    taggedCounted,
    taggedFound: seen.some((s) => s.kind === "tagged" && s.key !== hostInfo.key),
    host: hostInfo.key ? `@${hostInfo.name}` : null,
    hostProblem: hostInfo.problem,
    busiest,
  };
}

/** A made-up reply thread, the way x.com copies out, for trying the helper without a real giveaway. */
export const SAMPLE_THREAD = [
  "Pellet Baron",
  "@pellet_baron",
  "·",
  "2h",
  "GIVEAWAY: 3 seats next to the wheel for Friday's stream",
  "Reply with your handle and tag a friend. Following @squeekchain helps, not required.",
  "Winners drawn by the hamster on Hamster Draw.",
  "48",
  "212",
  "96",
  "14K",
  "Night-shift Nadia",
  "@nadia_nights",
  "·",
  "1h",
  "Replying to ",
  "@pellet_baron",
  "in! bringing @gus_streamchat along",
  "3",
  "1",
  "Wheel Watcher",
  "@Wheel_Watch_42",
  "·",
  "1h",
  "Replying to @pellet_baron",
  "gm, count me in. cc @cheek_pouch_cap @Bea_the_mod",
  "2",
  "Seed Vault DAO",
  "@seed_vault_dao",
  "·",
  "58m",
  "Replying to ",
  "@pellet_baron",
  " and ",
  "@nadia_nights",
  "we're in. contact: vault@seedvault.example",
  "midnight sprinter",
  "@midnite_sprint",
  "·",
  "41m",
  "Replying to @pellet_baron",
  "LFG @auntie_squeek_official_account",
  "Auntie Squeek",
  "@auntie_squeek",
  "·",
  "33m",
  "Replying to @pellet_baron",
  "hi! (my old one was @zoë_squeeks)",
  "Wheel Watcher",
  "@wheel_watch_42",
  "·",
  "20m",
  "Replying to @pellet_baron",
  "entering again just in case",
  "Show more replies",
  "Sunflower Seed Steve @sunflower_steve · 12m",
  "Replying to @pellet_baron and 2 others",
  "me me me ＠pellet_baron",
].join("\n");

/** The host of SAMPLE_THREAD, filled in along with it. */
export const SAMPLE_HOST = "@pellet_baron";
