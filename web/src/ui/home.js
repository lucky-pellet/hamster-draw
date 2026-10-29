// Front of the booth: open a raffle, see recent ones, learn the rules. Also the "booth closed" sign.
import { useEffect, useMemo, useState } from "preact/hooks";
import { parseEventLogs } from "viem";
import config from "../../config.js";
import { connectWallet, hasInjectedWallet, publicClient } from "../lib/chain.js";
import { boothAddress, loadArtifact, readBoothInfo, readRecent } from "../lib/contract.js";
import { byteLength, LIMITS, looksCommaSeparated, maxWinnersFor, parseEntries } from "../lib/entries.js";
import { explain, FriendlyError } from "../lib/errors.js";
import { useHamster, useNow } from "../lib/feed.js";
import { countdown, relative, serial, shortHex, utcClock, utcStamp } from "../lib/format.js";
import { hashEntries } from "../lib/raffle-math.js";
import { nextLikelyRun, roundAt, roundEnd, roundStart, SETTLE_LAG_SECONDS } from "../lib/rounds.js";
import { Hamster } from "./art.js";
import { ChainLink, Note } from "./frame.js";
import { XHelper } from "./giveaway.js";
import { clockOf, useBoothInfo } from "./hooks.js";
import { html } from "./html.js";

export function Home() {
  return html`
    <${BoothCheck} />
    <${CreateBooth} />
    <div class="home-lower">
      <${RecentRaffles} />
      <${HowItWorks} />
    </div>
  `;
}

/** Warns when config.js points at an address with no contract (wrong network, typo). */
function BoothCheck() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    readBoothInfo().then(setInfo).catch(() => setInfo(null));
  }, []);
  if (!info || info.live) return null;
  return html`
    <${Note} tone="error" title="No booth at that address">
      <p>
        config.js points at <span class="mono">${boothAddress}</span>, but there is no contract there on${" "}
        ${config.chainName}. Check the address, or <a href="./deploy.html">deploy a fresh booth</a>.
      </p>
    <//>
  `;
}

// --- Open a raffle -----------------------------------------------------------------------------------

const PLACEHOLDER = "@squeektoshi\n0x980b4424c007caf7a1f3670b48c8eaef7ebc3d44\nCarol from the Discord\n@wheel_enjoyer";

function etaLine({ feed, target, clock, now }) {
  const unlockMs = (roundEnd(target, clock.genesisTimestamp, clock.roundDuration) + SETTLE_LAG_SECONDS) * 1000;
  const s = feed.status;
  if (s?.measured && s.freshness === "online" && s.coreStatus === "ACTIVE") {
    return `He is on the wheel right now. If he keeps going into round ${target}, expect the draw to open around ${utcClock(new Date(unlockMs))} (${relative(unlockMs, now)}).`;
  }
  const next = nextLikelyRun(now, feed.typicalDay);
  if (!next.at) return "He is off the wheel right now, so the draw waits for his next run, whenever that is.";
  return `He is off the wheel right now, so the draw waits for his next run. Going by ${next.basis}, that is probably around ${utcStamp(next.at)} (${relative(next.at.getTime(), now)}).`;
}

export function CreateBooth() {
  const feed = useHamster();
  const info = useBoothInfo();
  const now = useNow(1000);
  const clock = clockOf(info, feed);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [winners, setWinners] = useState(1);
  const [phase, setPhase] = useState({ step: "idle" });
  const [tried, setTried] = useState(false);

  const parsed = useMemo(() => parseEntries(text), [text]);
  const { entries } = parsed;
  const maxWinners = maxWinnersFor(entries.length);
  const pick = Math.min(Math.max(1, winners), Math.max(1, maxWinners));
  const cleanTitle = title.trim();
  const titleBytes = byteLength(cleanTitle);
  const entriesHash = useMemo(() => (entries.length >= LIMITS.minEntries ? hashEntries(entries) : null), [entries]);

  const problems = [];
  if (!cleanTitle) problems.push("Give the raffle a title.");
  if (titleBytes > LIMITS.titleBytes) problems.push(`The title is ${titleBytes} bytes; the limit is ${LIMITS.titleBytes}.`);
  if (entries.length < LIMITS.minEntries) problems.push("Add at least two entries, one per line.");
  if (entries.length > LIMITS.maxEntries) problems.push(`That is ${entries.length} entries; the limit is ${LIMITS.maxEntries}.`);
  if (parsed.tooLong.length) {
    problems.push(`${parsed.tooLong.length} line${parsed.tooLong.length > 1 ? "s are" : " is"} over ${LIMITS.entryBytes} bytes. Shorten ${parsed.tooLong.length > 1 ? "them" : "it"} first.`);
  }

  const nowSeconds = Math.floor(now / 1000);
  const nowRound = roundAt(nowSeconds, clock.genesisTimestamp, clock.roundDuration);
  const target = nowRound + 1;
  const targetStart = roundStart(target, clock.genesisTimestamp, clock.roundDuration) * 1000;
  const targetEnd = roundEnd(target, clock.genesisTimestamp, clock.roundDuration) * 1000;
  const busy = ["wallet", "sending", "mining", "done"].includes(phase.step);

  async function submit(event) {
    event.preventDefault();
    setTried(true);
    if (problems.length || busy) return;
    setPhase({ step: "wallet" });
    try {
      const { wallet, account } = await connectWallet();
      const { abi } = await loadArtifact();
      const { request } = await publicClient.simulateContract({
        address: boothAddress,
        abi,
        functionName: "create",
        args: [cleanTitle, entries, pick],
        account,
      });
      setPhase({ step: "sending" });
      const hash = await wallet.writeContract(request);
      setPhase({ step: "mining", hash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new FriendlyError("The transaction reverted onchain. Nothing was created.");
      const [log] = parseEventLogs({ abi, logs: receipt.logs, eventName: "DrawCreated" });
      if (!log) throw new FriendlyError("The transaction went through but no raffle was logged. Check it on the explorer.");
      setPhase({ step: "done", hash, id: log.args.id });
      window.location.assign(`?id=${log.args.id}`);
    } catch (error) {
      setPhase({ step: "error", message: explain(error) });
    }
  }

  const splitCommas = () => setText(text.split(",").map((part) => part.trim()).filter(Boolean).join("\n"));

  return html`
    <section class="booth" id="open" aria-labelledby="open-title">
      <div class="section-head">
        <p class="kicker">Step right up</p>
        <h2 class="section-title" id="open-title">Open a raffle</h2>
        <p class="hint">First time here? <a href="./?practice">Try a practice draw</a>: a real round, your list, no wallet.</p>
      </div>
      <form class="booth-card" onSubmit=${submit} novalidate>
        <div class="booth-form">
          <label class="field">
            <span class="field-label">
              <span>Title</span>
              <span class=${`bytes${titleBytes > LIMITS.titleBytes ? " is-over" : ""}`}>${titleBytes}/${LIMITS.titleBytes} bytes</span>
            </span>
            <input
              class="input"
              type="text"
              name="title"
              autocomplete="off"
              placeholder="Three wheel-side seats for Friday's stream"
              value=${title}
              onInput=${(e) => setTitle(e.currentTarget.value)}
            />
          </label>

          <label class="field">
            <span class="field-label">
              <span>Entries, one per line</span>
              <span class="bytes">max ${LIMITS.entryBytes} bytes each</span>
            </span>
            <textarea
              class="textarea"
              name="entries"
              rows="11"
              spellcheck="false"
              placeholder=${PLACEHOLDER}
              value=${text}
              onInput=${(e) => setText(e.currentTarget.value)}
            ></textarea>
          </label>

          <div class="parse-line" aria-live="polite">
            <span class="parse-count"><b>${entries.length}</b> ${entries.length === 1 ? "ticket" : "tickets"}</span>
            ${parsed.duplicates.length
              ? html`<span class="chip">${parsed.duplicates.length} repeat${parsed.duplicates.length > 1 ? "s" : ""} dropped</span>`
              : null}
            ${parsed.blank ? html`<span class="chip">${parsed.blank} blank line${parsed.blank > 1 ? "s" : ""} skipped</span>` : null}
            ${looksCommaSeparated(text)
              ? html`<button type="button" class="chip chip-action" onClick=${splitCommas}>Split on commas</button>`
              : null}
          </div>
          ${parsed.tooLong.length
            ? html`<ul class="parse-errors">
                ${parsed.tooLong.slice(0, 5).map(
                  (row) => html`<li key=${row.line}>Line ${row.line} is ${row.bytes} bytes: <span class="mono">${row.value.slice(0, 40)}…</span></li>`,
                )}
              </ul>`
            : null}
          <p class="hint">
            Handles, addresses or plain names. Spaces are trimmed and repeats are dropped (ignoring case), so the
            list you see is exactly the list that gets sealed.
          </p>
          <${XHelper} onUse=${(handles) => setText(handles.join("\n"))} />

          <div class="field field-inline">
            <span class="field-label"><span>Winners</span></span>
            <div class="stepper" role="group" aria-label="Number of winners">
              <button type="button" aria-label="One fewer winner" disabled=${pick <= 1} onClick=${() => setWinners(Math.max(1, pick - 1))}>−</button>
              <input
                type="number"
                inputmode="numeric"
                min="1"
                max=${Math.max(1, maxWinners)}
                value=${pick}
                aria-label="Winners"
                onInput=${(e) => setWinners(Number(e.currentTarget.value) || 1)}
              />
              <button type="button" aria-label="One more winner" disabled=${pick >= maxWinners} onClick=${() => setWinners(pick + 1)}>+</button>
            </div>
            <span class="hint">up to ${Math.max(1, maxWinners)} for this list (the contract allows 50, always fewer than the entries)</span>
          </div>
        </div>

        <aside class="booth-stub" aria-label="Preview">
          <div class="stub-pair">
            <div><span class="stub-label">Tickets</span><span class="stub-num">${serial(entries.length, 3)}</span></div>
            <div><span class="stub-label">Winners</span><span class="stub-num">${serial(pick, 2)}</span></div>
          </div>

          <div class="stub-block">
            <span class="stub-label">Entries hash</span>
            <span class="mono hash-wrap">${entriesHash ?? "add two entries to see it"}</span>
          </div>

          <div class="stub-block">
            <span class="stub-label">Decided by</span>
            <p class="stub-text">
              the next round he runs after round <b>${nowRound}</b>: round <b>${target}</b> at the earliest,
              ${" "}${utcClock(new Date(targetStart))} to ${utcClock(new Date(targetEnd))}.
            </p>
            ${targetStart - now < 120_000
              ? html`<p class="stub-text stub-warn">
                  Round ${nowRound} ends in ${countdown(targetStart, now)}. A transaction that lands later points one round further.
                </p>`
              : null}
            <p class="stub-text">${etaLine({ feed, target, clock, now })}</p>
          </div>

          <button class="btn btn-primary btn-wide" type="submit" disabled=${busy}>
            ${phase.step === "wallet" ? "Check your wallet…" : phase.step === "sending" ? "Sign in your wallet…" : phase.step === "mining" ? "Sealing…" : phase.step === "done" ? "Sealed!" : "Seal the raffle"}
          </button>
          ${phase.hash ? html`<p class="stub-text">Transaction <${ChainLink} kind="tx" value=${phase.hash} /></p>` : null}
          ${tried && problems.length && phase.step !== "error"
            ? html`<ul class="parse-errors">${problems.map((p) => html`<li key=${p}>${p}</li>`)}</ul>`
            : null}
          ${phase.step === "error" ? html`<p class="stub-error" role="alert">${phase.message}</p>` : null}
          <p class="stub-fine">
            ${hasInjectedWallet()
              ? "One transaction from your wallet on Sepolia. Test gas only."
              : "Sealing needs a browser wallet on Sepolia. Everything else on this site works without one."}
          </p>
        </aside>
      </form>
    </section>
  `;
}

// --- Recent raffles --------------------------------------------------------------------------------

const STATE_LABEL = {
  waiting: "Waiting",
  asleep: "Hamster asleep",
  ready: "Ready to draw",
  drawn: "Drawn",
};

export function RecentRaffles() {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    readRecent(12)
      .then((items) => setState({ items }))
      .catch((error) => setState({ error: explain(error) }));
  }, []);

  return html`
    <section class="recent" id="recent" aria-labelledby="recent-title">
      <div class="section-head">
        <p class="kicker">Fresh off the roll</p>
        <h2 class="section-title" id="recent-title">Recent raffles</h2>
      </div>
      ${state.loading ? html`<p class="loading-line">Reading DrawCreated logs…</p>` : null}
      ${state.error ? html`<${Note} tone="error" title="Could not read the raffles"><p>${state.error}</p><//>` : null}
      ${state.items && !state.items.length
        ? html`<div class="empty-roll">
            <${Hamster} pose="asleep" size=${72} />
            <p>No raffles yet. The drum is empty and the hamster is waiting for a reason to run.</p>
          </div>`
        : null}
      ${state.items?.length
        ? html`<ol class="stub-list">
            ${state.items.map(
              (r) => html`
                <li key=${String(r.id)}>
                  <a class="stub-row" href=${`?id=${r.id}`}>
                    <span class="stub-no"><span>No.</span><b>${serial(r.id)}</b></span>
                    <span class="stub-main">
                      <span class="stub-title">${r.title}</span>
                      <span class="stub-meta">
                        ${r.entryCount} tickets · ${r.winners} winner${r.winners > 1 ? "s" : ""} · round ${String(r.targetRound)} on · by ${shortHex(r.host)}
                      </span>
                    </span>
                    <span class=${`state-chip state-${r.status ?? "unknown"}`}>${STATE_LABEL[r.status] ?? "Unknown"}</span>
                  </a>
                </li>
              `,
            )}
          </ol>`
        : null}
      ${!Number(config.deployBlock)
        ? html`<p class="hint">Only the last ${Number(config.logChunk).toLocaleString("en-US")} blocks are searched until deployBlock is set in config.js.</p>`
        : null}
    </section>
  `;
}

// --- Rules -----------------------------------------------------------------------------------------

export function HowItWorks() {
  return html`
    <section class="how" id="how" aria-labelledby="how-title">
      <div class="section-head">
        <p class="kicker">Read the back of the ticket</p>
        <h2 class="section-title" id="how-title">How it works</h2>
      </div>
      <ol class="how-steps">
        <li>
          <h3>Seal the list</h3>
          <p>The contract stores a hash of the exact entry list and logs every entry. Nobody can add, drop or reorder a name afterwards.</p>
        </li>
        <li>
          <h3>Point at a round nobody has seen</h3>
          <p>A raffle targets the round after the one it was opened in. That round has not started, so not even the host knows what the wheel will record.</p>
        </li>
        <li>
          <h3>Wait for the hamster</h3>
          <p>Squeektoshi runs when he feels like it, mostly 21:00 to 03:00 UTC. Rounds he sleeps through are skipped; the first round he actually runs decides it.</p>
        </li>
        <li>
          <h3>Anyone pulls the lever</h3>
          <p>Once SqueekCore settles that round, anyone can press Draw. The winners come from the round's dataHash, so who presses it, and when, changes nothing.</p>
        </li>
      </ol>
      <div class="trust">
        <h3>What you are still trusting</h3>
        <p>
          The dataHash of each round is whatever the Squeekchain reporter settles onchain. A reporter working with a host
          could, in theory, steer it or report a round as empty. SqueekCore can also be upgraded by its governance
          timelock. And a host could open the same list several times and only share the raffle they like, so the
          raffle page lists every other raffle by the same host.
        </p>
      </div>
    </section>
  `;
}

// --- Not deployed -------------------------------------------------------------------------------------

export function BoothClosed({ practiceAbove = false }) {
  return html`
    <section class="closed" aria-labelledby="closed-title">
      <div class="closed-ticket">
        <div class="closed-main">
          <p class="kicker">Sorry, folks</p>
          <h2 class="section-title" id="closed-title">Booth closed</h2>
          <p>
            Real raffles need the HamsterDraw contract, and this copy of Hamster Draw has none yet. Deploy it to
            ${" "}${config.chainName} from your own wallet, then paste its address and deploy block into
            ${" "}<span class="mono">config.js</span>. That is the whole setup.
          </p>
          <p>
            Until then, the${" "}
            ${practiceAbove ? html`<a href="#practice">practice draw above</a>` : html`<a href="./?practice">practice draw</a>`}
            ${" "}runs the very same winner rule on a round he has already run. A real raffle differs in one way that
            matters: it seals your list before its round has started.
          </p>
          <a class="btn btn-green" href="./deploy.html">Open the deploy page</a>
        </div>
        <div class="closed-stub">
          <${Hamster} pose="asleep" size=${110} label="Squeektoshi, asleep behind the counter" />
          <p>The hamster is in, the booth is not.</p>
        </div>
      </div>
    </section>
    <${HowItWorks} />
  `;
}
