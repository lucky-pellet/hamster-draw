// One raffle: where it stands, the drum, the winners, and everything needed to check them.
import { useCallback, useEffect, useState } from "preact/hooks";
import config from "../../config.js";
import { chain, connectWallet, publicClient } from "../lib/chain.js";
import {
  boothAddress,
  firstRunFrom,
  loadArtifact,
  readBoothInfo,
  readRaffle,
  readRaffleLogs,
  readRaffleStatus,
} from "../lib/contract.js";
import { explain, FriendlyError } from "../lib/errors.js";
import { useHamster, useNow } from "../lib/feed.js";
import { countdown, distance, ordinal, relative, serial, utcClock, utcStamp } from "../lib/format.js";
import { drawSeed, pickWinners } from "../lib/raffle-math.js";
import { METERS_PER_WORK, nextLikelyRun, roundAt, roundEnd, roundStart, SETTLE_LAG_SECONDS } from "../lib/rounds.js";
import { Drum, Hamster } from "./art.js";
import { ChainLink, Note } from "./frame.js";
import { html } from "./html.js";
import { Proof, Verify } from "./proof.js";
import { Reveal, useReveal } from "./reveal.js";
import { ShareBar } from "./share.js";

const STAMP = { waiting: "Sealed", asleep: "Hamster asleep", ready: "Ready to draw", drawn: "Drawn" };
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, reducedMotion() ? 0 : ms));

/** Everything the proof panel and the share buttons need, in the shape practice draws use too. */
function receiptOf({ id, data, info, run }) {
  const { draw, status } = data;
  const drawn = status.status === "drawn";
  return {
    practice: false,
    title: draw.title,
    id,
    contract: boothAddress,
    chainId: chain.id,
    chainName: config.chainName,
    core: info.core,
    entries: data.entries,
    entriesHash: draw.entriesHash,
    winners: Number(draw.winners),
    entryCount: Number(draw.entryCount),
    targetRound: draw.targetRound,
    round: status.roundId || 0n,
    dataHash: status.roundId ? status.dataHash : null,
    work: run?.work ?? null,
    seed: drawn ? draw.seed : null,
    picks: data.winners,
    sealed: { block: draw.createdBlock, tx: data.createdTx },
    drawn: drawn ? { block: draw.drawnBlock, tx: data.drawnTx } : null,
    link: `${window.location.origin}${window.location.pathname}?id=${id}`,
    embed: `${window.location.origin}${window.location.pathname}?id=${id}&embed=1`,
  };
}

export function RaffleView({ id }) {
  const [data, setData] = useState(null);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [run, setRun] = useState(null);
  const [action, setAction] = useState({ step: "idle" });
  const [peek, setPeek] = useState(null);
  const [revealKey, setRevealKey] = useState(0);
  const picks = data?.winners ?? peek?.picks ?? null;
  const reveal = useReveal(picks, revealKey);

  const load = useCallback(async () => {
    try {
      const boothInfo = await readBoothInfo();
      if (!boothInfo.live) throw new FriendlyError(`There is no booth contract at ${boothAddress} on ${config.chainName}.`);
      const raffle = await readRaffle(id);
      setInfo(boothInfo);
      setData(raffle);
      setError(null);
    } catch (err) {
      setError(explain(err));
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // While undrawn, re-check every 20 s; reload everything once someone draws it.
  const status = data?.status.status;
  useEffect(() => {
    if (!data || status === "drawn") return undefined;
    const timer = setInterval(async () => {
      if (document.hidden) return;
      try {
        const next = await readRaffleStatus(id);
        if (next.status === "drawn") await load();
        else setData((current) => (current ? { ...current, status: next } : current));
      } catch {
        // keep showing the last good state
      }
    }, 20_000);
    return () => clearInterval(timer);
  }, [Boolean(data), status, id, load]);

  // The deciding round's work, read from SqueekCore directly.
  const decider = data?.status.roundId ?? 0n;
  useEffect(() => {
    if (!info?.core || !data || !decider) return;
    firstRunFrom(info.core, data.draw.targetRound, decider)
      .then(setRun)
      .catch(() => setRun(null));
  }, [info?.core, String(decider)]);

  async function drawNow() {
    setAction({ step: "wallet" });
    try {
      const { wallet, account } = await connectWallet();
      const { abi } = await loadArtifact();
      const { request } = await publicClient.simulateContract({
        address: boothAddress,
        abi,
        functionName: "draw",
        args: [id],
        account,
      });
      setAction({ step: "sending" });
      const hash = await wallet.writeContract(request);
      setAction({ step: "mining", hash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new FriendlyError("The draw transaction reverted onchain.");
      const [fresh] = await Promise.all([readRaffle(id), pause(900)]);
      setData(fresh);
      setPeek(null);
      setRevealKey((k) => k + 1);
      setAction({ step: "done", hash });
    } catch (err) {
      setAction({ step: "error", message: explain(err) });
    }
  }

  function peekNow() {
    const seed = drawSeed({
      dataHash: data.status.dataHash,
      id,
      entriesHash: data.draw.entriesHash,
      chainId: chain.id,
      contract: boothAddress,
    });
    // The reveal does the drum roll; the result itself is instant.
    setPeek({ seed, picks: pickWinners(seed, data.draw.winners, data.draw.entryCount) });
    setRevealKey((k) => k + 1);
  }

  if (error) {
    return html`
      <${Note} tone="error" title="Could not open this raffle">
        <p>${error}</p>
        <p><a href="./">Back to the booth</a></p>
      <//>
    `;
  }
  if (!data || !info) {
    return html`
      <div class="raffle-loading">
        <${Drum} size=${150} />
        <p class="loading-line">Fetching raffle No. ${serial(id)} from ${config.chainName}…</p>
      </div>
    `;
  }

  const clock = { genesis: info.genesisTimestamp, duration: info.roundDuration };
  const receipt = receiptOf({ id, data, info, run });

  return html`
    <article class="raffle">
      <${RaffleHead} id=${id} draw=${data.draw} status=${status} clock=${clock} />
      <div class="raffle-grid">
        <div class="raffle-main">
          <${Stage}
            data=${data}
            clock=${clock}
            run=${run}
            action=${action}
            peek=${peek}
            picks=${picks}
            reveal=${reveal}
            receipt=${receipt}
            onDraw=${drawNow}
            onPeek=${peekNow}
          />
          <${Timeline} data=${data} clock=${clock} run=${run} />
        </div>
        <aside class="raffle-side">
          <${Proof} receipt=${receipt} />
          <${Verify} receipt=${receipt} />
          <${HostRecord} id=${id} draw=${data.draw} />
        </aside>
      </div>
      <${EntryBoard} entries=${data.entries} picks=${picks ? picks.slice(0, reveal.shown) : null} />
    </article>
  `;
}

function RaffleHead({ id, draw, status, clock }) {
  const createdAt = new Date(Number(draw.createdAt) * 1000);
  const createdRound = roundAt(Number(draw.createdAt), clock.genesis, clock.duration);
  return html`
    <header class="raffle-head">
      <div class="raffle-no" aria-label=${`Raffle number ${id}`}>
        <span>No.</span>
        <b>${serial(id)}</b>
      </div>
      <div class="raffle-head-main">
        <p class="kicker">Raffle on ${config.chainName}</p>
        <h1 class="raffle-title">${draw.title}</h1>
        <p class="raffle-meta">
          ${draw.entryCount} tickets · ${draw.winners} winner${draw.winners > 1 ? "s" : ""} · opened
          ${" "}${utcStamp(createdAt)} in round ${createdRound} by <${ChainLink} value=${draw.host} />
        </p>
      </div>
      <span class=${`stamp stamp-${status}`}>${STAMP[status]}</span>
    </header>
  `;
}

function Stage({ data, clock, run, action, peek, picks, reveal, receipt, onDraw, onPeek }) {
  const now = useNow(1000);
  const feed = useHamster();
  const { draw, status, entries } = data;
  const st = status.status;
  const target = Number(draw.targetRound);
  const settled = Number(status.settledThroughRound);
  const startMs = roundStart(target, clock.genesis, clock.duration) * 1000;
  const endMs = roundEnd(target, clock.genesis, clock.duration) * 1000;
  const spinning = ["sending", "mining"].includes(action.step);
  const busy = ["wallet", "sending", "mining"].includes(action.step) || reveal.rolling;
  const runningNow = feed.status?.measured && feed.status.freshness === "online" && feed.status.coreStatus === "ACTIVE";

  let headline;
  let lines = [];
  if (st === "drawn") {
    headline = reveal.rolling ? "The drum is turning" : "The drum has spoken";
    lines = [`Decided by round ${String(draw.drawnRound)}${run ? `, where he ran ${run.work} work units (about ${distance(Number(run.work) * METERS_PER_WORK)} of wheel)` : ""}.`];
  } else if (st === "ready") {
    headline = "He ran! The result is sealed.";
    lines = [
      `Round ${String(status.roundId)} settled with real wheel work${run ? `: ${run.work} units, about ${distance(Number(run.work) * METERS_PER_WORK)}` : ""}. Its dataHash already fixes the winners.`,
      "Pressing Draw writes them onchain. Anyone can do it, and it comes out the same whoever does.",
    ];
  } else if (st === "asleep") {
    const next = nextLikelyRun(now, feed.typicalDay);
    headline = "Squeektoshi is asleep";
    lines = [
      `Rounds ${target} to ${settled} all settled with zero work. The first round he actually runs decides this raffle.`,
      runningNow
        ? "Good news: he is on the wheel right now. Expect the draw to open once this round settles."
        : next.at
          ? `Going by ${next.basis}, he will probably be back around ${utcStamp(next.at)} (${relative(next.at.getTime(), now)}).`
          : "He keeps his own hours. The page checks again every 20 seconds.",
    ];
  } else if (now < startMs) {
    headline = `Waiting for round ${target}`;
    lines = [
      `It starts at ${utcClock(new Date(startMs))}, in ${countdown(startMs, now)}. Nothing about it exists yet, which is the point.`,
    ];
  } else if (now < endMs) {
    headline = `Round ${target} is running`;
    lines = [
      `It ends in ${countdown(endMs, now)}. ${runningNow ? "He is on the wheel as we speak." : "If he stays asleep through it, the next round he runs takes over."}`,
    ];
  } else {
    headline = "Waiting for the ledger";
    lines = [
      `Round ${target} ended at ${utcClock(new Date(endMs))}. SqueekCore is settled through round ${settled}; settlements land about every ten minutes, usually done by ${utcClock(new Date(endMs + SETTLE_LAG_SECONDS * 1000))}.`,
    ];
  }

  const drawLabel = {
    wallet: "Check your wallet…",
    sending: "Sign in your wallet…",
    mining: "Spinning the drum…",
  }[action.step] ?? (st === "ready" ? "Draw now" : st === "asleep" ? "Draw opens after his next run" : `Draw opens after round ${target} settles`);

  const showWinners = picks && picks.length && !spinning;
  const turning = spinning || (reveal.rolling && !reveal.calm);
  return html`
    <section class=${`stage stage-${st}`} aria-labelledby="stage-title">
      <div class="stage-art">
        ${st === "asleep" && !spinning
          ? html`<${Hamster} pose=${runningNow ? "running" : "asleep"} size=${170} label="Squeektoshi" />`
          : html`<${Drum} spinning=${turning} size=${210} />`}
      </div>
      <div class="stage-body">
        <h2 class="stage-title" id="stage-title">${headline}</h2>
        ${lines.map((line) => html`<p class="stage-line" key=${line}>${line}</p>`)}

        ${showWinners
          ? html`<${Reveal} reveal=${reveal} picks=${picks} entries=${entries} entryCount=${draw.entryCount} preview=${!data.winners} />`
          : null}

        ${st !== "drawn"
          ? html`<div class="stage-actions">
              <button class="btn btn-primary btn-big" type="button" disabled=${st !== "ready" || busy} onClick=${onDraw}>
                ${drawLabel}
              </button>
              ${st === "ready" && !peek
                ? html`<button class="btn btn-quiet" type="button" disabled=${busy} onClick=${onPeek}>Peek in this browser</button>`
                : null}
            </div>`
          : reveal.done && receipt.picks
            ? html`<${ShareBar} receipt=${receipt} />`
            : null}
        ${st !== "drawn"
          ? html`<p class="stage-note">
              Drawing it live? Put the <a href=${receipt.embed} target="_blank" rel="noopener">stream view</a> in OBS
              first: it checks every 20 seconds and plays the reveal there once someone presses Draw.
            </p>`
          : null}
        ${action.hash ? html`<p class="stage-note">Draw transaction <${ChainLink} kind="tx" value=${action.hash} /></p>` : null}
        ${action.step === "error" ? html`<p class="stage-error" role="alert">${action.message}</p>` : null}
        ${peek && !data.winners
          ? html`<p class="stage-note">
              That is a preview computed here from round ${String(status.roundId)}'s dataHash. It becomes official, and
              identical, once someone presses Draw.
            </p>`
          : null}
      </div>
    </section>
  `;
}

function Timeline({ data, clock, run }) {
  const now = useNow(1000);
  const { draw, status } = data;
  const st = status.status;
  const target = Number(draw.targetRound);
  const settled = Number(status.settledThroughRound);
  const createdAt = new Date(Number(draw.createdAt) * 1000);
  const createdRound = roundAt(Number(draw.createdAt), clock.genesis, clock.duration);
  const startMs = roundStart(target, clock.genesis, clock.duration) * 1000;
  const endMs = roundEnd(target, clock.genesis, clock.duration) * 1000;
  const decided = st === "ready" || st === "drawn";

  const steps = [
    {
      title: "Tickets sealed",
      state: "done",
      note: `${draw.entryCount} entries locked in during round ${createdRound}, ${utcStamp(createdAt)}.`,
    },
    {
      title: `Round ${target} plays out`,
      state: now >= endMs ? "done" : "now",
      note:
        now < startMs
          ? `Starts ${utcClock(new Date(startMs))} (${relative(startMs, now)}).`
          : now < endMs
            ? `Running now, ends ${utcClock(new Date(endMs))} (${countdown(endMs, now)} left).`
            : `Ran ${utcClock(new Date(startMs))} to ${utcClock(new Date(endMs))}.`,
    },
    {
      title: "The ledger settles it",
      state: settled >= target ? "done" : now >= endMs ? "now" : "todo",
      note:
        settled >= target
          ? `SqueekCore is settled through round ${settled}.`
          : `SqueekCore is settled through round ${settled}. Settlement lags a round by 10 to 20 minutes.`,
    },
    {
      title: "Squeektoshi runs",
      state: decided ? "done" : st === "asleep" ? "now" : "todo",
      note: decided
        ? `First run from round ${target} on: round ${String(status.roundId)}${run ? `, ${run.work} work units` : ""}.`
        : st === "asleep"
          ? `Asleep through round ${settled} so far. Zero-work rounds never count.`
          : "The first round from here on where he actually runs decides it.",
    },
    {
      title: "Winners drawn",
      state: st === "drawn" ? "done" : st === "ready" ? "now" : "todo",
      note:
        st === "drawn"
          ? `Written onchain in block ${String(draw.drawnBlock)}.`
          : st === "ready"
            ? "Fixed already. Waiting for anyone to press Draw."
            : "Anyone can press Draw once he has run.",
    },
  ];

  return html`
    <section class="timeline" aria-labelledby="timeline-title">
      <h2 class="mini-title" id="timeline-title">Where it stands</h2>
      <ol class="punches">
        ${steps.map(
          (step) => html`
            <li class=${`punch is-${step.state}`} key=${step.title}>
              <span class="punch-hole" aria-hidden="true"></span>
              <div>
                <p class="punch-title">
                  ${step.title}
                  <span class="sr-only"> (${step.state === "done" ? "done" : step.state === "now" ? "in progress" : "to come"})</span>
                </p>
                <p class="punch-note">${step.note}</p>
              </div>
            </li>
          `,
        )}
      </ol>
    </section>
  `;
}

function HostRecord({ id, draw }) {
  const [state, setState] = useState(null);
  useEffect(() => {
    readRaffleLogs({ host: draw.host, limit: 500 })
      .then((list) => setState({ list }))
      .catch(() => setState({ failed: true }));
  }, [draw.host]);

  if (!state) return html`<p class="loading-line">Checking this host's other raffles…</p>`;
  if (state.failed) return null;
  const others = state.list.filter((r) => r.id !== id);
  const twins = others.filter((r) => r.entriesHash === draw.entriesHash);
  return html`
    <section class="host-record" aria-labelledby="host-title">
      <h2 class="mini-title" id="host-title">Host record</h2>
      <p>
        ${others.length
          ? `This host has opened ${others.length + 1} raffles on this booth.`
          : "This is the only raffle this host has opened on this booth."}
      </p>
      ${twins.length
        ? html`<${Note} tone="warn" title="Same list, more than once">
            <p>
              ${twins.length} other raffle${twins.length > 1 ? "s" : ""} by this host use${twins.length > 1 ? "" : "s"} this exact entry list:
              ${" "}${twins.map((t, i) => html`${i ? ", " : ""}<a href=${`?id=${t.id}`}>No. ${String(t.id)}</a>`)}.
              A host could open several and only share the one they like, so look at all of them.
            </p>
          <//>`
        : null}
    </section>
  `;
}

function EntryBoard({ entries, picks }) {
  const [query, setQuery] = useState("");
  if (!entries) {
    return html`<${Note} tone="warn" title="Entry list unavailable">
      <p>The DrawCreated log with the entries could not be read from this RPC. Try another rpcUrl in config.js.</p>
    <//>`;
  }
  const rank = new Map((picks ?? []).map((index, i) => [index, i + 1]));
  const q = query.trim().toLowerCase();
  const rows = entries.map((text, index) => ({ text, index })).filter((row) => !q || row.text.toLowerCase().includes(q));
  return html`
    <section class="board" aria-labelledby="board-title">
      <div class="board-head">
        <h2 class="section-title" id="board-title">All ${entries.length} tickets</h2>
        <label class="board-search">
          <span class="sr-only">Find a name in the list</span>
          <input class="input" type="search" placeholder="Am I in? Type a name" value=${query} onInput=${(e) => setQuery(e.currentTarget.value)} />
        </label>
      </div>
      <p class="hint">Numbered from 000 in sealing order: the same indices the contract picks from.</p>
      ${q && !rows.length ? html`<p class="board-miss">No ticket matches “${query}”.</p>` : null}
      <ol class="entries">
        ${rows.map(
          (row) => html`
            <li key=${row.index} class=${rank.has(row.index) ? "is-winner" : undefined}>
              <span class="serial">${serial(row.index, 3)}</span>
              <span class="entry-text">${row.text}</span>
              ${rank.has(row.index) ? html`<span class="entry-rank">${ordinal(rank.get(row.index))}</span>` : null}
            </li>
          `,
        )}
      </ol>
    </section>
  `;
}
