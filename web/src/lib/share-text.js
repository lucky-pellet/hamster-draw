// What "Copy results" and "Post on X" say about a finished draw. Plain strings only (rendering and the
// clipboard never see markup). Pure functions; the unit tests import this file as shipped.
//
// Both take a receipt: { practice, title, id, contract, chainId, chainName, entries, entryCount, entriesHash,
// round, dataHash, seed, picks, link }.
import { ordinal, serial, shortHex } from "./format.js";

const X_LIMIT = 280;
const X_LINK = 23; // X counts every link as 23 characters, however long it is

/** Length as X counts it: code points past U+10FF (CJK, most emoji) weigh 2. A little stricter than X. */
export function xLength(text) {
  let total = 0;
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    const light = cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037);
    total += light ? 1 : 2;
  }
  return total;
}

const nameOf = (r, index) => r.entries?.[index] ?? `ticket ${serial(index, 3)}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const clip = (text, max) => {
  const chars = [...String(text ?? "")];
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : chars.join("");
};

/** For the clipboard: what was drawn, every winner, one proof line with the full hashes, and the link. */
export function resultsText(r) {
  const proof =
    `Proof: round ${r.round} dataHash ${r.dataHash} · entriesHash ${r.entriesHash} · ` +
    `seed ${r.seed} = keccak256(abi.encode(dataHash, ${r.id}, entriesHash, ${r.chainId}, ${r.contract}))` +
    `${r.practice ? " with the practice stand-in id and booth" : ""} · ` +
    `pick i = keccak256(abi.encode(seed, i, attempt)) mod ${r.entryCount}, skipping repeats`;
  const lines = [
    r.practice
      ? `Hamster Draw practice draw${r.title ? `: "${r.title}"` : ""} (not a sealed raffle)`
      : `Hamster Draw raffle No. ${serial(r.id)}: "${r.title}"`,
    `${plural(r.picks.length, "winner")} from ${plural(r.entryCount, r.practice ? "name" : "ticket")}, ` +
      `picked by Squeektoshi's wheel in Squeekchain round ${r.round} (${r.chainName}):`,
    ...r.picks.map((index, i) => `${ordinal(i + 1)}  ${nameOf(r, index)}  (No. ${serial(index, 3)})`),
    proof,
  ];
  if (r.practice) {
    lines.push("Practice only: that round's dataHash was public before the list was pasted. A real raffle seals its list first.");
  }
  lines.push(`${r.practice ? "Replay it" : "Check it"}: ${r.link}`);
  return lines.join("\n");
}

function namesLine(names, shown) {
  if (!shown) return plural(names.length, "winner");
  const head = names.slice(0, shown);
  const rest = names.length - shown;
  if (rest) return `${head.join(", ")} and ${rest} more`;
  return head.length === 1 ? head[0] : `${head.slice(0, -1).join(", ")} and ${head.at(-1)}`;
}

function compose(r, names, shown, title) {
  const who = namesLine(names, shown);
  const hash = shortHex(r.dataHash, 10, 4);
  if (r.practice) {
    return (
      `Practice draw on Hamster Draw${title ? ` ("${title}")` : ""}: Squeektoshi's wheel picked ${who} ` +
      `from ${plural(r.entryCount, "name")} with Squeekchain round ${r.round} (dataHash ${hash}). ` +
      "Same list, same round, same winners:"
    );
  }
  return (
    `${title ? `"${title}"` : `Raffle No. ${r.id}`} is drawn. ${shown ? "Winners" : "Drawn"}: ${who}. ` +
    `Squeektoshi's wheel picked them in Squeekchain round ${r.round} (dataHash ${hash}). ` +
    "Sealed before he ran, checkable by anyone:"
  );
}

/** The post text for X (the link goes in separately). Drops names, then shortens the title, to fit 280. */
export function postText(r) {
  const names = r.picks.map((index) => nameOf(r, index));
  const fits = (text) => xLength(text) + 1 + X_LINK <= X_LIMIT;
  const tries = [];
  for (let shown = names.length; shown >= 1; shown--) tries.push([r.title, shown]);
  for (let shown = names.length; shown >= 0; shown--) tries.push([clip(r.title, 40), shown]);
  tries.push(["", 0]);
  for (const [title, shown] of tries) {
    const text = compose(r, names, shown, title);
    if (fits(text)) return text;
  }
  return compose(r, names, 0, "");
}

/** X's web intent: opens a prefilled post the visitor can still edit or cancel. */
export const xIntentUrl = (text, url) =>
  `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
