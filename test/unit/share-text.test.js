import assert from "node:assert/strict";
import { zeroAddress } from "viem";
import { postText, resultsText, xIntentUrl, xLength } from "../../web/src/lib/share-text.js";
import { makeEntries } from "../helpers.js";

const ROUND_242_DATA_HASH = "0x4c6033f0cb4c8aee682b4ef1b4a4ae4fea671fb9b1cfadb0ccbb6833b5e6ed78";

const drawn = {
  practice: false,
  title: "Three wheel-side seats",
  id: 7n,
  contract: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  chainId: 11155111,
  chainName: "Sepolia",
  entries: ["@squeektoshi", "Carol from the Discord", "zoë", "0x980b4424c007caf7a1f3670b48c8eaef7ebc3d44", "pellet_baron"],
  entryCount: 5,
  entriesHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
  round: 242n,
  dataHash: ROUND_242_DATA_HASH,
  seed: "0x2222222222222222222222222222222222222222222222222222222222222222",
  picks: [4, 1, 2],
  link: "https://booth.example/?id=7",
};

const fitsOnX = (text) => xLength(text) + 1 + 23 <= 280;

describe("share text", function () {
  it("copies every winner in pick order and one proof line with the full hashes", function () {
    const lines = resultsText(drawn).split("\n");
    assert.equal(lines[0], 'Hamster Draw raffle No. 0007: "Three wheel-side seats"');
    assert.deepEqual(lines.slice(2, 5), ["1st  pellet_baron  (No. 004)", "2nd  Carol from the Discord  (No. 001)", "3rd  zoë  (No. 002)"]);
    const proof = lines.find((line) => line.startsWith("Proof:"));
    for (const part of [ROUND_242_DATA_HASH, drawn.entriesHash, drawn.seed, drawn.contract, "round 242", "11155111"]) {
      assert.ok(proof.includes(part), `proof line mentions ${part}`);
    }
    assert.equal(lines.at(-1), "Check it: https://booth.example/?id=7");
  });

  it("fits the X post in 280, giving up names before the round, and builds the intent URL", function () {
    assert.ok(fitsOnX(postText(drawn)));
    assert.match(postText(drawn), /pellet_baron, Carol from the Discord and zoë/);

    const crowded = {
      ...drawn,
      title: "ü".repeat(40),
      entries: makeEntries(60, "a-rather-long-handle-for-a-hamster-fan"),
      entryCount: 60,
      picks: Array.from({ length: 50 }, (_, i) => i),
    };
    const text = postText(crowded);
    assert.ok(fitsOnX(text), `${xLength(text)} weighted characters`);
    assert.match(text, /round 242/);
    assert.match(text, /and \d+ more/);
    assert.equal(xLength("日本🐹a"), 7);

    const url = new URL(xIntentUrl(text, drawn.link));
    assert.equal(url.origin + url.pathname, "https://x.com/intent/post");
    assert.equal(url.searchParams.get("text"), text);
    assert.equal(url.searchParams.get("url"), drawn.link);
  });

  it("labels a practice draw as practice in both texts", function () {
    const practice = { ...drawn, practice: true, title: "", id: 0n, contract: zeroAddress, link: "https://booth.example/?practice#r=242" };
    assert.match(postText(practice), /^Practice draw on Hamster Draw/);
    assert.ok(fitsOnX(postText(practice)));
    const copied = resultsText(practice);
    assert.match(copied, /^Hamster Draw practice draw \(not a sealed raffle\)/);
    assert.match(copied, /Practice only/);
    assert.match(copied, /Replay it: https:\/\/booth\.example\/\?practice#r=242$/);
  });
});
