// The HamsterDraw tests are only as good as the mock they run against, so the mock gets its own checks
// against the documented SqueekCore V3 rules (and the shapes seen on the live core).
import assert from "node:assert/strict";
import { deployBooth, expectRevert, fakeDataHash } from "../helpers.js";

describe("MockSqueekCore (test double)", function () {
  it("lists only active rounds and stops a page just before an active round it cannot fit", async function () {
    const ctx = await deployBooth();
    const { core } = ctx;
    // Active: 2, 3, 7, 9. Zero work: 1, 4, 5, 6, 8, 10.
    await ctx.settle(10n, [[2n, 120n], [3n, 536n], [7n, 699n], [9n, 41n]]);

    const all = await core.read.roundPage([0n, 10n, 16n]);
    assert.deepEqual(all.rounds.map((r) => r.roundId), [2n, 3n, 7n, 9n]);
    assert.equal(all.certifiedThroughRound, 10n);

    const one = await core.read.roundPage([0n, 10n, 1n]);
    assert.deepEqual(one.rounds.map((r) => r.roundId), [2n]);
    assert.equal(one.certifiedThroughRound, 2n, "stops just before round 3");

    const none = await core.read.roundPage([3n, 10n, 0n]);
    assert.equal(none.rounds.length, 0);
    assert.equal(none.certifiedThroughRound, 6n, "a zero budget stops just before round 7");

    const zeroSpan = await core.read.roundPage([3n, 6n, 16n]);
    assert.equal(zeroSpan.rounds.length, 0);
    assert.equal(zeroSpan.certifiedThroughRound, 6n);

    // Paging by the returned frontier visits every active round exactly once, with continuous positions.
    let after = 0n;
    const seen = [];
    let lastEnd = null;
    while (after < 10n) {
      const page = await core.read.roundPage([after, 10n, 1n]);
      if (lastEnd) assert.deepEqual(page.start, lastEnd);
      seen.push(...page.rounds.map((r) => r.roundId));
      lastEnd = page.end;
      after = page.certifiedThroughRound;
    }
    assert.deepEqual(seen, [2n, 3n, 7n, 9n]);
  });

  it("reports work as differences of cumulative work, priced first and steered after", async function () {
    const ctx = await deployBooth();
    const works = [[2n, 120n], [3n, 536n], [4n, 20n], [6n, 699n]];
    await ctx.settle(6n, works);
    const page = await ctx.core.read.roundPage([0n, 6n, 16n]);

    // Replay the documented integer rule.
    let W = 0n;
    let U = 0n;
    let D = 10_000n;
    page.rounds.forEach((checkpoint, i) => {
      const w = works[i][1];
      U += (w * 10n ** 12n) / D;
      W += w;
      if (w >= 40n) D = (29n * D + (w * 1000n) / 40n) / 30n;
      assert.equal(checkpoint.cumulativeWork, W);
      assert.equal(checkpoint.cumulativeBlockUnits, U);
      assert.equal(BigInt(checkpoint.workPerThousandBlocks), D);
      assert.equal(checkpoint.dataHash, fakeDataHash(works[i][0]));
    });
    assert.equal(page.start.cumulativeWork, 0n);
    assert.equal(page.end.cumulativeWork, W);

    const state = await ctx.core.read.state();
    assert.equal(state.settledThroughRound, 6n);
    assert.equal(state.cumulativeWork, W);
    assert.equal(state.blockHeight, U / 1_000_000_000n);
    assert.equal(state.blockProgress, U % 1_000_000_000n);
  });

  it("rejects pages that are reversed, past the frontier or over 16 records", async function () {
    const ctx = await deployBooth();
    await ctx.settle(5n, [[2n, 100n]]);
    await expectRevert(ctx.core.read.roundPage([4n, 3n, 1n]), "InvalidRoundPageBounds");
    await expectRevert(ctx.core.read.roundPage([0n, 6n, 1n]), "InvalidRoundPageBounds");
    await expectRevert(ctx.core.read.roundPage([0n, 5n, 17n]), "InvalidRoundPageBounds");
    const point = await ctx.core.read.roundPage([5n, 5n, 0n]);
    assert.equal(point.certifiedThroughRound, 5n);
  });

  it("only settles rounds that have ended, moving the frontier forward", async function () {
    const ctx = await deployBooth();
    const current = await ctx.booth.read.currentRound();
    await expectRevert(ctx.core.write.settle([[], current]), "RoundNotElapsed");
    await ctx.settle(current - 1n, []);
    await expectRevert(ctx.core.write.settle([[], current - 1n]), "SettledThroughRoundNotAdvanced");
    await ctx.goToRound(current + 2n);
    await expectRevert(
      ctx.core.write.settle([[{ roundId: current, work: 0n, dataHash: fakeDataHash(current) }], current + 1n]),
      "InvalidActiveRound",
    );
    await expectRevert(
      ctx.core.write.settle([[{ roundId: current - 1n, work: 5n, dataHash: fakeDataHash(1n) }], current + 1n]),
      "InvalidRoundId",
    );
  });
});
