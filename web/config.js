// Hamster Draw settings. Deploy the contract from deploy.html, then paste its address and block here.
export default {
  // HamsterDraw on Sepolia. Leave empty until it is deployed: the app then shows a "booth closed" sign.
  drawAddress: "",
  // The block the contract was deployed in. Recent raffles are read from logs starting at this block.
  deployBlock: 0,

  chainId: 11155111,
  chainName: "Sepolia",
  // Any Sepolia JSON-RPC that allows CORS. Swap it if this one rate-limits you.
  rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
  explorer: "https://sepolia.etherscan.io",
  api: "https://api.squeekchain.com/v1",

  // Used only when the Squeekchain API is unreachable.
  fallback: {
    core: "0x980b4424c007caf7a1f3670b48c8eaef7ebc3d44",
    genesisTimestamp: 1793022600,
    roundDuration: 600,
  },

  // Blocks per eth_getLogs request when reading raffles from logs.
  logChunk: 50000,
};
