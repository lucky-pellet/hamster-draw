// The booth around every page: awning and sign, the live hamster strip, small shared pieces, the footer.
import config from "../../config.js";
import { explorerUrl } from "../lib/chain.js";
import { boothAddress } from "../lib/contract.js";
import { useHamster, useNow } from "../lib/feed.js";
import { distance, relative, serial, shortHex, utcClock } from "../lib/format.js";
import { roundAt } from "../lib/rounds.js";
import { Hamster } from "./art.js";
import { clockOf, sameCoreAsApi, useBoothInfo } from "./hooks.js";
import { html } from "./html.js";

export function Marquee({ office = false }) {
  const feed = useHamster();
  const info = useBoothInfo();
  const now = useNow(5000);
  const clock = clockOf(info, feed);
  const round = roundAt(Math.floor(now / 1000), clock.genesisTimestamp, clock.roundDuration);
  const settled = sameCoreAsApi(info, feed)
    ? (feed.status?.settledThroughRound ?? feed.core?.settledThroughRound ?? null)
    : null;

  return html`
    <header class="marquee-zone">
      <div class="awning" aria-hidden="true"></div>
      <div class="wrap">
        <div class="marquee">
          <div class="marquee-main">
            <p class="kicker">${office ? "Back office · Sepolia" : "Squeekchain raffle booth · Sepolia testnet"}</p>
            <a class="marquee-title" href="./">Hamster <span>Draw</span></a>
            <p class="marquee-tag">
              ${office
                ? "Put your own copy of the booth on Sepolia. Your wallet signs, nobody else touches a key."
                : "Raffles and giveaways where a real hamster on a real wheel picks the winners. Sealed before he runs, settled onchain, checkable by anyone."}
            </p>
            <nav class="marquee-nav" aria-label="Sections">
              <a href="./?practice">Practice draw</a>
              <a href="./#open">Open a raffle</a>
              <a href="./#recent">Recent draws</a>
              <a href="./#how">How it works</a>
              <a href="./deploy.html">Deploy</a>
            </nav>
          </div>
          <div class="marquee-stub">
            <span class="stub-label">Now round</span>
            <span class="stub-round">${round ? serial(round, 4) : "----"}</span>
            <span class="stub-note">
              ${settled !== null
                ? `ledger settled through ${settled}`
                : sameCoreAsApi(info, feed)
                  ? "reading the ledger…"
                  : "custom core: see each raffle"}
            </span>
          </div>
        </div>
      </div>
    </header>
  `;
}

function strip(feed) {
  const s = feed.status;
  if (!s && !feed.statusError) {
    return { mood: "loading", headline: "Checking on Squeektoshi", detail: "asking the wheel sensor…" };
  }
  if (!s || !s.measured) {
    return {
      mood: "unknown",
      headline: "Hamster status unknown",
      detail: feed.statusError
        ? "the Squeekchain API did not answer; raffles still read straight from the chain"
        : "the wheel sensor has nothing to report right now",
    };
  }
  if (s.freshness !== "online") {
    return {
      mood: "quiet",
      headline: "Wheel sensor is quiet",
      detail: `last heard ${s.observedAt ? relative(s.observedAt.getTime()) : "a while ago"}, so his state is unknown`,
    };
  }
  if (s.coreStatus === "ACTIVE") {
    return {
      mood: "running",
      headline: "Squeektoshi is running",
      detail: `${Math.round(s.rpm ?? 0)} rpm · ${(s.metersPerSecond ?? 0).toFixed(2)} m/s · ${distance(s.todayMeters)} today`,
    };
  }
  if (s.coreStatus === "COUNTER_FAULT") {
    return {
      mood: "fault",
      headline: "Wheel counter hiccup",
      detail: "the sensor flagged a fault; settlement waits for clean data",
    };
  }
  return {
    mood: "asleep",
    headline: "Squeektoshi is asleep",
    detail: `wheel still · ${distance(s.todayMeters)} today · draws wait for his next run`,
  };
}

export function StatusStrip() {
  const feed = useHamster();
  const { mood, headline, detail } = strip(feed);
  const seen = feed.status?.observedAt;
  return html`
    <section class=${`wheel-strip mood-${mood}`} aria-label="Hamster status">
      <div class="wrap wheel-strip-inner" aria-live="polite">
        <${Hamster} pose=${mood === "running" ? "running" : "asleep"} size=${52} />
        <div class="wheel-text">
          <p class="wheel-headline">${headline}</p>
          <p class="wheel-detail">${detail}</p>
        </div>
        <p class="wheel-source">
          live wheel feed${seen ? ` · seen ${utcClock(seen)}` : ""}
          ${feed.status?.settledThroughRound !== null && feed.status?.settledThroughRound !== undefined
            ? ` · settled through round ${feed.status.settledThroughRound}`
            : ""}
        </p>
      </div>
    </section>
  `;
}

/** An address or tx hash in mono, linked to the explorer when there is one. */
export function ChainLink({ kind = "address", value, full = false }) {
  if (!value) return html`<span class="mono">–</span>`;
  const text = full ? String(value) : shortHex(String(value), kind === "tx" ? 10 : 6, 4);
  const href = explorerUrl(kind, value);
  return href
    ? html`<a class="mono chain-link" href=${href} target="_blank" rel="noopener noreferrer">${text}</a>`
    : html`<span class="mono">${text}</span>`;
}

export function Note({ tone = "info", title, children }) {
  return html`
    <div class=${`note note-${tone}`} role=${tone === "error" ? "alert" : undefined}>
      ${title ? html`<p class="note-title">${title}</p>` : null}
      ${children}
    </div>
  `;
}

export function Footer() {
  const feed = useHamster();
  const info = useBoothInfo();
  const core = info?.live ? info.core : (feed.core?.core ?? config.fallback.core);
  return html`
    <footer class="site-foot">
      <div class="wrap foot-grid">
        <p>
          <strong>Hamster Draw</strong> is open source under the MIT licence. It runs on the Sepolia testnet only:
          no real money, and the contract never holds prizes. Hosts hand those out themselves.
        </p>
        <p class="foot-links">
          <span>Booth contract ${boothAddress ? html`<${ChainLink} value=${boothAddress} />` : "not deployed yet"}</span>
          <span>SqueekCore <${ChainLink} value=${core} /></span>
          <a href="./deploy.html">Deploy your own booth</a>
        </p>
      </div>
    </footer>
  `;
}
