import assert from "node:assert/strict";
import hre from "hardhat";
import { decodeErrorResult, keccak256, toHex } from "viem";

export const ROUND = 600n;

// Every custom error the project's contracts can raise, for decoding raw revert data.
const errorAbi = ["HamsterDraw", "MockSqueekCore"].flatMap((name) =>
  hre.artifacts.readArtifactSync(name).abi.filter((item) => item.type === "error"),
);

/** The raw revert bytes somewhere down an error's cause chain (Hardhat reports them as `data`). */
function revertData(error) {
  for (let e = error; e; e = e.cause) {
    if (typeof e.data === "string" && /^0x[0-9a-f]{8}/i.test(e.data)) return e.data;
    if (typeof e.data?.data === "string" && /^0x[0-9a-f]{8}/i.test(e.data.data)) return e.data.data;
  }
  return null;
}

/** Awaits a contract call that must revert with custom error `errorName` (and `args`, when given). */
export async function expectRevert(promise, errorName, args) {
  let error;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, `expected a ${errorName} revert, but the call went through`);

  const decoded = error.walk?.((e) => e?.name === "ContractFunctionRevertedError")?.data
    ?? (() => {
      const data = revertData(error);
      try {
        return data ? decodeErrorResult({ abi: errorAbi, data }) : null;
      } catch {
        return null;
      }
    })();

  if (decoded?.errorName) {
    assert.equal(decoded.errorName, errorName, `wrong error: ${decoded.errorName}(${decoded.args ?? ""})`);
    if (args) assert.deepEqual([...(decoded.args ?? [])], args);
    return;
  }
  // Last resort (e.g. a constructor revert with no data attached): Hardhat names the error in the message.
  assert.ok(!args, `cannot check ${errorName} arguments: no revert data in ${error.shortMessage}`);
  const text = [error.shortMessage, error.details, error.message].filter(Boolean).join("\n");
  assert.match(text, new RegExp(`\\b${errorName}\\b`), `expected ${errorName}, got: ${error.shortMessage}`);
}

/** A fake dataHash for round `round`, like the ones the Reporter signs. */
export const fakeDataHash = (round, salt = "wheel") => keccak256(toHex(`${salt}:${round}`));

/** Fresh mock core + HamsterDraw. Genesis is set so the chain sits a little way into round 11. */
export async function deployBooth({ duration = ROUND } = {}) {
  const publicClient = await hre.viem.getPublicClient();
  const testClient = await hre.viem.getTestClient();
  const [host, guest, stranger] = await hre.viem.getWalletClients();
  const now = (await publicClient.getBlock()).timestamp;
  const genesis = now - 10n * duration - 5n;
  const core = await hre.viem.deployContract("MockSqueekCore", [genesis, duration]);
  const booth = await hre.viem.deployContract("HamsterDraw", [core.address]);
  const chainId = BigInt(await publicClient.getChainId());

  const ctx = { publicClient, testClient, host, guest, stranger, core, booth, genesis, duration, chainId };

  /** Moves the chain clock to `offset` seconds into `round` and mines a block there. */
  ctx.goToRound = async (round, offset = 1n) => {
    const target = genesis + (BigInt(round) - 1n) * duration + offset;
    const latest = (await publicClient.getBlock()).timestamp;
    assert.ok(target > latest, `cannot travel back to round ${round}`);
    await testClient.setNextBlockTimestamp({ timestamp: target });
    await testClient.mine({ blocks: 1 });
  };

  /** Settles through `through`, listing `active` as [round, work] pairs; everything else is zero work. */
  ctx.settle = async (through, active = [], salt) => {
    const current = await booth.read.currentRound();
    if (current <= BigInt(through)) await ctx.goToRound(BigInt(through) + 1n);
    const rounds = active.map(([roundId, work]) => ({
      roundId: BigInt(roundId),
      work: BigInt(work),
      dataHash: fakeDataHash(roundId, salt),
    }));
    await core.write.settle([rounds, BigInt(through)]);
  };

  /** Opens a raffle and returns its id and target round. */
  ctx.open = async (entries, winners = 1, title = "Wheel-side giveaway", account = host) => {
    const { result: id } = await publicClient.simulateContract({
      address: booth.address,
      abi: booth.abi,
      functionName: "create",
      args: [title, entries, winners],
      account: account.account,
    });
    const hash = await booth.write.create([title, entries, winners], { account: account.account });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const draw = await booth.read.getDraw([id]);
    return { id, target: draw.targetRound, receipt };
  };

  return ctx;
}

/** `count` distinct short entries like "guest-0007". */
export const makeEntries = (count, prefix = "guest") =>
  Array.from({ length: count }, (_, i) => `${prefix}-${String(i).padStart(4, "0")}`);
