// A whole booth on your machine, for trying the UI without Sepolia ETH.
//
//   terminal 1:  npm run demo:chain                      (Hardhat node on 8545)
//   terminal 2:  npm run demo:seed                       (this script; keeps running)
//   terminal 3:  npm run serve -- --config .local/config.js
//
// It deploys MockSqueekCore with short rounds (DEMO_ROUND_SECONDS, default 30) and a HamsterDraw on top,
// opens raffles in every state (drawn, ready, asleep, waiting), writes .local/config.js for the web app,
// then keeps a pretend hamster on the wheel: every finished round is settled, active about half the time.
// Set DEMO_WHEEL=0 to stop after seeding. Nothing here touches a public network.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import hre from "hardhat";
import { keccak256, toHex } from "viem";

const ROUND = BigInt(process.env.DEMO_ROUND_SECONDS || 30);
const KEEP_WHEELING = process.env.DEMO_WHEEL !== "0";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

if (hre.network.name === "hardhat") {
  console.error("Run this against a node: start `npm run demo:chain`, then `npm run demo:seed`.");
  process.exit(1);
}

const publicClient = await hre.viem.getPublicClient();
const [host, guest] = await hre.viem.getWalletClients();
const chainId = await publicClient.getChainId();
if (chainId === 11155111 || chainId === 1) {
  console.error(`Refusing to run the demo on chain ${chainId}. It is for a local node only.`);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chainNow = async () => (await publicClient.getBlock()).timestamp;
const dataHash = (round) => keccak256(toHex(`demo wheel round ${round} ${Date.now()}`));

// Genesis a few rounds back, so round numbers start small but non-trivial.
const genesis = (await chainNow()) - 40n * ROUND - 3n;
const core = await hre.viem.deployContract("MockSqueekCore", [genesis, ROUND]);
const booth = await hre.viem.deployContract("HamsterDraw", [core.address]);
const deployBlock = await publicClient.getBlockNumber();
console.log(`MockSqueekCore ${core.address}`);
console.log(`HamsterDraw    ${booth.address} (block ${deployBlock}), ${ROUND}s rounds`);

const configFile = join(root, ".local", "config.js");
await mkdir(dirname(configFile), { recursive: true });
await writeFile(
  configFile,
  `// Written by scripts/local-demo.js for a local Hardhat node. Not for deployment.
export default {
  drawAddress: "${booth.address}",
  deployBlock: ${deployBlock},
  chainId: ${chainId},
  chainName: "Local Hardhat",
  rpcUrl: "${hre.network.config.url}",
  explorer: "",
  api: "https://api.squeekchain.com/v1",
  fallback: { core: "0x980b4424c007caf7a1f3670b48c8eaef7ebc3d44", genesisTimestamp: 1793022600, roundDuration: 600 },
  logChunk: 50000,
};
`,
);
console.log(`Wrote ${configFile}`);

const roundNow = async () => (await booth.read.currentRound());
let settled = 0n;

/** Waits until `round` has ended on the chain clock (mining empty blocks so the node's clock moves). */
async function waitForEnd(round) {
  const end = genesis + round * ROUND;
  for (;;) {
    const now = await chainNow();
    if (now >= end) return;
    await sleep(Math.min(5000, Number(end - now) * 1000 + 300));
    await hre.network.provider.request({ method: "evm_mine", params: [] });
  }
}

/** Settles everything up to `through`; `active` is a list of [round, work]. */
async function settle(through, active = []) {
  await waitForEnd(through);
  const rounds = active.map(([roundId, work]) => ({ roundId, work, dataHash: dataHash(roundId) }));
  await publicClient.waitForTransactionReceipt({ hash: await core.write.settle([rounds, through]) });
  settled = through;
  console.log(`  settled through ${through}${active.length ? `, active: ${active.map(([r, w]) => `${r} (${w})`).join(", ")}` : ", all asleep"}`);
}

async function open(title, entries, winners) {
  const hash = await booth.write.create([title, entries, winners], { account: host.account });
  await publicClient.waitForTransactionReceipt({ hash });
  const id = await booth.read.drawCount();
  const d = await booth.read.getDraw([id]);
  console.log(`  opened No. ${id} "${title}" -> target round ${d.targetRound}`);
  return { id, target: d.targetRound };
}

const crowd = [
  "@squeektoshi_fan", "Carol from the Discord", "0x5501e1fa81be1c3f49225fa7668da0245d07db60", "@wheel_enjoyer",
  "postal_worker_LA", "Dmitri", "seed_hoarder", "@nocturnal_miner", "Ana Lucía", "rpm_watcher",
  "@sunflower_dao", "Priya", "Tomasz", "cheek_pouch_capital", "@burrow_builder", "Kenji", "Mo", "Zoë",
];

console.log("Seeding raffles (a few rounds of real waiting)...");
const a = await open("Three wheel-side seats for Friday's stream", crowd, 3);
const b = await open("Sunflower seed giveaway", crowd.slice(0, 12), 2);
await settle(a.target, [[a.target, 536n]]);
await publicClient.waitForTransactionReceipt({ hash: await booth.write.draw([a.id], { account: guest.account }) });
console.log(`  drew No. ${a.id}; No. ${b.id} is ready to draw`);

const c = await open("Night shift lottery", crowd.slice(4, 16), 1);
await settle(c.target + 1n, []);
console.log(`  No. ${c.id} is waiting on a sleeping hamster`);

const d = await open("Tomorrow's tiny prize", crowd.slice(0, 6), 1);
console.log(`  No. ${d.id} is waiting for round ${d.target}`);
console.log("\nServe the app with:  npm run serve -- --config .local/config.js\n");

if (!KEEP_WHEELING) process.exit(0);

console.log("Wheel running: each finished round settles, active about half the time. Ctrl+C to stop.");
for (;;) {
  const current = await roundNow();
  const through = current - 1n;
  if (through > settled) {
    const active = [];
    for (let r = settled + 1n; r <= through; r++) {
      if (Math.random() < 0.5) active.push([r, BigInt(80 + Math.floor(Math.random() * 600))]);
    }
    await settle(through, active.slice(-16));
  }
  await sleep(Number(ROUND) * 250);
  await hre.network.provider.request({ method: "evm_mine", params: [] });
}
