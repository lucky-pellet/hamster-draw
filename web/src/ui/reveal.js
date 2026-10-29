// The reveal: winners leave the drum one at a time. Names flicker past in a dashed slot, then the ticket lands.
// It is theatre only: the winners are fixed before it starts, and the flicker is a fixed shuffle, not a draw.
// With reduced motion there is no spinning and no flicker; the winners still arrive in order, a beat apart.
import { useEffect, useState } from "preact/hooks";
import config from "../../config.js";
import { entryLink, ordinal, serial } from "../lib/format.js";
import { html } from "./html.js";

const FRAME_MS = 90;
const calmPreferred = () => Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

/** When each of `count` winners lands, in ms from the start. The first three get a proper drum roll. */
export function revealSchedule(count, calm) {
  const quick = Math.max(70, Math.min(260, Math.round(3000 / Math.max(1, count - 3))));
  const lands = [];
  let t = calm ? 150 : 300;
  for (let i = 0; i < count; i++) {
    const headline = i < 3;
    t += calm ? (headline ? 500 : 110) : headline ? 950 : quick;
    lands.push(t);
    if (!calm) t += headline ? 300 : 40;
  }
  return lands;
}

/**
 * Drives one reveal of `picks`. It plays when the picks first appear or change, when `playKey` changes,
 * and on replay(). Returns { shown, rolling, frame, calm, done, total, replay, skip }.
 */
export function useReveal(picks, playKey = 0) {
  const total = picks?.length ?? 0;
  const [run, setRun] = useState(0);
  const playId = `${total ? picks.join(",") : ""}|${playKey}|${run}`;
  const [skippedId, setSkippedId] = useState("");
  const [view, setView] = useState({ shown: 0, rolling: false, frame: 0, calm: false });

  useEffect(() => {
    if (!total) {
      setView({ shown: 0, rolling: false, frame: 0, calm: false });
      return undefined;
    }
    const calm = calmPreferred();
    if (skippedId === playId) {
      setView({ shown: total, rolling: false, frame: 0, calm });
      return undefined;
    }
    const lands = revealSchedule(total, calm);
    const started = Date.now();
    let timer = 0;
    const tick = () => {
      const t = Date.now() - started;
      let shown = 0;
      while (shown < total && lands[shown] <= t) shown += 1;
      setView({ shown, rolling: shown < total, frame: Math.floor(t / FRAME_MS), calm });
      if (shown >= total) clearInterval(timer);
    };
    timer = setInterval(tick, FRAME_MS);
    tick();
    return () => clearInterval(timer);
  }, [playId, skippedId]);

  return {
    ...view,
    total,
    done: total > 0 && view.shown >= total && !view.rolling,
    replay: () => setRun((n) => n + 1),
    skip: () => setSkippedId(playId),
  };
}

const nameAt = (entries, index) => entries?.[index] ?? `ticket ${serial(index, 3)}`;

function WinnerRow({ index, rank, text }) {
  const link = entryLink(text, config.explorer);
  return html`
    <li class="winner">
      <span class="winner-rank">${ordinal(rank)}</span>
      <span class="winner-name">
        ${link ? html`<a href=${link.href} target="_blank" rel="noopener noreferrer" title=${`Open ${link.label}`}>${text}</a>` : text}
      </span>
      <span class="winner-serial">No. ${serial(index, 3)}</span>
    </li>
  `;
}

/** The winners list as the reveal fills it, plus Skip / Replay. `preview` styles a not-yet-official result. */
export function Reveal({ reveal, picks, entries, entryCount, preview = false }) {
  if (!picks?.length) return null;
  const { shown, rolling, frame, calm } = reveal;
  const pool = entries?.length || Number(entryCount) || 1;
  const flicker = calm ? "…" : nameAt(entries, ((frame + 1) * 2654435761 + shown * 40503) % pool);
  const latest = shown ? nameAt(entries, picks[shown - 1]) : "";
  return html`
    <div class="reveal">
      <ol class=${`winners is-live${preview ? " is-preview" : ""}`} aria-label="Winners, in pick order">
        ${picks.slice(0, shown).map((index, i) => html`<${WinnerRow} key=${index} index=${index} rank=${i + 1} text=${nameAt(entries, index)} />`)}
        ${rolling
          ? html`<li class=${`winner is-rolling${calm ? " is-calm" : ""}`} key="rolling" aria-hidden="true">
              <span class="winner-rank">${ordinal(shown + 1)}</span>
              <span class="winner-name">${flicker}</span>
              <span class="winner-serial">No. ···</span>
            </li>`
          : null}
      </ol>
      <p class="sr-only" aria-live="polite">
        ${shown ? `${ordinal(shown)} winner: ${latest}.` : "Drawing the first winner."}${reveal.done ? ` All ${picks.length} drawn.` : ""}
      </p>
      <div class="reveal-tools">
        ${rolling
          ? html`<button type="button" class="btn btn-small btn-quiet" onClick=${reveal.skip}>Skip to the winners</button>`
          : reveal.done
            ? html`<button type="button" class="btn btn-small btn-quiet" onClick=${reveal.replay}>Replay the draw</button>`
            : null}
      </div>
    </div>
  `;
}
