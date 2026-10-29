// index.html: the booth front (no ?id), one raffle (?id=N), or the practice booth (?practice).
// With no contract configured, the front of the booth is the practice draw, with the "booth closed" sign under it.
// Any of them with &embed=1 is the bare stream view instead (index.html marks the page with "is-embed").
import { boothAddress } from "../lib/contract.js";
import { StreamView } from "./embed.js";
import { BoothClosed, Home, HowItWorks } from "./home.js";
import { Footer, Marquee, Note, StatusStrip } from "./frame.js";
import { html } from "./html.js";
import { Practice } from "./practice.js";
import { RaffleView } from "./raffle.js";

/** undefined: no id in the URL; null: an id that cannot be a raffle; otherwise the id as a bigint. */
function idFromUrl() {
  const raw = new URLSearchParams(window.location.search).get("id");
  if (raw === null) return undefined;
  return /^[0-9]{1,15}$/.test(raw.trim()) && BigInt(raw.trim()) > 0n ? BigInt(raw.trim()) : null;
}

export function App() {
  const id = idFromUrl();
  const practice = new URLSearchParams(window.location.search).has("practice");
  if (document.documentElement.classList.contains("is-embed")) {
    document.title = id ? `Raffle No. ${id} · stream view · Hamster Draw` : "Stream view · Hamster Draw";
    return html`<${StreamView} id=${id} />`;
  }
  let view;
  if (id === undefined && (practice || !boothAddress)) {
    view = html`
      <${Practice} />
      ${boothAddress ? html`<${HowItWorks} />` : html`<${BoothClosed} practiceAbove=${true} />`}
    `;
  } else if (!boothAddress) view = html`<${BoothClosed} />`;
  else if (id === undefined) view = html`<${Home} />`;
  else if (id === null) {
    view = html`<${Note} tone="error" title="That is not a raffle number">
      <p>Raffle links look like <span class="mono">?id=7</span>. <a href="./">Back to the booth</a></p>
    <//>`;
  } else view = html`<${RaffleView} id=${id} />`;

  if (id) document.title = `Raffle No. ${id} · Hamster Draw`;
  else if (practice) document.title = "Practice draw · Hamster Draw";

  return html`
    <${Marquee} />
    <${StatusStrip} />
    <main id="main" class="wrap page">${view}</main>
    <${Footer} />
  `;
}
