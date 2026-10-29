// Hardhat 2 reads its config as CommonJS; the rest of the repo is ES modules.
require("@nomicfoundation/hardhat-viem");

/** @type {import("hardhat/config").HardhatUserConfig} */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test/unit",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    // `npm run demo:chain` starts this on 8545; set LOCAL_RPC_URL to use another port.
    localhost: { url: process.env.LOCAL_RPC_URL || "http://127.0.0.1:8545" },
  },
  mocha: { timeout: 120_000 },
};
