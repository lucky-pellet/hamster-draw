// Chain access: one read-only client for the configured RPC, and the visitor's injected wallet for writes.
// No keys ever pass through this code; every transaction is signed in the visitor's own wallet.
import { createPublicClient, createWalletClient, custom, defineChain, http } from "viem";
import config from "../../config.js";
import { FriendlyError } from "./errors.js";

const SEPOLIA = 11155111;

export const chain = defineChain({
  id: config.chainId,
  name: config.chainName,
  nativeCurrency: { name: `${config.chainName} Ether`, symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
  ...(config.explorer ? { blockExplorers: { default: { name: "Etherscan", url: config.explorer } } } : {}),
  ...(config.chainId === SEPOLIA
    ? { contracts: { multicall3: { address: "0xca11bde05977b3631167028862be2a173976ca11", blockCreated: 751532 } } }
    : {}),
  testnet: true,
});

export const publicClient = createPublicClient({
  chain,
  transport: http(config.rpcUrl, { retryCount: 2, timeout: 20_000 }),
});

/** Explorer URL for a tx, address or block, or null on a chain without an explorer (a local node). */
export function explorerUrl(kind, value) {
  if (!config.explorer || value === undefined || value === null) return null;
  const text = String(value);
  const valid = kind === "block" ? /^\d+$/.test(text) : /^0x[0-9a-fA-F]+$/.test(text);
  return valid ? `${config.explorer}/${kind}/${text}` : null;
}

export const hasInjectedWallet = () => typeof window !== "undefined" && Boolean(window.ethereum);

/** Asks the injected wallet for an account and makes sure it is on the configured chain. */
export async function connectWallet() {
  if (!hasInjectedWallet()) {
    throw new FriendlyError(
      "No browser wallet found. Install one, or open this page in your wallet app's browser. " +
        "Watching and verifying raffles works without a wallet.",
    );
  }
  const wallet = createWalletClient({ chain, transport: custom(window.ethereum) });
  const [account] = await wallet.requestAddresses();
  if (!account) throw new FriendlyError("Your wallet did not share an account.");
  await ensureChain(wallet);
  return { wallet, account };
}

async function ensureChain(wallet) {
  if ((await wallet.getChainId()) === chain.id) return;
  try {
    await wallet.switchChain({ id: chain.id });
  } catch (error) {
    const code = error?.code ?? error?.cause?.code;
    const unknownChain = code === 4902 || /unrecognized chain|not been added|unknown chain/i.test(error?.message ?? "");
    if (!unknownChain) throw error;
    await wallet.addChain({ chain });
  }
  if ((await wallet.getChainId()) !== chain.id) {
    throw new FriendlyError(`Switch your wallet to ${chain.name} to continue.`);
  }
}

/** Reads several contract calls at once: Multicall3 where the chain has it, plain parallel calls elsewhere. */
export async function readMany(calls) {
  if (!calls.length) return [];
  if (chain.contracts?.multicall3) {
    return publicClient.multicall({ contracts: calls, allowFailure: true });
  }
  return Promise.all(
    calls.map((call) =>
      publicClient
        .readContract(call)
        .then((result) => ({ status: "success", result }))
        .catch((error) => ({ status: "failure", error })),
    ),
  );
}
