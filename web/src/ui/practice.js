// The practice booth: paste a list, pick how many win, and the contract's own rule draws them in this browser
// from a round Squeektoshi has already run. No wallet, no contract, nothing sealed or sent anywhere.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import config from "../../config.js";
import { boothAddress, firstRunFrom, latestRun, readBoothInfo } from "../lib/contract.js";
import { byteLength, LIMITS, looksCommaSeparated, maxWinnersFor, parseEntries } from "../lib/entries.js";
import { explain } from "../lib/errors.js";
import { clockFrom, useHamster, useNow } from "../lib/feed.js";
import { distance, relative, serial, utcStamp } from "../lib/format.js";
import { PRACTICE, practiceDraw, practiceLink, readPracticeLink, SAMPLE_LIST } from "../lib/practice.js";
import { METERS_PER_WORK, roundEnd } from "../lib/rounds.js";
import { apiGet, readCore } from "../lib/squeek-api.js";
import { Drum, Hamster } from "./art.js";
import { XHelper } from "./giveaway.js";
import { html } from "./html.js";
import { Proof, Verify } from "./proof.js";
import { Reveal, useReveal } from "./reveal.js";
import { ShareBar } from "./share.js";

const calm = () => Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
const pageBase = () => `${window.location.origin}${window.location.pathname}`;

/** The SqueekCore to read: the booth's own when one is deployed, else the API's live core, else the fallback. */
async function practiceCore() {
  if (boothAddress) {
    const info = await readBoothInfo().catch(() => null);
    if (info?.live) return { core: info.core, from: "booth" };
  }
  const live = await apiGet("/core")
    .then(readCore)
    .catch(() => null);
  if (live?.core) return { core: live.core, from: "api" };
  return { core: config.fallback.core, from: "fallback" };
}

/** The round that decides practice draws: the one a shared link pins, else his latest settled run. */
export function useDecidingRound(pinned) {
  const [state, setState] = useState({ step: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({ step: "loading" });
    (async () => {
      const { core, from } = await practiceCore();
      try {
        let run = null;
        let note = null;
        if (pinned) {
          run = await firstRunFrom(core, pinned, pinned).catch(() => null);
          if (!run || run.roundId !== pinned) {
            run = null;
            note = `Your link points at round ${pinned}, which is not a settled round with wheel work here. This uses his latest run instead, so the winners may not match the link.`;
          }
        }
        const pinnedOk = Boolean(run);
        run ??= await latestRun(core);
        if (!alive) return;
        setState(run ? { step: "ready", core, from, run, pinned: pinnedOk, note } : { step: "none", core, from });
      } catch (error) {
        if (alive) setState({ step: "error", core, from, message: explain(error) });
      }
    })();
    return () => {
      alive = false;
    };
  }, [attempt]);
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}

function moodLine(feed) {
  const s = feed.status;
  if (s?.measured && s.freshness === "online" && s.coreStatus === "ACTIVE") {
    return "He is on the wheel as we speak. Rounds settle 10 to 20 minutes after they end, so this is the newest one the ledger has.";
  }
  if (s?.measured && s.freshness === "online") return "He is asleep right now, so this is the last round he ran. Sweet dreams, Squeektoshi.";
  return "The wheel sensor is not saying much right now, so this is simply the newest round the ledger has settled with work.";
}

function RoundStub({ source, clock, now, feed }) {
  if (source.step === "loading") {
    return html`<p class="loading-line">Reading the ledger for his latest run…</p>`;
  }
  if (source.step === "error") {
    return html`
      <div class="stub-block" role="alert">
        <p class="stub-text stub-warn">The ledger did not pick up.</p>
        <p class="stub-text">${source.message} The hamster's notebook is fine; the phone line to it is not.</p>
        <button class="btn btn-small" type="button" onClick=${source.retry}>Ring again</button>
      </div>
    `;
  }
  if (source.step === "none") {
    return html`
      <div class="stub-block practice-nap">
        <${Hamster} pose="asleep" size=${64} />
        <p class="stub-text">
          Not one round with wheel work in the last two weeks the ledger has settled. He is on a very long nap, and a
          practice draw needs a round he actually ran.
        </p>
      </div>
    `;
  }
  const { run } = source;
  const endMs = roundEnd(run.roundId, clock.genesisTimestamp, clock.roundDuration) * 1000;
  return html`
    <div class="stub-block">
      <span class="stub-label">Decided by</span>
      <p class="stub-text">
        Round <b>${String(run.roundId)}</b>, ${source.pinned ? "the round your link points at" : "his latest run"}:${" "}
        ${String(run.work)} work units, about ${distance(Number(run.work) * METERS_PER_WORK)} of wheel, ended${" "}
        ${utcStamp(new Date(endMs))} (${relative(endMs, now)}).
      </p>
    </div>
    <div class="stub-block">
      <span class="stub-label">Its dataHash, straight from SqueekCore</span>
      <span class="mono hash-wrap">${run.dataHash}</span>
    </div>
    <p class="stub-text">${source.pinned ? "Same round as the link, so the same list gives the same winners." : moodLine(feed)}</p>
    ${source.note ? html`<p class="stub-text stub-warn">${source.note}</p>` : null}
    ${source.from === "fallback"
      ? html`<p class="stub-fine">The Squeekchain API did not answer, so this reads the built-in SqueekCore address.</p>`
      : null}
  `;
}

export function Practice() {
  const fromLink = useMemo(() => readPracticeLink(window.location.hash), []);
  const source = useDecidingRound(fromLink.round);
  const feed = useHamster();
  const now = useNow(30_000);
  const clock = clockFrom(feed);
  const [title, setTitle] = useState(fromLink.title);
  const [text, setText] = useState(fromLink.list ?? SAMPLE_LIST);
  const [winners, setWinners] = useState(fromLink.winners ?? 3);
  const [tried, setTried] = useState(false);
  const [result, setResult] = useState(null);
  const [playKey, setPlayKey] = useState(0);
  const resultRef = useRef(null);
  const autoRan = useRef(false);

  const parsed = useMemo(() => parseEntries(text), [text]);
  const { entries } = parsed;
  const maxWinners = maxWinnersFor(entries.length);
  const pick = Math.min(Math.max(1, winners), Math.max(1, maxWinners));
  const cleanTitle = title.trim();
  const titleBytes = byteLength(cleanTitle);
  const reveal = useReveal(result?.picks ?? null, playKey);

  const problems = [];
  if (titleBytes > LIMITS.titleBytes) problems.push(`The title is ${titleBytes} bytes; a real raffle allows ${LIMITS.titleBytes}.`);
  if (entries.length < LIMITS.minEntries) problems.push("Add at least two names, one per line.");
  if (entries.length > LIMITS.maxEntries) problems.push(`That is ${entries.length} names; a raffle takes at most ${LIMITS.maxEntries}.`);
  if (parsed.tooLong.length) {
    problems.push(`${parsed.tooLong.length} line${parsed.tooLong.length > 1 ? "s are" : " is"} over ${LIMITS.entryBytes} bytes, which a real raffle would refuse.`);
  }

  function drawNow() {
    setTried(true);
    if (problems.length || source.step !== "ready") return;
    const { run, core, pinned } = source;
    const { entriesHash, seed, picks } = practiceDraw({ entries, winners: pick, dataHash: run.dataHash, chainId: config.chainId });
    setResult({ entries, winners: pick, entriesHash, seed, picks, run, core, pinned });
    setPlayKey((k) => k + 1);
  }

  // A shared link with a list replays its draw on arrival, once its round has loaded.
  useEffect(() => {
    if (autoRan.current || source.step !== "ready" || !fromLink.list) return;
    autoRan.current = true;
    if (!fromLink.round || source.pinned) drawNow();
  }, [source.step]);

  // Bring the drum into view for each draw.
  useEffect(() => {
    if (playKey) resultRef.current?.scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "start" });
  }, [playKey]);

  // Editing the list or the count makes the last result stale.
  const editList = (value) => {
    setText(value);
    setResult(null);
  };
  const editWinners = (value) => {
    setWinners(value);
    setResult(null);
  };
  const splitCommas = () => editList(text.split(",").map((part) => part.trim()).filter(Boolean).join("\n"));

  const receipt = result
    ? {
        practice: true,
        title: titleBytes <= LIMITS.titleBytes ? cleanTitle : "",
        id: PRACTICE.id,
        contract: PRACTICE.contract,
        chainId: config.chainId,
        chainName: config.chainName,
        core: result.core,
        entries: result.entries,
        entriesHash: result.entriesHash,
        winners: result.winners,
        entryCount: result.entries.length,
        targetRound: result.run.roundId,
        round: result.run.roundId,
        roundNote: result.pinned ? "the round your link points at" : "his latest run on the ledger",
        dataHash: result.run.dataHash,
        work: result.run.work,
        seed: result.seed,
        picks: result.picks,
        sealed: null,
        drawn: null,
      }
    : null;
  if (receipt) {
    const link = practiceLink(pageBase(), {
      round: receipt.round,
      winners: receipt.winners,
      title: receipt.title,
      entries: receipt.entries,
    });
    receipt.link = link.href;
    receipt.linkHasList = link.hasList;
    receipt.embed = link.embed;
  }

  const ready = source.step === "ready";
  const buttonLabel = ready
    ? `Draw ${pick} winner${pick > 1 ? "s" : ""} with round ${source.run.roundId}`
    : source.step === "loading"
      ? "Waiting for the ledger…"
      : "No round to draw with";

  return html`
    <section class="practice" id="practice" aria-labelledby="practice-title">
      <div class="section-head">
        <p class="kicker">Try it first · no wallet, no contract</p>
        <h2 class="section-title" id="practice-title">Practice draw</h2>
        <p class="practice-lede">
          Paste a list, pick how many win, and let a round Squeektoshi has already run choose them, right here in
          your browser. It is the contract's exact rule with a stand-in raffle number and booth address. Nothing
          is signed, sealed or sent anywhere.
        </p>
      </div>

      <form class="booth-card" onSubmit=${(e) => {
        e.preventDefault();
        drawNow();
      }} novalidate>
        <div class="booth-form">
          <label class="field">
            <span class="field-label">
              <span>What is it for? <span class="field-optional">optional</span></span>
              <span class=${`bytes${titleBytes > LIMITS.titleBytes ? " is-over" : ""}`}>${titleBytes}/${LIMITS.titleBytes} bytes</span>
            </span>
            <input
              class="input"
              type="text"
              name="practice-title"
              autocomplete="off"
              placeholder="Two seats on Friday's stream"
              value=${title}
              onInput=${(e) => setTitle(e.currentTarget.value)}
            />
          </label>

          <label class="field">
            <span class="field-label">
              <span>Names, one per line</span>
              <span class="bytes">max ${LIMITS.entryBytes} bytes each</span>
            </span>
            <textarea
              class="textarea"
              name="practice-entries"
              rows="9"
              spellcheck="false"
              placeholder="Paste handles, addresses or plain names"
              value=${text}
              onInput=${(e) => editList(e.currentTarget.value)}
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
            ${text
              ? html`<button type="button" class="chip chip-action" onClick=${() => editList("")}>Clear</button>`
              : html`<button type="button" class="chip chip-action" onClick=${() => editList(SAMPLE_LIST)}>Use the sample list</button>`}
          </div>
          ${parsed.tooLong.length
            ? html`<ul class="parse-errors">
                ${parsed.tooLong.slice(0, 5).map(
                  (row) => html`<li key=${row.line}>Line ${row.line} is ${row.bytes} bytes: <span class="mono">${row.value.slice(0, 40)}…</span></li>`,
                )}
              </ul>`
            : null}
          <p class="hint">The sample is made up. Paste your own list over it: same cleaning and limits as a real raffle.</p>
          <${XHelper} onUse=${(handles) => editList(handles.join("\n"))} />

          <div class="field field-inline">
            <span class="field-label"><span>Winners</span></span>
            <div class="stepper" role="group" aria-label="Number of winners">
              <button type="button" aria-label="One fewer winner" disabled=${pick <= 1} onClick=${() => editWinners(Math.max(1, pick - 1))}>−</button>
              <input
                type="number"
                inputmode="numeric"
                min="1"
                max=${Math.max(1, maxWinners)}
                value=${pick}
                aria-label="Winners"
                onInput=${(e) => editWinners(Number(e.currentTarget.value) || 1)}
              />
              <button type="button" aria-label="One more winner" disabled=${pick >= maxWinners} onClick=${() => editWinners(pick + 1)}>+</button>
            </div>
            <span class="hint">up to ${Math.max(1, maxWinners)} for this list</span>
          </div>
        </div>

        <aside class="booth-stub" aria-label="Practice draw details">
          <div class="stub-pair">
            <div><span class="stub-label">Tickets</span><span class="stub-num">${serial(entries.length, 3)}</span></div>
            <div><span class="stub-label">Winners</span><span class="stub-num">${serial(pick, 2)}</span></div>
          </div>
          <${RoundStub} source=${source} clock=${clock} now=${now} feed=${feed} />
          <button class="btn btn-primary btn-wide" type="submit" disabled=${!ready || reveal.rolling}>${buttonLabel}</button>
          ${tried && problems.length ? html`<ul class="parse-errors">${problems.map((p) => html`<li key=${p}>${p}</li>`)}</ul>` : null}
          <p class="stub-fine">
            Practice only. A finished round's dataHash is already public, so a host could reshuffle a list until
            they like the result. A real raffle seals the list before its round has even started.
          </p>
        </aside>
      </form>

      ${receipt
        ? html`
            <div class="practice-result" ref=${resultRef}>
              <div class="raffle-grid">
                <div class="raffle-main">
                  <section class="stage stage-practice" aria-labelledby="practice-stage-title">
                    <div class="stage-art">
                      <${Drum} spinning=${reveal.rolling && !reveal.calm} size=${210} />
                    </div>
                    <div class="stage-body">
                      <span class="practice-stamp">Practice draw</span>
                      <h2 class="stage-title" id="practice-stage-title">${reveal.done ? "The wheel has spoken" : "The drum is turning"}</h2>
                      <p class="stage-line">
                        Round ${String(receipt.round)}'s dataHash picks ${receipt.winners} of ${receipt.entryCount}. Same list,
                        same count, same round: same winners, every time. Change one name and the whole draw changes.
                      </p>
                      <${Reveal} reveal=${reveal} picks=${receipt.picks} entries=${receipt.entries} />
                      ${reveal.done ? html`<${ShareBar} receipt=${receipt} />` : null}
                      ${reveal.done && !receipt.linkHasList
                        ? html`<p class="stage-note">
                            This list is too long for a link, so the replay link carries the round and the winner count but
                            not the names. Whoever opens it pastes the same list to check.
                          </p>`
                        : null}
                    </div>
                  </section>
                </div>
                <aside class="raffle-side">
                  <${Proof} receipt=${receipt} />
                  <${Verify} receipt=${receipt} />
                </aside>
              </div>
            </div>
          `
        : null}
    </section>
  `;
}
