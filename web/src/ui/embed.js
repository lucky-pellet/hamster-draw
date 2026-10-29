// Stream view (?embed=1): only the drum, the reveal and the round that decided it, for an OBS browser source or
// an iframe. Add &bg=transparent to drop the cream page behind the card; index.html sets that class before the
// first paint, so a transparent source never flashes. A practice replay link (?practice&embed=1#r=...&l=...)
// draws on arrival. A real raffle (?id=7&embed=1) waits, checks every 20 seconds, and plays the reveal once
// someone has drawn it.
import { useEffect, useMemo, useState } from "preact/hooks";
import config from "../../config.js";
import { boothAddress, firstRunFrom, readBoothInfo, readRaffle, readRaffleStatus } from "../lib/contract.js";
import { maxWinnersFor, parseEntries } from "../lib/entries.js";
import { explain, FriendlyError } from "../lib/errors.js";
import { distance, serial, shortHex } from "../lib/format.js";
import { practiceDraw, readPracticeLink } from "../lib/practice.js";
import { METERS_PER_WORK } from "../lib/rounds.js";
import { Drum, Hamster } from "./art.js";
import { html } from "./html.js";
import { useDecidingRound } from "./practice.js";
import { Reveal, useReveal } from "./reveal.js";

const RETRY_MS = 20_000;

/** Inside OBS (which exposes window.obsstudio) or an iframe, the setup note stays hidden. */
const onAir = () => Boolean(window.obsstudio) || window.self !== window.top;

function pageWith(edit) {
  const url = new URL(window.location.href);
  edit(url.searchParams);
  return url.href;
}

function SetupNote() {
  const clear = pageWith((q) => q.set("bg", "transparent"));
  const full = pageWith((q) => {
    q.delete("embed");
    q.delete("bg");
  });
  return html`
    <aside class="embed-setup" aria-label="Stream view setup">
      <p>
        <b>Stream view.</b> In OBS, add a Browser source with this address (about 600 × 700) and tick “Refresh
        browser when scene becomes active”, so the draw plays each time you cut to it. This note does not show
        there or in an iframe.
      </p>
      <p><a href=${clear}>Transparent background</a> · <a href=${full}>Back to the full page</a></p>
    </aside>
  `;
}

function Card({ stamp, real = false, title, foot, children }) {
  return html`
    <article class=${`embed-card${real ? " is-real" : ""}`}>
      <div class="embed-top">
        <p class="embed-brand">Hamster <span>Draw</span></p>
        ${stamp ? html`<span class=${real ? "embed-no" : "practice-stamp"}>${stamp}</span>` : null}
      </div>
      ${title ? html`<h1 class="embed-title">${title}</h1>` : null}
      ${children}
      ${foot ? html`<p class="embed-foot">${foot}</p>` : null}
    </article>
  `;
}

/** A state with no winners yet: the still drum (or the hamster) and a line or two. */
function Pending({ art = "drum", headline, line }) {
  return html`
    <div class="embed-stage">
      ${art === "drum" ? html`<${Drum} size=${92} />` : html`<${Hamster} pose=${art} size=${96} />`}
      <div class="embed-facts">
        <p class="embed-line">${headline}</p>
        ${line ? html`<p class="embed-round">${line}</p>` : null}
      </div>
    </div>
  `;
}

function Drawn({ reveal, picks, entries, entryCount, round, work, dataHash }) {
  const known = work !== null && work !== undefined;
  return html`
    <div class="embed-stage">
      <${Drum} spinning=${reveal.rolling && !reveal.calm} size=${92} />
      <div class="embed-facts">
        <p class="embed-line">
          ${reveal.done ? "The wheel has spoken" : "The drum is turning"}: ${picks.length} of ${entryCount}
        </p>
        <p class="embed-round">
          Squeekchain round <b>${String(round)}</b>${known
            ? `, where he ran ${String(work)} work units (about ${distance(Number(work) * METERS_PER_WORK)} of wheel)`
            : ""}
        </p>
        <p class="embed-hash">dataHash ${shortHex(dataHash, 10, 6)}</p>
      </div>
    </div>
    <div class=${picks.length > 6 ? "embed-many" : undefined}>
      <${Reveal} reveal=${reveal} picks=${picks} entries=${entries} entryCount=${entryCount} />
    </div>
  `;
}

function EmbedPractice() {
  const link = useMemo(() => readPracticeLink(window.location.hash), []);
  const source = useDecidingRound(link.round);
  const entries = useMemo(() => (link.list ? parseEntries(link.list).entries : []), [link.list]);
  const winners = Math.min(Math.max(1, link.winners ?? 1), maxWinnersFor(entries.length));
  // A link pins its round. If that round cannot be read, drawing on another one would show other winners.
  const offRound = source.step === "ready" && Boolean(link.round) && !source.pinned;
  const roundId = source.run?.roundId;
  const result = useMemo(() => {
    if (source.step !== "ready" || offRound || winners < 1) return null;
    return practiceDraw({ entries, winners, dataHash: source.run.dataHash, chainId: config.chainId });
  }, [source.step, roundId, offRound, entries, winners]);
  const reveal = useReveal(result?.picks ?? null);

  // On air there is nobody to press "try again".
  useEffect(() => {
    if (source.step !== "error") return undefined;
    const timer = setTimeout(source.retry, RETRY_MS);
    return () => clearTimeout(timer);
  }, [source.step]);

  // The draw lives in the #fragment, read once. A page that swaps an iframe's fragment gets a fresh draw.
  useEffect(() => {
    const reload = () => window.location.reload();
    window.addEventListener("hashchange", reload);
    return () => window.removeEventListener("hashchange", reload);
  }, []);

  let body;
  if (!link.list) {
    body = html`<${Pending}
      headline="Nothing to draw yet"
      line="This link carries no list. Draw on the full page, then open its Stream view button."
    />`;
  } else if (winners < 1) {
    body = html`<${Pending} headline="Nothing to draw yet" line="A draw needs at least two names." />`;
  } else if (source.step === "loading") {
    body = html`<${Pending}
      headline="Reading the ledger…"
      line=${link.round ? `Fetching round ${link.round} from SqueekCore.` : "Finding his latest run on SqueekCore."}
    />`;
  } else if (source.step === "error") {
    body = html`<${Pending} headline="The ledger did not pick up" line=${`${source.message} Trying again in 20 seconds.`} />`;
  } else if (source.step === "none") {
    body = html`<${Pending}
      art="asleep"
      headline="He has not run in two weeks"
      line="A practice draw needs a round he actually ran."
    />`;
  } else if (offRound) {
    body = html`<${Pending}
      headline=${`Round ${link.round} is not on the ledger`}
      line="It is not a settled round with wheel work here, so this view will not draw: another round would pick other winners."
    />`;
  } else if (result) {
    body = html`<${Drawn}
      reveal=${reveal}
      picks=${result.picks}
      entries=${entries}
      entryCount=${entries.length}
      round=${source.run.roundId}
      work=${source.run.work}
      dataHash=${source.run.dataHash}
    />`;
  }
  return html`
    <${Card} stamp="Practice draw" title=${link.title} foot="Practice draw: same list, same round, same winners, every time.">
      ${body}
    <//>
  `;
}

/** A real raffle, re-checked every 20 seconds until it is drawn. */
function useRaffleFeed(id) {
  const [state, setState] = useState({ step: "loading" });
  useEffect(() => {
    let alive = true;
    let timer = 0;
    let data = null;
    const tick = async () => {
      try {
        if (!data) {
          const info = await readBoothInfo();
          if (!info.live) throw new FriendlyError(`There is no booth contract at ${boothAddress} on ${config.chainName}.`);
          data = { info, raffle: await readRaffle(id) };
        } else {
          const status = await readRaffleStatus(id);
          const raffle = status.status === "drawn" ? await readRaffle(id) : { ...data.raffle, status };
          data = { ...data, raffle };
        }
        if (alive) setState({ step: "ready", ...data });
      } catch (error) {
        if (alive && !data) setState({ step: "error", message: explain(error) });
      }
      if (alive && data?.raffle.status.status !== "drawn") timer = setTimeout(tick, RETRY_MS);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [String(id)]);
  return state;
}

function EmbedRaffle({ id }) {
  const feed = useRaffleFeed(id);
  const raffle = feed.raffle;
  const reveal = useReveal(raffle?.winners ?? null);
  const [work, setWork] = useState(null);
  const decider = raffle?.status.roundId ?? 0n;
  useEffect(() => {
    if (!feed.info?.core || !raffle || !decider) return;
    firstRunFrom(feed.info.core, raffle.draw.targetRound, decider)
      .then((run) => setWork(run?.work ?? null))
      .catch(() => setWork(null));
  }, [feed.info?.core, String(decider)]);

  const stamp = `Raffle No. ${serial(id)}`;
  const foot = `Check it yourself: ${window.location.host}${window.location.pathname}?id=${id}`;
  if (feed.step !== "ready") {
    return html`
      <${Card} stamp=${stamp} real=${true} foot=${foot}>
        ${feed.step === "loading"
          ? html`<${Pending} headline=${`Fetching raffle No. ${serial(id)} from ${config.chainName}…`} />`
          : html`<${Pending} headline="Could not open this raffle" line=${`${feed.message} Trying again every 20 seconds.`} />`}
      <//>
    `;
  }

  const { draw, status } = raffle;
  const target = String(draw.targetRound);
  let body;
  if (raffle.winners) {
    body = html`<${Drawn}
      reveal=${reveal}
      picks=${raffle.winners}
      entries=${raffle.entries}
      entryCount=${Number(draw.entryCount)}
      round=${status.roundId}
      work=${work}
      dataHash=${status.dataHash}
    />`;
  } else if (status.status === "ready") {
    body = html`<${Pending}
      headline=${`He ran in round ${status.roundId}`}
      line="The winners are already fixed. They come out of the drum here as soon as someone presses Draw."
    />`;
  } else if (status.status === "asleep") {
    body = html`<${Pending}
      art="asleep"
      headline="Squeektoshi is asleep"
      line=${`The first round he runs from round ${target} on picks the winners. This view checks every 20 seconds.`}
    />`;
  } else {
    body = html`<${Pending}
      headline=${`Sealed. Waiting for round ${target}`}
      line="Nobody knows what the wheel will record in it yet. The draw plays here once he runs and someone presses Draw."
    />`;
  }
  return html`
    <${Card} stamp=${stamp} real=${true} title=${draw.title} foot=${foot}>
      ${body}
    <//>
  `;
}

/** The whole page in stream view. `id` as App reads it: undefined, null (not a raffle number) or a bigint. */
export function StreamView({ id }) {
  let view;
  if (id === null) {
    view = html`<${Card}><${Pending} headline="That is not a raffle number" line="Stream links look like ?id=7&embed=1." /><//>`;
  } else if (id !== undefined && !boothAddress) {
    view = html`<${Card}>
      <${Pending}
        art="asleep"
        headline="Booth closed"
        line="This copy of Hamster Draw has no raffle contract yet. Practice draws have a stream view too."
      />
    <//>`;
  } else if (id !== undefined) {
    view = html`<${EmbedRaffle} id=${id} />`;
  } else {
    view = html`<${EmbedPractice} />`;
  }
  return html`
    <main class="embed" id="main">
      ${onAir() ? null : html`<${SetupNote} />`}
      ${view}
    </main>
  `;
}
