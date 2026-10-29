import assert from "node:assert/strict";
import hre from "hardhat";
import { encodeAbiParameters, keccak256, parseEventLogs, zeroHash } from "viem";
import { drawSeed, hashEntries, pickWinners } from "../../web/src/lib/raffle-math.js";
import { deployBooth, expectRevert, fakeDataHash, makeEntries, ROUND } from "../helpers.js";

const Status = { WaitingForRound: 0, HamsterAsleep: 1, ReadyToDraw: 2, Drawn: 3 };

describe("HamsterDraw", function () {
  describe("deployment and the round clock", function () {
    it("copies genesis and round length from the core's configuration", async function () {
      const { booth, core, genesis } = await deployBooth();
      assert.equal(await booth.read.genesisTimestamp(), genesis);
      assert.equal(await booth.read.roundDuration(), ROUND);
      assert.equal((await booth.read.core()).toLowerCase(), core.address.toLowerCase());
    });

    it("refuses a core whose round duration is zero", async function () {
      const core = await hre.viem.deployContract("MockSqueekCore", [1n, 0n]);
      await expectRevert(hre.viem.deployContract("HamsterDraw", [core.address]), "InvalidRoundDuration");
    });

    it("computes currentRound as floor((t - genesis) / duration) + 1, and 0 before genesis", async function () {
      const publicClient = await hre.viem.getPublicClient();
      const testClient = await hre.viem.getTestClient();
      const now = (await publicClient.getBlock()).timestamp;
      const genesis = now + 1000n;
      const core = await hre.viem.deployContract("MockSqueekCore", [genesis, ROUND]);
      const booth = await hre.viem.deployContract("HamsterDraw", [core.address]);

      const roundAt = async (timestamp) => {
        await testClient.setNextBlockTimestamp({ timestamp });
        await testClient.mine({ blocks: 1 });
        const block = await publicClient.getBlock();
        return booth.read.currentRound({ blockNumber: block.number });
      };

      assert.equal(await booth.read.currentRound(), 0n, "before genesis");
      assert.equal(await roundAt(genesis - 1n), 0n);
      assert.equal(await roundAt(genesis), 1n);
      assert.equal(await roundAt(genesis + ROUND - 1n), 1n);
      assert.equal(await roundAt(genesis + ROUND), 2n);
      assert.equal(await roundAt(genesis + 333n * ROUND + 599n), 334n);
    });
  });

  describe("create", function () {
    it("seals the list, targets the next round and logs every entry", async function () {
      const ctx = await deployBooth();
      const { booth, publicClient, host } = ctx;
      const entries = ["@squeektoshi", "0x980b4424c007caf7a1f3670b48c8eaef7ebc3d44", "Carol from the Discord", "zoë"];

      assert.equal(await booth.read.drawCount(), 0n);
      const roundBefore = await booth.read.currentRound();
      const { id, target, receipt } = await ctx.open(entries, 2, "Seed packets for the wheel crew");
      assert.equal(id, 1n);
      assert.equal(await booth.read.drawCount(), 1n);
      assert.equal(target, roundBefore + 1n);

      const expectedHash = keccak256(encodeAbiParameters([{ type: "string[]" }], [entries]));
      assert.equal(hashEntries(entries), expectedHash, "browser helper matches abi.encode");

      const d = await booth.read.getDraw([id]);
      assert.equal(d.host.toLowerCase(), host.account.address.toLowerCase());
      assert.equal(d.title, "Seed packets for the wheel crew");
      assert.equal(d.winners, 2);
      assert.equal(d.entryCount, 4);
      assert.equal(d.entriesHash, expectedHash);
      assert.equal(d.createdBlock, receipt.blockNumber);
      assert.equal(d.drawnRound, 0n);
      assert.equal(d.seed, zeroHash);

      const [log] = parseEventLogs({ abi: booth.abi, logs: receipt.logs, eventName: "DrawCreated" });
      assert.equal(log.args.id, id);
      assert.deepEqual(log.args.entries, entries);
      assert.equal(log.args.targetRound, target);
      assert.equal(log.args.entriesHash, expectedHash);
      assert.equal(log.args.winners, 2);

      // The raffle can be found again from logs alone, at the block getDraw points to.
      const found = await publicClient.getContractEvents({
        address: booth.address,
        abi: booth.abi,
        eventName: "DrawCreated",
        args: { id },
        fromBlock: d.createdBlock,
        toBlock: d.createdBlock,
      });
      assert.equal(found.length, 1);
      assert.equal(hashEntries(found[0].args.entries), d.entriesHash);

      const second = await ctx.open(["a", "b"], 1);
      assert.equal(second.id, 2n);
    });

    it("checks the title length in bytes", async function () {
      const { booth } = await deployBooth();
      const entries = ["a", "b"];
      await expectRevert(booth.write.create(["", entries, 1]), "InvalidTitleLength", [0n]);
      await expectRevert(booth.write.create(["x".repeat(81), entries, 1]), "InvalidTitleLength", [81n]);
      await expectRevert(booth.write.create(["ü".repeat(41), entries, 1]), "InvalidTitleLength", [82n]);
      await booth.write.create(["ü".repeat(40), entries, 1]); // 80 bytes exactly
      await booth.write.create(["x", entries, 1]);
    });

    it("needs 2 to 1000 entries", async function () {
      const { booth } = await deployBooth();
      await expectRevert(booth.write.create(["t", [], 1]), "InvalidEntryCount", [0n]);
      await expectRevert(booth.write.create(["t", ["solo"], 1]), "InvalidEntryCount", [1n]);
      await expectRevert(booth.write.create(["t", makeEntries(1001), 1]), "InvalidEntryCount", [1001n]);
      const hash = await booth.write.create(["Full house", makeEntries(1000), 50]);
      const receipt = await (await hre.viem.getPublicClient()).waitForTransactionReceipt({ hash });
      assert.equal(receipt.status, "success");
      console.log(`      1000-entry create used ${receipt.gasUsed} gas`);
    });

    it("needs every entry to be 1 to 64 bytes", async function () {
      const { booth } = await deployBooth();
      await expectRevert(booth.write.create(["t", ["a", "b", "c", ""], 1]), "InvalidEntryLength", [3n, 0n]);
      await expectRevert(booth.write.create(["t", ["a", "y".repeat(65)], 1]), "InvalidEntryLength", [1n, 65n]);
      await expectRevert(booth.write.create(["t", ["é".repeat(33), "b"], 1]), "InvalidEntryLength", [0n, 66n]);
      await booth.write.create(["t", ["y".repeat(64), "é".repeat(32)], 1]);
    });

    it("needs 1 <= winners < entries and winners <= 50", async function () {
      const { booth } = await deployBooth();
      await expectRevert(booth.write.create(["t", ["a", "b", "c"], 0]), "InvalidWinnerCount", [0n, 3n]);
      await expectRevert(booth.write.create(["t", ["a", "b", "c"], 3]), "InvalidWinnerCount", [3n, 3n]);
      await expectRevert(booth.write.create(["t", makeEntries(100), 51]), "InvalidWinnerCount", [51n, 100n]);
      await booth.write.create(["t", makeEntries(51), 50]);
      await booth.write.create(["t", ["a", "b", "c"], 2]);
    });
  });

  describe("draw", function () {
    it("refuses to draw before the target round is settled", async function () {
      const ctx = await deployBooth();
      const { id, target } = await ctx.open(makeEntries(10), 3);

      await expectRevert(ctx.booth.write.draw([id]), "NotSettledYet", [target, 0n]);

      // Active rounds before the target are settled: still not enough.
      await ctx.settle(target - 1n, [[target - 2n, 410n], [target - 1n, 512n]]);
      await expectRevert(ctx.booth.write.draw([id]), "NotSettledYet", [target, target - 1n]);
      const [status, settled] = await ctx.booth.read.statusOf([id]);
      assert.equal(status, Status.WaitingForRound);
      assert.equal(settled, target - 1n);
    });

    it("refuses to draw while only zero-work rounds have settled since the target", async function () {
      const ctx = await deployBooth();
      const { id, target } = await ctx.open(makeEntries(10), 3);

      // He ran right before the raffle's target, then slept through it and two more rounds.
      await ctx.settle(target - 1n, [[target - 1n, 699n]]);
      await ctx.settle(target + 2n, []);
      await expectRevert(ctx.booth.write.draw([id]), "HamsterStillAsleep", [target, target + 2n]);

      const [status, settled, roundId, dataHash] = await ctx.booth.read.statusOf([id]);
      assert.equal(status, Status.HamsterAsleep);
      assert.equal(settled, target + 2n);
      assert.equal(roundId, 0n);
      assert.equal(dataHash, zeroHash);
    });

    it("uses the first active round at or after the target, even when more follow", async function () {
      const ctx = await deployBooth();
      const { booth, publicClient, guest, chainId } = ctx;
      const entries = makeEntries(40);
      const { id, target } = await ctx.open(entries, 5);

      // One settlement: active before the target (ignored), asleep at target and target+1,
      // active at target+2 (the decider) and target+3.
      await ctx.settle(target + 3n, [[target - 1n, 300n], [target + 2n, 536n], [target + 3n, 621n]]);

      const [status, , candidate, candidateHash] = await booth.read.statusOf([id]);
      assert.equal(status, Status.ReadyToDraw);
      assert.equal(candidate, target + 2n);
      assert.equal(candidateHash, fakeDataHash(target + 2n));

      // Anyone can draw: a guest pays the gas here.
      const hash = await booth.write.draw([id], { account: guest.account });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const [log] = parseEventLogs({ abi: booth.abi, logs: receipt.logs, eventName: "Drawn" });

      const d = await booth.read.getDraw([id]);
      const expectedSeed = drawSeed({
        dataHash: fakeDataHash(target + 2n),
        id,
        entriesHash: d.entriesHash,
        chainId,
        contract: booth.address,
      });
      assert.equal(d.drawnRound, target + 2n);
      assert.equal(d.drawnBlock, receipt.blockNumber);
      assert.equal(d.dataHash, fakeDataHash(target + 2n));
      assert.equal(d.seed, expectedSeed);
      assert.deepEqual(
        [log.args.id, log.args.roundId, log.args.dataHash, log.args.seed],
        [id, target + 2n, fakeDataHash(target + 2n), expectedSeed],
      );

      const [after] = await booth.read.statusOf([id]);
      assert.equal(after, Status.Drawn);
    });

    it("uses the target round itself when the hamster runs in it", async function () {
      const ctx = await deployBooth();
      const { id, target } = await ctx.open(makeEntries(8), 2);
      await ctx.settle(target, [[target, 88n]]);
      await ctx.booth.write.draw([id]);
      assert.equal((await ctx.booth.read.getDraw([id])).drawnRound, target);
    });

    it("waits through a sleep, then draws from the run that ends it", async function () {
      const ctx = await deployBooth();
      const { booth } = ctx;
      const { id, target } = await ctx.open(makeEntries(12), 3);

      assert.equal((await booth.read.statusOf([id]))[0], Status.WaitingForRound);
      await ctx.settle(target + 1n, []);
      assert.equal((await booth.read.statusOf([id]))[0], Status.HamsterAsleep);
      await ctx.settle(target + 5n, [[target + 4n, 97n]]);
      assert.equal((await booth.read.statusOf([id]))[0], Status.ReadyToDraw);
      await booth.write.draw([id]);
      assert.equal((await booth.read.statusOf([id]))[0], Status.Drawn);
      assert.equal((await booth.read.getDraw([id])).drawnRound, target + 4n);
    });

    it("gives the same result no matter who draws or how much later", async function () {
      // Two identical booths on one core: one drawn at once, one drawn after more settlements.
      const ctx = await deployBooth();
      const twin = await hre.viem.deployContract("HamsterDraw", [ctx.core.address]);
      const entries = makeEntries(30);

      const { id, target } = await ctx.open(entries, 4);
      await twin.write.create(["Wheel-side giveaway", entries, 4]);
      assert.equal((await twin.read.getDraw([id])).targetRound, target);

      await ctx.settle(target + 1n, [[target + 1n, 640n]]);
      await ctx.booth.write.draw([id], { account: ctx.guest.account });
      await ctx.settle(target + 9n, [[target + 3n, 222n], [target + 7n, 515n]]);
      await twin.write.draw([id], { account: ctx.stranger.account });

      const a = await ctx.booth.read.getDraw([id]);
      const b = await twin.read.getDraw([id]);
      assert.equal(a.drawnRound, b.drawnRound);
      assert.equal(a.dataHash, b.dataHash);
      // Seeds differ only because the contract address is part of the seed.
      const seedFor = (contract) =>
        drawSeed({ dataHash: a.dataHash, id, entriesHash: a.entriesHash, chainId: ctx.chainId, contract });
      assert.equal(a.seed, seedFor(ctx.booth.address));
      assert.equal(b.seed, seedFor(twin.address));
    });

    it("cannot be drawn twice", async function () {
      const ctx = await deployBooth();
      const { id, target } = await ctx.open(makeEntries(5), 1);
      await ctx.settle(target, [[target, 500n]]);
      await ctx.booth.write.draw([id]);
      await expectRevert(ctx.booth.write.draw([id]), "AlreadyDrawn", [id, target]);
      await ctx.settle(target + 3n, [[target + 2n, 512n]]);
      await expectRevert(ctx.booth.write.draw([id]), "AlreadyDrawn", [id, target]);
    });

    it("rejects unknown ids everywhere and has no winners before the draw", async function () {
      const ctx = await deployBooth();
      const { booth } = ctx;
      await expectRevert(booth.write.draw([0n]), "UnknownDraw", [0n]);
      await expectRevert(booth.write.draw([1n]), "UnknownDraw", [1n]);
      await expectRevert(booth.read.getDraw([1n]), "UnknownDraw", [1n]);
      await expectRevert(booth.read.statusOf([7n]), "UnknownDraw", [7n]);
      await expectRevert(booth.read.winnersOf([7n]), "UnknownDraw", [7n]);
      const { id } = await ctx.open(["a", "b"], 1);
      await expectRevert(booth.read.winnersOf([id]), "NotDrawnYet", [id]);
    });
  });

  describe("winners", function () {
    const cases = [
      { entries: 2, winners: 1 },
      { entries: 3, winners: 2 },
      { entries: 51, winners: 50 },
      { entries: 257, winners: 7 },
      { entries: 1000, winners: 50 },
    ];

    for (const c of cases) {
      it(`are distinct, in range and reproducible: ${c.winners} of ${c.entries}`, async function () {
        const ctx = await deployBooth();
        const { booth } = ctx;
        const { id, target } = await ctx.open(makeEntries(c.entries), c.winners);
        await ctx.settle(target, [[target, 300n + BigInt(c.entries)]], `case-${c.entries}`);
        await booth.write.draw([id]);
        const d = await booth.read.getDraw([id]);

        const onchain = (await booth.read.winnersOf([id])).map(Number);
        assert.equal(onchain.length, c.winners);
        assert.equal(new Set(onchain).size, c.winners, "no repeats");
        assert.ok(onchain.every((i) => Number.isInteger(i) && i >= 0 && i < c.entries), "in range");

        // Same answer from the browser helper, the pure view, and a later call.
        assert.deepEqual(pickWinners(d.seed, c.winners, c.entries), onchain);
        assert.deepEqual((await booth.read.pickWinners([d.seed, BigInt(c.winners), BigInt(c.entries)])).map(Number), onchain);
        await ctx.settle(target + 4n, [[target + 2n, 444n]]);
        assert.deepEqual((await booth.read.winnersOf([id])).map(Number), onchain);
      });
    }

    it("spread over the whole list", async function () {
      // 200 seeds, 1 winner of 4: every index should come up, roughly evenly.
      const counts = [0, 0, 0, 0];
      for (let i = 0; i < 200; i++) {
        const [pick] = pickWinners(fakeDataHash(i, "spread"), 1, 4);
        counts[pick] += 1;
      }
      assert.ok(counts.every((n) => n > 25), `uneven picks: ${counts}`);
    });

    it("pickWinners rejects impossible requests instead of looping", async function () {
      const { booth } = await deployBooth();
      const seed = fakeDataHash(1);
      await expectRevert(booth.read.pickWinners([seed, 0n, 5n]), "InvalidWinnerCount", [0n, 5n]);
      await expectRevert(booth.read.pickWinners([seed, 5n, 5n]), "InvalidWinnerCount", [5n, 5n]);
      await expectRevert(booth.read.pickWinners([seed, 51n, 500n]), "InvalidWinnerCount", [51n, 500n]);
      await expectRevert(booth.read.pickWinners([seed, 1n, 1001n]), "InvalidWinnerCount", [1n, 1001n]);
      assert.throws(() => pickWinners(seed, 5, 5), RangeError);
    });
  });

  describe("firstActiveRoundAfter", function () {
    it("finds the next run within the settled frontier only", async function () {
      const ctx = await deployBooth();
      const { booth } = ctx;
      assert.deepEqual(await booth.read.firstActiveRoundAfter([0n]), [false, 0n, zeroHash]);

      await ctx.settle(9n, [[3n, 120n], [4n, 520n], [8n, 61n]]);
      assert.deepEqual(await booth.read.firstActiveRoundAfter([0n]), [true, 3n, fakeDataHash(3n)]);
      assert.deepEqual(await booth.read.firstActiveRoundAfter([3n]), [true, 4n, fakeDataHash(4n)]);
      assert.deepEqual(await booth.read.firstActiveRoundAfter([4n]), [true, 8n, fakeDataHash(8n)]);
      assert.deepEqual(await booth.read.firstActiveRoundAfter([8n]), [false, 0n, zeroHash]);
      assert.deepEqual(await booth.read.firstActiveRoundAfter([9n]), [false, 0n, zeroHash]);
      assert.deepEqual(await booth.read.firstActiveRoundAfter([500n]), [false, 0n, zeroHash]);
    });
  });
});
