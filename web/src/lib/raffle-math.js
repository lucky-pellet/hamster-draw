// The draw rule from HamsterDraw.sol, written out again in JavaScript so anyone can re-check a result
// without trusting this website. The unit tests run this exact file against the contract.
// Runs in the browser (viem via the import map) and in Node (viem from node_modules).
import { encodeAbiParameters, hexToBigInt, keccak256 } from "viem";

/** keccak256(abi.encode(entries)): the hash a raffle seals at creation. */
export function hashEntries(entries) {
  return keccak256(encodeAbiParameters([{ type: "string[]" }], [entries]));
}

/** keccak256(abi.encode(dataHash, id, entriesHash, chainId, contract)). */
export function drawSeed({ dataHash, id, entriesHash, chainId, contract }) {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
      [dataHash, BigInt(id), entriesHash, BigInt(chainId), contract],
    ),
  );
}

/**
 * Winner indices (0-based, in pick order). Pick i takes keccak256(abi.encode(seed, i, attempt)) % entryCount
 * for attempt = 0, 1, 2, ... and keeps the first index nobody has yet.
 */
export function pickWinners(seed, winners, entryCount) {
  const count = Number(winners);
  const total = Number(entryCount);
  if (!(count >= 1 && count < total)) throw new RangeError("Need at least one winner and fewer winners than entries");
  const modulus = BigInt(total);
  const taken = new Set();
  const picks = [];
  for (let i = 0; i < count; i++) {
    for (let attempt = 0n; ; attempt++) {
      const hash = keccak256(
        encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }, { type: "uint256" }], [seed, BigInt(i), attempt]),
      );
      const index = Number(hexToBigInt(hash) % modulus);
      if (!taken.has(index)) {
        taken.add(index);
        picks.push(index);
        break;
      }
    }
  }
  return picks;
}
