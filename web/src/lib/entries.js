// Turns whatever people paste (one entry per line) into the list the contract will seal.
// Pure functions, shared by the create form and the unit tests.

/** Limits enforced by HamsterDraw.sol, in UTF-8 bytes where it matters. */
export const LIMITS = Object.freeze({
  titleBytes: 80,
  minEntries: 2,
  maxEntries: 1000,
  entryBytes: 64,
  maxWinners: 50,
});

const encoder = new TextEncoder();

/** Length in UTF-8 bytes, which is what the contract counts. */
export const byteLength = (text) => encoder.encode(text).length;

/** NFC, no zero-width characters, inner whitespace collapsed, trimmed. */
export function cleanEntry(raw) {
  return String(raw)
    .normalize("NFC")
    .replace(/[​-‍⁠﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Splits pasted text into entries: trims lines, skips blanks, drops repeats (case-insensitive, first spelling
 * wins) and reports lines that are too long. Too-long lines are left out of `entries` so nothing gets cut short
 * silently; the form refuses to submit until they are fixed.
 */
export function parseEntries(text) {
  const firstSeen = new Map();
  const entries = [];
  const duplicates = [];
  const tooLong = [];
  let blank = 0;

  // Trailing blank lines are just the end of the paste, not blanks anyone typed.
  const source = String(text ?? "").replace(/\s+$/, "");
  const lines = source ? source.split(/\r\n|\r|\n/) : [];
  lines.forEach((raw, i) => {
    const line = i + 1;
    const value = cleanEntry(raw);
    if (!value) {
      blank += 1;
      return;
    }
    const key = value.toLowerCase();
    if (firstSeen.has(key)) {
      duplicates.push({ line, value, firstLine: firstSeen.get(key) });
      return;
    }
    firstSeen.set(key, line);
    const bytes = byteLength(value);
    if (bytes > LIMITS.entryBytes) {
      tooLong.push({ line, value, bytes });
      return;
    }
    entries.push(value);
  });

  return { entries, duplicates, tooLong, blank };
}

/** True when the text looks like one comma-separated line rather than one entry per line. */
export function looksCommaSeparated(text) {
  const lines = String(text ?? "").split(/\r\n|\r|\n/).filter((l) => l.trim());
  return lines.length === 1 && lines[0].split(",").filter((p) => p.trim()).length >= 2;
}

/** Highest winner count the contract accepts for `entryCount` entries (0 when no raffle is possible). */
export function maxWinnersFor(entryCount) {
  if (entryCount < LIMITS.minEntries) return 0;
  return Math.min(LIMITS.maxWinners, entryCount - 1);
}
