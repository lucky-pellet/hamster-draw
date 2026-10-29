// deploy.html: deploys the HamsterDraw artifact from the visitor's own wallet, then hands back the two
// values config.js needs. The page never sees a key; the wallet shows and signs the transaction.
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { encodeDeployData, formatEther, formatGwei, getAddress, isAddress } from "viem";
import config from "../config.js";
import { chain, connectWallet, hasInjectedWallet, publicClient } from "./lib/chain.js";
import { boothAddress, loadArtifact, readCoreConfiguration, readCoreState } from "./lib/contract.js";
import { explain, FriendlyError } from "./lib/errors.js";
import { shortHex, utcStamp } from "./lib/format.js";
import { apiGet, readCore } from "./lib/squeek-api.js";
import { ChainLink, Footer, Marquee, Note } from "./ui/frame.js";
import { html } from "./ui/html.js";

// Per-transaction gas cap on Sepolia since the Fusaka upgrade (EIP-7825).
const TX_GAS_CAP = 16_777_216n;

/** Wei in the unit that keeps it readable: Sepolia gas is often a few wei. */
function prettyWei(wei) {
  const short = (text) => {
    const [whole, fraction = ""] = text.split(".");
    const kept = fraction.slice(0, 4).replace(/0+$/, "");
    return kept ? `${whole}.${kept}` : whole;
  };
  if (wei < 10n ** 9n) return `${wei.toLocaleString("en-US")} wei`;
  if (wei < 10n ** 15n) return `${short(formatGwei(wei))} gwei`;
  return `${short(formatEther(wei))} ETH`;
}

function useCoreCheck(address) {
  const [check, setCheck] = useState(null);
  useEffect(() => {
    if (!address) return setCheck(null);
    if (!isAddress(address, { strict: false })) return setCheck({ ok: false, message: "That is not an Ethereum address." });
    let cancelled = false;
    setCheck({ pending: true });
    const timer = setTimeout(async () => {
      try {
        const [cfg, state] = await Promise.all([readCoreConfiguration(address), readCoreState(address)]);
        if (cancelled) return;
        if (cfg.roundDuration === 0n) {
          setCheck({ ok: false, message: "It answers, but reports a round length of zero. HamsterDraw would refuse it." });
        } else {
          setCheck({
            ok: true,
            genesis: new Date(Number(cfg.genesisTimestamp) * 1000),
            minutes: Number(cfg.roundDuration) / 60,
            settled: state.settledThroughRound,
            paused: state.paused,
          });
        }
      } catch {
        if (!cancelled) {
          setCheck({ ok: false, message: `Nothing at that address on ${config.chainName} answers configuration() and state() like SqueekCore.` });
        }
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [address]);
  return check;
}

function DeployDesk() {
  const [artifact, setArtifact] = useState(null);
  const [artifactError, setArtifactError] = useState(null);
  const [core, setCore] = useState("");
  const [coreSource, setCoreSource] = useState("loading");
  const [account, setAccount] = useState(null);
  const [estimate, setEstimate] = useState(null);
  const [phase, setPhase] = useState({ step: "idle" });
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const coreCheck = useCoreCheck(core.trim());

  useEffect(() => {
    loadArtifact().then(setArtifact).catch((error) => setArtifactError(explain(error)));
    apiGet("/core")
      .then((body) => {
        const live = readCore(body)?.core;
        if (!live) throw new Error("no core in /v1/core");
        setCore((current) => current || live);
        setCoreSource("api");
      })
      .catch(() => {
        setCore((current) => current || config.fallback.core);
        setCoreSource("fallback");
      });
  }, []);

  useEffect(() => setEstimate(null), [core, account?.account]);

  const busy = ["connecting", "estimating", "signing", "mining"].includes(phase.step);
  const failure = (where) =>
    phase.step === "error" && phase.where === where ? html`<p class="stage-error" role="alert">${phase.message}</p>` : null;
  const canEstimate = artifact && coreCheck?.ok && account && !busy && !result;
  const canDeploy = canEstimate && estimate;

  async function connect() {
    setPhase({ step: "connecting" });
    try {
      setAccount(await connectWallet());
      setPhase({ step: "idle" });
    } catch (error) {
      setPhase({ step: "error", where: "wallet", message: explain(error) });
    }
  }

  async function runEstimate() {
    setPhase({ step: "estimating" });
    try {
      const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args: [getAddress(core.trim())] });
      const [gas, gasPrice] = await Promise.all([
        publicClient.estimateGas({ account: account.account, data }),
        publicClient.getGasPrice(),
      ]);
      if (gas > TX_GAS_CAP) {
        throw new FriendlyError(`The deployment needs ${gas.toLocaleString("en-US")} gas, more than one transaction may use.`);
      }
      setEstimate({ gas, gasPrice });
      setPhase({ step: "idle" });
    } catch (error) {
      setPhase({ step: "error", where: "estimate", message: explain(error) });
    }
  }

  async function deploy() {
    setPhase({ step: "signing" });
    try {
      const hash = await account.wallet.deployContract({
        abi: artifact.abi,
        bytecode: artifact.bytecode,
        args: [getAddress(core.trim())],
        account: account.account,
        chain,
        gas: (estimate.gas * 12n) / 10n < TX_GAS_CAP ? (estimate.gas * 12n) / 10n : TX_GAS_CAP,
      });
      setPhase({ step: "mining", hash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success" || !receipt.contractAddress) {
        throw new FriendlyError("The deployment reverted. Open the transaction on the explorer to see why.");
      }
      setResult({ address: receipt.contractAddress, blockNumber: receipt.blockNumber, hash });
      setPhase({ step: "done", hash });
    } catch (error) {
      setPhase((current) => ({ step: "error", where: "deploy", hash: current.hash, message: explain(error) }));
    }
  }

  const snippet = result
    ? `  drawAddress: "${getAddress(result.address)}",\n  deployBlock: ${result.blockNumber},`
    : `  drawAddress: "0x…",\n  deployBlock: …,`;

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return html`
    <section class="office" aria-labelledby="office-title">
      <div class="section-head">
        <p class="kicker">Six steps, one transaction</p>
        <h1 class="section-title" id="office-title">Deploy a booth</h1>
      </div>
      <${Note} title="Before you start">
        <p>
          HamsterDraw has no owner and no admin, and it never holds funds, so there is nothing to configure after
          deployment. Anyone can deploy their own copy; raffles only mean something on the copy people agree to use.
          Your wallet signs the deployment; this page never sees a key. It costs Sepolia test ETH only.
        </p>
        ${boothAddress
          ? html`<p>config.js already points at <${ChainLink} value=${boothAddress} />. Deploying again makes a separate, empty booth.</p>`
          : null}
      <//>

      <ol class="desk">
        <li class="desk-step">
          <span class="desk-no">1</span>
          <div class="desk-body">
            <h2>Check the contract</h2>
            ${artifactError ? html`<p class="stage-error">${artifactError}</p>` : null}
            ${artifact
              ? html`<dl class="facts">
                  <dt>Contract</dt><dd>${artifact.contractName} (${artifact.sourceName})</dd>
                  <dt>Compiler</dt><dd class="mono">solc ${artifact.compiler.version}, optimizer ${artifact.compiler.optimizer?.enabled ? `on, ${artifact.compiler.optimizer.runs} runs` : "off"}, EVM ${artifact.compiler.evmVersion}</dd>
                  <dt>Runtime size</dt><dd class="mono">${artifact.deployedBytecodeSize.toLocaleString("en-US")} bytes</dd>
                  <dt>Source sha256</dt><dd class="mono hash">${artifact.sourceSha256}</dd>
                </dl>
                <p class="hint">Built by <span class="mono">npm run build</span> from contracts/HamsterDraw.sol. Rebuild and compare if you want to be sure.</p>`
              : !artifactError
                ? html`<p class="loading-line">Loading artifact/HamsterDraw.json…</p>`
                : null}
          </div>
        </li>

        <li class="desk-step">
          <span class="desk-no">2</span>
          <div class="desk-body">
            <h2>Point it at SqueekCore</h2>
            <label class="field">
              <span class="field-label">
                <span>SqueekCore address</span>
                <span class="bytes">${coreSource === "api" ? "from api.squeekchain.com/v1/core" : coreSource === "fallback" ? "API unreachable: built-in fallback" : "loading…"}</span>
              </span>
              <input class="input mono" type="text" spellcheck="false" autocomplete="off" value=${core} onInput=${(e) => setCore(e.currentTarget.value)} />
            </label>
            ${coreCheck?.pending ? html`<p class="loading-line">Asking that address for its configuration…</p>` : null}
            ${coreCheck?.ok
              ? html`<p class="check-line is-ok">
                  Looks like SqueekCore: genesis ${utcStamp(coreCheck.genesis)}, ${coreCheck.minutes}-minute rounds, settled through
                  round ${String(coreCheck.settled)}${coreCheck.paused ? ", settlement paused right now" : ""}.
                </p>`
              : null}
            ${coreCheck && coreCheck.ok === false ? html`<p class="check-line is-bad">${coreCheck.message}</p>` : null}
            <p class="hint">The address is baked into the contract for good, with the genesis time and round length copied from it.</p>
          </div>
        </li>

        <li class="desk-step">
          <span class="desk-no">3</span>
          <div class="desk-body">
            <h2>Connect a wallet</h2>
            ${account
              ? html`<p class="check-line is-ok">Connected as <${ChainLink} value=${account.account} /> on ${chain.name}.</p>`
              : html`<button class="btn btn-green" type="button" onClick=${connect} disabled=${busy}>
                  ${phase.step === "connecting" ? "Check your wallet…" : `Connect and switch to ${chain.name}`}
                </button>`}
            ${!hasInjectedWallet() ? html`<p class="hint">No browser wallet detected on this page.</p>` : null}
            ${failure("wallet")}
          </div>
        </li>

        <li class="desk-step">
          <span class="desk-no">4</span>
          <div class="desk-body">
            <h2>Estimate the gas</h2>
            <button class="btn" type="button" onClick=${runEstimate} disabled=${!canEstimate}>
              ${phase.step === "estimating" ? "Estimating…" : "Estimate"}
            </button>
            ${estimate
              ? html`<p class="check-line is-ok">
                  About ${estimate.gas.toLocaleString("en-US")} gas at ${prettyWei(estimate.gasPrice)} per gas: roughly
                  ${" "}${prettyWei(estimate.gas * estimate.gasPrice)} of ${chain.name} ETH. Your wallet sends it with 20% headroom.
                </p>`
              : html`<p class="hint">Needs the contract, a working core address and a connected wallet.</p>`}
            ${failure("estimate")}
          </div>
        </li>

        <li class="desk-step">
          <span class="desk-no">5</span>
          <div class="desk-body">
            <h2>Deploy</h2>
            <button class="btn btn-primary" type="button" onClick=${deploy} disabled=${!canDeploy}>
              ${phase.step === "signing" ? "Sign in your wallet…" : phase.step === "mining" ? "Waiting for a block…" : result ? "Deployed" : "Deploy HamsterDraw"}
            </button>
            ${phase.hash ? html`<p class="check-line">Transaction <${ChainLink} kind="tx" value=${phase.hash} /></p>` : null}
            ${result
              ? html`<p class="check-line is-ok">
                  Live at <${ChainLink} value=${result.address} full=${true} /> since block ${String(result.blockNumber)}.
                </p>`
              : null}
            ${failure("deploy")}
          </div>
        </li>

        <li class="desk-step">
          <span class="desk-no">6</span>
          <div class="desk-body">
            <h2>Paste it into config.js</h2>
            <p>Open <span class="mono">web/config.js</span> and replace these two lines, then redeploy the static site.</p>
            <pre class="formula">${snippet}</pre>
            <button class="btn btn-small" type="button" onClick=${copySnippet} disabled=${!result}>
              ${copied ? "Copied" : "Copy the two lines"}
            </button>
            ${result
              ? html`<p class="hint">Until you do, this site keeps showing the booth-closed sign. ${shortHex(result.address)} works the moment config.js knows it.</p>`
              : null}
          </div>
        </li>
      </ol>
    </section>
  `;
}

function DeployPage() {
  return html`
    <${Marquee} office=${true} />
    <main id="main" class="wrap page">
      <${DeployDesk} />
    </main>
    <${Footer} />
  `;
}

const root = document.getElementById("app");
root.textContent = "";
render(html`<${DeployPage} />`, root);
