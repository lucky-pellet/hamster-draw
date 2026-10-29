// Turns wallet, RPC and contract errors into sentences a person can act on.

/** An error whose message is already written for people. */
export class FriendlyError extends Error {}

const n = (value) => (typeof value === "bigint" ? value.toString() : String(value));

const CONTRACT_ERRORS = {
  NotSettledYet: ([target, settled]) =>
    `Round ${n(target)} is not settled yet (the ledger is at round ${n(settled)}). ` +
    "Settlements land about every ten minutes; try again after the next one.",
  HamsterStillAsleep: ([target, settled]) =>
    `Squeektoshi has not run since round ${n(target)} (settled through ${n(settled)}). ` +
    "The draw opens after his next run.",
  AlreadyDrawn: ([id, round]) => `Raffle No. ${n(id)} was already drawn from round ${n(round)}. Refresh to see the winners.`,
  UnknownDraw: ([id]) => `There is no raffle No. ${n(id)} on this contract.`,
  NotDrawnYet: ([id]) => `Raffle No. ${n(id)} has not been drawn yet.`,
  InvalidTitleLength: ([length]) => `Titles need 1 to 80 bytes; this one has ${n(length)}.`,
  InvalidEntryCount: ([count]) => `A raffle needs 2 to 1000 entries; this one has ${n(count)}.`,
  InvalidEntryLength: ([index, length]) =>
    `Entry ${Number(index) + 1} is ${n(length)} bytes long; the limit is 64.`,
  InvalidWinnerCount: ([winners, entries]) =>
    `${n(winners)} winners from ${n(entries)} entries will not work: at least 1, fewer than the entries, at most 50.`,
  InvalidRoundDuration: () => "That core reports a round length of zero, so it cannot run raffles.",
};

const find = (error, name) => (typeof error?.walk === "function" ? error.walk((e) => e?.name === name) : null);

/** A readable sentence for any error thrown by viem, a wallet or this app. */
export function explain(error) {
  if (!error) return "Something went wrong.";
  if (error instanceof FriendlyError) return error.message;

  const message = String(error.message ?? "");
  if (find(error, "UserRejectedRequestError") || error.code === 4001 || /user (rejected|denied)/i.test(message)) {
    return "You cancelled in your wallet. Nothing was sent.";
  }
  const reverted = find(error, "ContractFunctionRevertedError");
  const name = reverted?.data?.errorName;
  if (name && CONTRACT_ERRORS[name]) return CONTRACT_ERRORS[name](reverted.data.args ?? []);
  if (find(error, "InsufficientFundsError") || /insufficient funds/i.test(message)) {
    return "Not enough Sepolia ETH for gas. Any Sepolia faucet will top you up; it is test money.";
  }
  if (find(error, "ChainMismatchError")) return "Your wallet is on another network. Switch it to Sepolia and try again.";
  if (find(error, "HttpRequestError") || /failed to fetch|network/i.test(message)) {
    return "Could not reach the Sepolia RPC. Check your connection, or set another rpcUrl in config.js.";
  }
  return error.shortMessage || message || String(error);
}
