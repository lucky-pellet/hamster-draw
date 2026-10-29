// Runs only through `npm run test:fork`: forks live Sepolia at its latest block, deploys HamsterDraw next to
// the real SqueekCore and reads real rounds. Needs network access.
import assert from "node:assert/strict";
import hre from "hardhat";
import { createPublicClient, http, zeroHash } from "viem";
import { latestRun } from "../../web/src/lib/contract.js";
import { practiceDraw } from "../../web/src/lib/practice.js";
import { expectRevert, makeEntries } from "../helpers.js";

const CORE = process.env.SQUEEK_CORE || "0x980b4424c007caf7a1f3670b48c8eaef7ebc3d44";
const ROUND_242_DATA_HASH = "0x4c6033f0cb4c8aee682b4ef1b4a4ae4fea671fb9b1cfadb0ccbb6833b5e6ed78";

describe("HamsterDraw against the live SqueekCore (Sepolia fork)", function () {
  let booth;
  let core;
  let publicClient;

  before(async function () {
    // Fork the RPC's latest block (not Hardhat's older default): non-archive RPCs drop state after ~128 blocks.
    const url = hre.config.networks.hardhat.forking?.url;
    assert.ok(url, "run this through `npm run test:fork`");
    const latest = await createPublicClient({ transport: http(url) }).getBlockNumber();
    await hre.network.provider.request({
      method: "hardhat_reset",
      params: [{ forking: { jsonRpcUrl: url, blockNumber: Number(latest) } }],
    });

    publicClient = await hre.viem.getPublicClient();
    assert.equal(await publicClient.getChainId(), 11155111);
    const code = await publicClient.getCode({ address: CORE });
    assert.ok(code && code !== "0x", `no contract at ${CORE}: is the fork pointing at Sepolia?`);
    core = await hre.viem.getContractAt("ISqueekCore", CORE);
    booth = await hre.viem.deployContract("HamsterDraw", [CORE]);
    const block = await publicClient.getBlock();
    console.log(`      forked Sepolia, local head ${block.number} at ${new Date(Number(block.timestamp) * 1000).toISOString()}`);
  });

  it("copies the live configuration (genesis 2026-10-26 13:50 UTC, 600 s rounds)", async function () {
    const cfg = await core.read.configuration();
    assert.equal(cfg.genesisTimestamp, 1793022600n);
    assert.equal(cfg.roundDuration, 600n);
    assert.equal(await booth.read.genesisTimestamp(), cfg.genesisTimestamp);
    assert.equal(await booth.read.roundDuration(), cfg.roundDuration);
  });

  it("agrees with floor((t - genesis) / 600) + 1 for the current round", async function () {
    const block = await publicClient.getBlock();
    const expected = (block.timestamp - 1793022600n) / 600n + 1n;
    const onchain = await booth.read.currentRound({ blockNumber: block.number });
    assert.equal(onchain, expected);
    const state = await core.read.state();
    console.log(`      current round ${onchain}, settled through ${state.settledThroughRound}`);
    assert.ok(state.settledThroughRound <= onchain, "the frontier never runs ahead of the clock");
  });

  it("finds round 242 as the first active round after 241", async function () {
    const [found, roundId, dataHash] = await booth.read.firstActiveRoundAfter([241n]);
    assert.equal(found, true);
    assert.equal(roundId, 242n);
    assert.equal(dataHash, ROUND_242_DATA_HASH);
  });

  it("returns nothing past the settled frontier", async function () {
    const { settledThroughRound } = await core.read.state();
    assert.deepEqual(await booth.read.firstActiveRoundAfter([settledThroughRound]), [false, 0n, zeroHash]);
  });

  it("practice draws find the same latest run as the contract and pick like it on a real dataHash", async function () {
    // The web app's own round finder, reading the forked chain through Hardhat's client.
    const run = await latestRun(CORE, { client: publicClient });
    assert.ok(run, "he has run at least once in the last two weeks");
    console.log(`      latest run: round ${run.roundId}, ${run.work} work, dataHash ${run.dataHash}`);
    assert.deepEqual(await booth.read.firstActiveRoundAfter([run.roundId - 1n]), [true, run.roundId, run.dataHash]);
    assert.deepEqual(await booth.read.firstActiveRoundAfter([run.roundId]), [false, 0n, zeroHash], "nothing active after it");

    const entries = makeEntries(37, "fork");
    const practice = practiceDraw({ entries, winners: 5, dataHash: run.dataHash, chainId: 11155111 });
    const onchain = await booth.read.pickWinners([practice.seed, 5n, 37n]);
    assert.deepEqual(practice.picks, onchain.map(Number));
  });

  it("opens a raffle on the next round and refuses to draw it early", async function () {
    const before = await booth.read.currentRound();
    const hash = await booth.write.create(["Fork check", makeEntries(25, "fork"), 3]);
    await publicClient.waitForTransactionReceipt({ hash });
    const d = await booth.read.getDraw([1n]);
    assert.ok(d.targetRound === before + 1n || d.targetRound === before + 2n, "target is the round after creation");

    const { settledThroughRound } = await core.read.state();
    const [status, settled] = await booth.read.statusOf([1n]);
    assert.equal(status, 0, "WaitingForRound");
    assert.equal(settled, settledThroughRound);
    await expectRevert(booth.write.draw([1n]), "NotSettledYet", [d.targetRound, settledThroughRound]);
  });
});
