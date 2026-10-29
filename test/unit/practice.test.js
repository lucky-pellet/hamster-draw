// The practice draw runs in the browser, so it has to be the contract's rule exactly. These tests import the
// web modules as shipped (no copies) and compare them with HamsterDraw on Hardhat's in-process chain.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { keccak256, numberToHex, toHex, zeroAddress } from "viem";
import { parseEntries } from "../../web/src/lib/entries.js";
import { PRACTICE, practiceDraw, practiceLink, readPracticeLink, SAMPLE_LIST } from "../../web/src/lib/practice.js";
import { pickWinners } from "../../web/src/lib/raffle-math.js";
import { deployBooth, expectRevert, fakeDataHash, makeEntries } from "../helpers.js";

// Fresh random inputs on every run. A failure prints PARITY_SEED; set it in the environment to replay that run.
const PARITY_SEED = process.env.PARITY_SEED || toHex(randomBytes(8));

/** A reproducible stream of 256-bit numbers for one test. */
function stream(label) {
  let n = 0;
  return () => BigInt(keccak256(toHex(`${PARITY_SEED}:${label}:${n++}`)));
}
const below = (next, max) => Number(next() % BigInt(max));

// Bits of names: ASCII, accents, a combining mark, CJK, Hangul, emoji (4-byte UTF-8), spaces and punctuation.
const PIECES = ["a", "k", "Q", "z", "_", "-", ".", "@", " ", "  ", "0x", "7", "é", "ß", "ø", "Ü", "́", "日本", "語", "한", "🐹", "🎟️", "Squeek", "wheel"];

/** A pasted list of 2 to 141 random lines, cleaned the way the practice form cleans it. */
function randomList(next) {
  for (;;) {
    const lines = Array.from({ length: 2 + below(next, 140) }, () =>
      Array.from({ length: 1 + below(next, 14) }, () => PIECES[below(next, PIECES.length)]).join(""),
    );
    const { entries } = parseEntries(lines.join("\n"));
    if (entries.length >= 2) return entries;
  }
}

describe("practice draws (browser code vs HamsterDraw)", function () {
  before(function () {
    console.log(`      PARITY_SEED=${PARITY_SEED}`);
  });

  it("pickWinners in the browser equals the contract's for 300 random seeds and sizes", async function () {
    const { booth } = await deployBooth();
    const next = stream("pick");
    // Edges first: the smallest raffle, near-full draws, and lists around the 256-entry bitmap word.
    const sizes = [[2, 1], [3, 2], [51, 50], [255, 50], [256, 50], [257, 50], [512, 7], [1000, 50], [1000, 1]];
    while (sizes.length < 300) {
      const entries = 2 + below(next, 999);
      sizes.push([entries, 1 + below(next, Math.min(50, entries - 1))]);
    }
    for (const [entries, winners] of sizes) {
      const seed = numberToHex(next(), { size: 32 });
      const onchain = (await booth.read.pickWinners([seed, BigInt(winners), BigInt(entries)])).map(Number);
      assert.deepEqual(pickWinners(seed, winners, entries), onchain, `${winners} of ${entries}, seed ${seed}`);
    }
  });

  it("given a booth's id and address, practiceDraw reproduces winnersOf for 24 random pasted lists", async function () {
    const ctx = await deployBooth();
    const next = stream("lists");
    for (let batch = 0; batch < 3; batch++) {
      const raffles = [];
      for (let k = 0; k < 8; k++) {
        const entries = randomList(next);
        const winners = 1 + below(next, Math.min(50, entries.length - 1));
        const { id, target } = await ctx.open(entries, winners, `Parity ${batch}.${k}`);
        raffles.push({ id, target, entries, winners });
      }
      // One active round decides the whole batch, with a dataHash nobody picked by hand.
      const round = raffles.reduce((max, r) => (r.target > max ? r.target : max), 0n);
      await ctx.settle(round, [[round, 100n + BigInt(below(next, 600))]], `${PARITY_SEED}:${batch}`);

      for (const r of raffles) {
        await ctx.booth.write.draw([r.id]);
        const stored = await ctx.booth.read.getDraw([r.id]);
        const local = practiceDraw({
          entries: r.entries,
          winners: r.winners,
          dataHash: stored.dataHash,
          chainId: ctx.chainId,
          id: r.id,
          contract: ctx.booth.address,
        });
        assert.equal(local.entriesHash, stored.entriesHash, `entriesHash of raffle ${r.id}`);
        assert.equal(local.seed, stored.seed, `seed of raffle ${r.id}`);
        assert.deepEqual(local.picks, (await ctx.booth.read.winnersOf([r.id])).map(Number), `winners of raffle ${r.id}`);
      }
    }
  });

  it("uses stand-ins no real raffle can have, and the same rule the contract's view checks", async function () {
    const { booth } = await deployBooth();
    assert.equal(PRACTICE.id, 0n);
    assert.equal(PRACTICE.contract, zeroAddress);
    await expectRevert(booth.read.getDraw([PRACTICE.id]), "UnknownDraw", [0n]);

    const { entries } = parseEntries(SAMPLE_LIST);
    assert.ok(entries.length >= 10, "the sample list survives cleaning");
    const dataHash = fakeDataHash(375);
    const practice = practiceDraw({ entries, winners: 3, dataHash, chainId: 11155111 });
    const spelledOut = practiceDraw({ entries, winners: 3, dataHash, chainId: 11155111, id: 0n, contract: zeroAddress });
    assert.deepEqual(practice, spelledOut);
    const onchain = await booth.read.pickWinners([practice.seed, 3n, BigInt(entries.length)]);
    assert.deepEqual(practice.picks, onchain.map(Number));
  });

  it("practice links carry round, count, title and list after the #, and drop the list when too long", function () {
    const entries = ["Carol from the Discord", "zoë", "日本語 ok", "a&b=c#d+e", "100% hamster"];
    const link = practiceLink("https://booth.example/", { round: 375n, winners: 2, title: "Seats & snacks", entries });
    assert.equal(link.hasList, true);
    assert.ok(link.href.startsWith("https://booth.example/?practice#"), link.href);
    assert.deepEqual(readPracticeLink(link.href.slice(link.href.indexOf("#"))), {
      round: 375n,
      winners: 2,
      title: "Seats & snacks",
      list: entries.join("\n"),
    });

    const long = practiceLink("https://booth.example/", { round: 375n, winners: 50, title: "", entries: makeEntries(1000) });
    assert.equal(long.hasList, false);
    assert.deepEqual(readPracticeLink(long.href.slice(long.href.indexOf("#"))), { round: 375n, winners: 50, title: "", list: null });

    // The stream view link is the same draw with &embed=1, and it keeps the list where the share link cannot.
    for (const [made, list] of [[link, entries], [long, makeEntries(1000)]]) {
      assert.ok(made.embed.startsWith("https://booth.example/?practice&embed=1#"), made.embed);
      const params = new URL(made.embed).searchParams;
      assert.ok(params.has("practice") && params.get("embed") === "1");
      assert.equal(readPracticeLink(made.embed.slice(made.embed.indexOf("#"))).list, list.join("\n"));
    }

    assert.deepEqual(readPracticeLink("#r=-4&w=abc"), { round: null, winners: null, title: "", list: null });
    assert.deepEqual(readPracticeLink(""), { round: null, winners: null, title: "", list: null });
  });
});
