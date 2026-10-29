// `npm run test:fork`: the same project, but only the tests in test/fork run, against a fork of live Sepolia.
//
// Public Sepolia RPCs are not archive nodes: they serve state for roughly the last 128 blocks. Left alone,
// Hardhat forks a "reorg-safe" block about that far back, which is right at the edge. So the fork starts
// disabled here and the fork test resets onto the RPC's latest block itself (see test/fork). Never pin an
// old block number.
const base = require("./hardhat.config.cjs");

const forkUrl = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";

module.exports = {
  ...base,
  networks: {
    ...base.networks,
    hardhat: {
      chainId: 11155111,
      forking: { url: forkUrl, enabled: false },
    },
  },
  paths: { ...base.paths, tests: "./test/fork" },
  mocha: { timeout: 300_000 },
};
