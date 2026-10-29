// The proof receipt and the "Verify it yourself" panel. Real raffles and practice draws share both: the numbers
// differ, the rule and the checks do not. Each takes a receipt built by the raffle page or the practice booth:
// { practice, id, contract, core, entries, entriesHash, winners, entryCount, targetRound, round, roundNote,
//   dataHash, work, seed, picks, sealed: { block, tx } | null, drawn: { block, tx } | null }.
import { useState } from "preact/hooks";
import config from "../../config.js";
import { chain } from "../lib/chain.js";
import { firstRunFrom } from "../lib/contract.js";
import { explain } from "../lib/errors.js";
import { shortHex } from "../lib/format.js";
import { drawSeed, hashEntries, pickWinners } from "../lib/raffle-math.js";
import { Mark } from "./art.js";
import { ChainLink } from "./frame.js";
import { html } from "./html.js";

export function Proof({ receipt: r }) {
  const target = String(r.targetRound);
  const known = r.work !== null && r.work !== undefined ? ` (${r.work} work)` : "";
  return html`
    <section class=${`receipt${r.practice ? " is-practice" : ""}`} aria-labelledby="proof-title">
      <h2 class="receipt-title" id="proof-title">${r.practice ? "Practice receipt" : "Proof receipt"}</h2>
      <dl>
        <dt>Raffle</dt>
        <dd>
          ${r.practice
            ? html`Practice No. ${String(r.id)}, stand-in booth <span class="mono">${shortHex(r.contract)}</span> (nothing deployed)`
            : html`No. ${String(r.id)} on <${ChainLink} value=${r.contract} /> (${config.chainName})`}
        </dd>
        <dt>Entries hash</dt>
        <dd class="hash">${r.entriesHash}</dd>
        <dt>Sealed in</dt>
        <dd>
          ${r.practice
            ? "nowhere: a practice list is only hashed in this browser"
            : html`block ${String(r.sealed.block)}${r.sealed.tx ? html`, tx <${ChainLink} kind="tx" value=${r.sealed.tx} />` : ""}`}
        </dd>
        <dt>Target round</dt>
        <dd>${target}, ${r.practice ? "as if the list had been sealed just before it" : "the first round allowed to decide it"}</dd>
        <dt>Deciding round</dt>
        <dd>
          ${r.round
            ? `${String(r.round)}, ${r.practice ? r.roundNote : `the first round he ran from ${target} on`}${known}`
            : "not known yet"}
        </dd>
        <dt>dataHash</dt>
        <dd class="hash">${r.round ? r.dataHash : "–"}</dd>
        <dt>Seed</dt>
        <dd class="hash">${r.seed ?? "–"}</dd>
        <dt>Drawn in</dt>
        <dd>
          ${r.practice
            ? "this browser, by the contract's pick rule"
            : r.drawn
              ? html`block ${String(r.drawn.block)}${r.drawn.tx ? html`, tx <${ChainLink} kind="tx" value=${r.drawn.tx} />` : ""}`
              : "not yet"}
        </dd>
        <dt>SqueekCore</dt>
        <dd><${ChainLink} value=${r.core} /></dd>
      </dl>
    </section>
  `;
}

export function Verify({ receipt: r }) {
  const [checks, setChecks] = useState(null);
  const [busy, setBusy] = useState(false);
  const ready = Boolean(r.seed && r.picks && r.round);
  const target = Number(r.targetRound);
  const plural = r.winners > 1 ? "s" : "";

  async function runChecks() {
    setBusy(true);
    const out = [];
    try {
      const recomputed = r.entries ? hashEntries(r.entries) : null;
      out.push({
        ok: recomputed === r.entriesHash,
        label: r.practice ? "Your list hashes to the entriesHash on the receipt" : "The logged entry list hashes to the sealed entriesHash",
      });
      const firstRun = await firstRunFrom(r.core, r.targetRound, r.round);
      out.push({
        ok: Boolean(firstRun) && firstRun.roundId === r.round && firstRun.dataHash === r.dataHash,
        label: `SqueekCore says round ${String(r.round)} is the first round he ran from round ${target} on, with this dataHash`,
      });
      const seed = drawSeed({ dataHash: r.dataHash, id: r.id, entriesHash: r.entriesHash, chainId: chain.id, contract: r.contract });
      out.push({
        ok: seed === r.seed,
        label: r.practice
          ? "The seed recomputes from dataHash, stand-in id 0, entriesHash, chain and stand-in booth"
          : "The seed recomputes from dataHash, id, entriesHash, chain and contract",
      });
      const picks = pickWinners(seed, r.winners, r.entryCount);
      out.push({
        ok: JSON.stringify(picks) === JSON.stringify(r.picks),
        label: `The pick rule gives the same ${r.winners} winner${plural}, in the same order`,
      });
    } catch (error) {
      out.push({ ok: false, label: `A check could not run: ${explain(error)}` });
    }
    setChecks(out);
    setBusy(false);
  }

  // Built as a plain string: htm trims newline whitespace inside templates, which would flatten a <pre>.
  const formula = [
    `seed   = keccak256(abi.encode(dataHash, ${String(r.id)}, entriesHash,`,
    `                              ${chain.id}, ${shortHex(r.contract)}))`,
    `pick i = keccak256(abi.encode(seed, i, attempt)) mod ${r.entryCount}`,
    `         attempt 0, 1, 2... until it lands on a fresh index`,
  ].join("\n");

  return html`
    <details class="verify">
      <summary>Verify it yourself</summary>
      <p>
        Nothing here needs trusting this website. The winners follow from public data with two hashes:
      </p>
      <pre class="formula">${formula}</pre>
      <p>
        dataHash is what SqueekCore recorded for the deciding round. Indices count from 000 in the order the entries
        ${r.practice ? " were pasted" : " were sealed"}.${r.practice ? " Practice draws use raffle id 0 and the zero address where a real booth puts its own." : ""}
      </p>
      ${ready
        ? html`<button class="btn btn-small" type="button" onClick=${runChecks} disabled=${busy}>
            ${busy ? "Checking…" : "Run the checks in this browser"}
          </button>`
        : html`<p class="hint">The four checks unlock once the raffle is drawn.</p>`}
      ${checks
        ? html`<ul class="checks">
            ${checks.map((c) => html`<li class=${c.ok ? "is-ok" : "is-bad"} key=${c.label}><${Mark} ok=${c.ok} /><span>${c.label}</span></li>`)}
          </ul>`
        : null}
      <p class="hint">
        ${r.practice
          ? html`With your own tools: <code>roundPage(${target - 1}, ${String(r.round)}, 1)</code> on SqueekCore gives the
              dataHash, and any HamsterDraw booth's pure <code>pickWinners(seed, ${r.winners}, ${r.entryCount})</code> view gives
              the same list for this seed.`
          : html`With your own tools: call <code>getDraw(${String(r.id)})</code> on the booth,${" "}
              <code>roundPage(${target - 1}, deciding round, 1)</code> on SqueekCore, then${" "}
              <code>pickWinners(seed, ${r.winners}, ${r.entryCount})</code> from the explorer's Read tab.`}
      </p>
    </details>
  `;
}
