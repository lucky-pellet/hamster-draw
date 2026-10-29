// Copies the compiled HamsterDraw ABI + creation bytecode into web/artifact/HamsterDraw.json.
// The web app reads its ABI from that file and deploy.html deploys its bytecode.
// Run through `npm run build` (compiles first).
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = join(root, "artifacts", "contracts", "HamsterDraw.sol");
const outFile = join(root, "web", "artifact", "HamsterDraw.json");

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

const artifact = await readJson(join(artifactDir, "HamsterDraw.json")).catch(() => {
  console.error("No compiled artifact found. Run `npm run build` (it compiles first).");
  process.exit(1);
});
const debug = await readJson(join(artifactDir, "HamsterDraw.dbg.json"));
const buildInfo = await readJson(join(artifactDir, debug.buildInfo));
const settings = buildInfo.input.settings;
const source = buildInfo.input.sources[artifact.sourceName].content;

const out = {
  contractName: artifact.contractName,
  sourceName: artifact.sourceName,
  compiler: {
    version: buildInfo.solcLongVersion,
    optimizer: settings.optimizer,
    evmVersion: settings.evmVersion,
  },
  sourceSha256: createHash("sha256").update(source).digest("hex"),
  deployedBytecodeSize: (artifact.deployedBytecode.length - 2) / 2,
  abi: artifact.abi,
  bytecode: artifact.bytecode,
};

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, JSON.stringify(out, null, 2) + "\n");
console.log(
  `Wrote web/artifact/HamsterDraw.json: ${out.abi.length} ABI items, ` +
    `${out.deployedBytecodeSize} bytes deployed code, solc ${out.compiler.version}`,
);
