// Reads from the HamsterDraw contract (ABI from the build artifact) and from SqueekCore itself.
import { getAddress, isAddress, parseAbi } from "viem";
import config from "../../config.js";
import { publicClient, readMany } from "./chain.js";

/** The configured HamsterDraw address, checksummed, or null when it is not deployed yet. */
export const boothAddress = isAddress(config.drawAddress ?? "", { strict: false }) ? getAddress(config.drawAddress) : null;

/** statusOf() enum, in contract order. */
export const STATUS = ["waiting", "asleep", "ready", "drawn"];

let artifactPromise = null;
/** ABI + creation bytecode written by `npm run build`. */
export function loadArtifact() {
  artifactPromise ??= fetch(new URL("../../artifact/HamsterDraw.json", import.meta.url)).then((response) => {
    if (!response.ok) throw new Error(`Could not load the contract artifact (HTTP ${response.status}).`);
    return response.json();
  });
  return artifactPromise;
}

async function booth() {
  const { abi } = await loadArtifact();
  return { address: boothAddress, abi };
}

let infoPromise = null;
/** Facts that never change for a deployment, plus the current raffle count. */
export function readBoothInfo() {
  infoPromise ??= (async () => {
    const b = await booth();
    const code = await publicClient.getCode({ address: b.address });
    if (!code || code === "0x") return { live: false };
    const [core, genesis, duration] = await Promise.all([
      publicClient.readContract({ ...b, functionName: "core" }),
      publicClient.readContract({ ...b, functionName: "genesisTimestamp" }),
      publicClient.readContract({ ...b, functionName: "roundDuration" }),
    ]);
    return { live: true, core, genesisTimestamp: Number(genesis), roundDuration: Number(duration) };
  })();
  infoPromise.catch(() => {
    infoPromise = null;
  });
  return infoPromise;
}

export async function readRaffleStatus(id) {
  const b = await booth();
  const [code, settledThroughRound, roundId, dataHash] = await publicClient.readContract({
    ...b,
    functionName: "statusOf",
    args: [id],
  });
  return { status: STATUS[code], settledThroughRound, roundId, dataHash };
}

/** Everything the raffle page shows: the stored record, its live status, the logged entries and the winners. */
export async function readRaffle(id) {
  const b = await booth();
  const draw = await publicClient.readContract({ ...b, functionName: "getDraw", args: [id] });
  const drawn = draw.drawnRound > 0n;
  const [status, createdLogs, drawnLogs, winners] = await Promise.all([
    readRaffleStatus(id),
    publicClient.getContractEvents({
      ...b,
      eventName: "DrawCreated",
      args: { id },
      fromBlock: draw.createdBlock,
      toBlock: draw.createdBlock,
    }),
    drawn
      ? publicClient.getContractEvents({
          ...b,
          eventName: "Drawn",
          args: { id },
          fromBlock: draw.drawnBlock,
          toBlock: draw.drawnBlock,
        })
      : [],
    drawn ? publicClient.readContract({ ...b, functionName: "winnersOf", args: [id] }) : null,
  ]);
  const created = createdLogs[0] ?? null;
  return {
    id,
    draw,
    status,
    entries: created ? [...created.args.entries] : null,
    createdTx: created?.transactionHash ?? null,
    drawnTx: drawnLogs[0]?.transactionHash ?? null,
    winners: winners ? winners.map(Number) : null,
  };
}

/**
 * Raffles from DrawCreated logs, newest first, walking back from the head in `logChunk` windows
 * down to the deploy block. Optionally only one host's raffles.
 */
export async function readRaffleLogs({ limit = 12, host } = {}) {
  const b = await booth();
  const latest = await publicClient.getBlockNumber();
  const chunk = BigInt(config.logChunk || 50000);
  const deployBlock = BigInt(config.deployBlock || 0);
  const floor = deployBlock > 0n ? deployBlock : latest > chunk ? latest - chunk : 0n;

  const found = [];
  let to = latest;
  while (to >= floor && found.length < limit) {
    const from = to - chunk + 1n > floor ? to - chunk + 1n : floor;
    const logs = await publicClient.getContractEvents({
      ...b,
      eventName: "DrawCreated",
      ...(host ? { args: { host } } : {}),
      fromBlock: from,
      toBlock: to,
    });
    found.push(...logs.reverse());
    if (from === floor) break;
    to = from - 1n;
  }

  return found.slice(0, limit).map((log) => ({
    id: log.args.id,
    host: log.args.host,
    title: log.args.title,
    entryCount: log.args.entries.length,
    winners: Number(log.args.winners),
    targetRound: log.args.targetRound,
    entriesHash: log.args.entriesHash,
    blockNumber: log.blockNumber,
    tx: log.transactionHash,
  }));
}

/** The recent list: logs plus each raffle's live status in one batched read. */
export async function readRecent(limit = 12) {
  const b = await booth();
  const raffles = await readRaffleLogs({ limit });
  const statuses = await readMany(raffles.map((r) => ({ ...b, functionName: "statusOf", args: [r.id] })));
  return raffles.map((r, i) => ({
    ...r,
    status: statuses[i]?.status === "success" ? STATUS[statuses[i].result[0]] : null,
    deciderRound: statuses[i]?.status === "success" ? statuses[i].result[2] : 0n,
  }));
}

// --- SqueekCore, read directly so the proof does not rely on HamsterDraw's own say-so -----------------

const CORE_ABI = parseAbi([
  "function state() view returns ((uint64 settledThroughRound, uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint64 blockHeight, uint96 blockProgress, uint32 workPerThousandBlocks, uint256 authorizationNonce, bool paused))",
  "function roundPage(uint64 afterRound, uint64 throughRound, uint256 maxRecords) view returns ((uint64 certifiedThroughRound, (uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint32 workPerThousandBlocks) start, (uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint32 workPerThousandBlocks) end, (uint64 roundId, uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint32 workPerThousandBlocks, bytes32 dataHash)[] rounds))",
  "function configuration() view returns ((bytes32 streamId, uint64 genesisTimestamp, uint64 roundDuration, uint64 maxWorkPerRound, uint16 maxRoundsPerBatch, address guardian, address reporter, uint32 initialWorkPerThousandBlocks, uint64 targetBlocksPerActiveRound, uint64 difficultySmoothingRounds, uint96 blockUnitsPerBlock))",
]);

export const readCoreState = (core) => publicClient.readContract({ address: core, abi: CORE_ABI, functionName: "state" });

export const readCoreConfiguration = (core) =>
  publicClient.readContract({ address: core, abi: CORE_ABI, functionName: "configuration" });

/**
 * The first active round in [fromRound, throughRound] straight from SqueekCore, with its work
 * (cumulative work minus the page's start position). Null when he never ran in that span.
 */
export async function firstRunFrom(core, fromRound, throughRound) {
  const page = await publicClient.readContract({
    address: core,
    abi: CORE_ABI,
    functionName: "roundPage",
    args: [BigInt(fromRound) - 1n, BigInt(throughRound), 1n],
  });
  const first = page.rounds[0];
  if (!first) return null;
  return { roundId: first.roundId, dataHash: first.dataHash, work: first.cumulativeWork - page.start.cumulativeWork };
}

const DAY_OF_ROUNDS = 144n; // 24 h of 10-minute rounds

/**
 * The newest settled round in which he ran, for practice draws. Walks back from the certified frontier a day
 * at a time; inside a day, roundPage lists active rounds oldest first, 16 per page, so it pages forward and
 * keeps the last one. Null when he has not run for `days` days. `client` is any viem public client (the fork
 * test passes its own).
 */
export async function latestRun(core, { client = publicClient, days = 14 } = {}) {
  const read = (functionName, args) => client.readContract({ address: core, abi: CORE_ABI, functionName, args });
  const { settledThroughRound } = await read("state");
  let through = settledThroughRound;
  for (let day = 0; day < days && through > 0n; day++) {
    const floor = through > DAY_OF_ROUNDS ? through - DAY_OF_ROUNDS : 0n;
    let after = floor;
    let last = null;
    for (;;) {
      const page = await read("roundPage", [after, through, 16n]);
      const count = page.rounds.length;
      if (count) {
        const round = page.rounds[count - 1];
        const before = count > 1 ? page.rounds[count - 2].cumulativeWork : page.start.cumulativeWork;
        last = { roundId: round.roundId, dataHash: round.dataHash, work: round.cumulativeWork - before };
      }
      if (page.certifiedThroughRound >= through || page.certifiedThroughRound <= after) break;
      after = page.certifiedThroughRound;
    }
    if (last) return { ...last, settledThroughRound };
    through = floor;
  }
  return null;
}
