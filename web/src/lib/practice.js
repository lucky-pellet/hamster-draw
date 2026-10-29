// Practice draws: the contract's own winner rule, run in this browser on a round Squeektoshi has already run.
// Nothing is sealed, signed or sent anywhere. Raffle id 0 and the zero address stand in for the raffle number
// and the booth contract. No real raffle can have either (ids start at 1, and nothing is deployed at the zero
// address), so a practice seed never equals a real one. Pure functions: the unit tests import this file as
// shipped and check it against HamsterDraw.sol.
import { zeroAddress } from "viem";
import { drawSeed, hashEntries, pickWinners } from "./raffle-math.js";

export const PRACTICE = Object.freeze({ id: 0n, contract: zeroAddress });

/** A list to play with, so the first click already draws something. */
export const SAMPLE_LIST = [
  "Carol from the Discord",
  "pellet_baron",
  "Night-shift Nadia",
  "wheel_watcher_42",
  "the postal worker from LA",
  "Sunflower Seed Steve",
  "cheek_pouch_capital",
  "Bea the Discord mod",
  "midnight_sprinter",
  "Gus from stream chat",
  "Auntie Squeek",
  "seed_vault_dao",
].join("\n");

/**
 * Seals the list, derives the seed and picks the winners exactly as HamsterDraw does:
 * seed = keccak256(abi.encode(dataHash, id, entriesHash, chainId, contract)), then pickWinners(seed, winners, n).
 * `id` and `contract` default to the practice stand-ins; pass a real booth's values to reproduce a real draw.
 */
export function practiceDraw({ entries, winners, dataHash, chainId, id = PRACTICE.id, contract = PRACTICE.contract }) {
  const entriesHash = hashEntries(entries);
  const seed = drawSeed({ dataHash, id, entriesHash, chainId, contract });
  return { entriesHash, seed, picks: pickWinners(seed, winners, entries.length) };
}

// Longer links get refused or cut by some apps; past this the link keeps the round but drops the list.
const LINK_LIMIT = 4000;
// The stream view link goes into OBS or an iframe, never into a post, so it may carry a much longer list.
const EMBED_LIMIT = 64000;

/**
 * A link that replays a practice draw. Everything rides after the `#`, which browsers never send to a server:
 * r = round, w = winners, t = title, l = the list (left out when it would make the link too long).
 * `embed` is the same draw in the stream view (`?practice&embed=1#...`), for OBS or an iframe.
 */
export function practiceLink(base, { round, winners, title, entries }) {
  const params = new URLSearchParams({ r: String(round), w: String(winners) });
  if (title) params.set("t", title);
  const short = String(params);
  params.set("l", entries.join("\n"));
  const full = String(params);
  const page = `${base}?practice#${full}`;
  const stream = `${base}?practice&embed=1#${full}`;
  return {
    href: page.length <= LINK_LIMIT ? page : `${base}?practice#${short}`,
    hasList: page.length <= LINK_LIMIT,
    embed: stream.length <= EMBED_LIMIT ? stream : `${base}?practice&embed=1#${short}`,
  };
}

/** Reads a practice link's fragment. Anything malformed comes back as null (or "" for the title). */
export function readPracticeLink(hash) {
  const params = new URLSearchParams(String(hash ?? "").replace(/^#/, ""));
  const r = params.get("r") ?? "";
  const w = params.get("w") ?? "";
  const round = /^[0-9]{1,12}$/.test(r) && BigInt(r) > 0n ? BigInt(r) : null;
  const winners = /^[0-9]{1,2}$/.test(w) && Number(w) > 0 ? Number(w) : null;
  return { round, winners, title: (params.get("t") ?? "").slice(0, 120), list: params.get("l") };
}
