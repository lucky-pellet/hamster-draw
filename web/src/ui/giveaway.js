// The X giveaway helper, folded under a raffle's entry list: paste what you copied from x.com and it pulls out
// the handles, says what it left out and why, and fills the list. The pasted text never leaves this browser and
// never becomes markup: it only goes through extractHandles() as a string.
import { useId, useMemo, useState } from "preact/hooks";
import { LIMITS } from "../lib/entries.js";
import { DROP_REASONS, extractHandles, SAMPLE_HOST, SAMPLE_THREAD } from "../lib/handles.js";
import { html } from "./html.js";

const SHOWN = 6;

const READ_AS = {
  posts: (counted) =>
    counted
      ? "Read as copied posts. Counting who posted and everyone they tagged."
      : "Read as copied posts. Counting who posted, not who they tagged or replied to.",
  list: () => "Read as a list. Every handle counts.",
  bare: () => "No @ anywhere, so each line is read as one handle.",
  empty: () => "Paste a reply thread, a quote list, a reposts list or any list of handles.",
};

/** Enter in a field would submit the raffle form around the helper (and open the wallet). */
const noSubmit = (e) => {
  if (e.key === "Enter") e.preventDefault();
};

function DropGroup({ reason, items }) {
  const extra = items.length - SHOWN;
  const listed = items
    .slice(0, SHOWN)
    .map((d) => `${d.text}${d.count > 1 ? ` ×${d.count}` : ""}`)
    .join(", ");
  return html`
    <li>
      <span class="x-why">${DROP_REASONS[reason]}</span>
      <span class="x-what">${listed}${extra > 0 ? ` and ${extra} more` : ""}</span>
    </li>
  `;
}

/** `onUse(handles)` gets the "@name" list to put in the raffle. */
export function XHelper({ onUse }) {
  const [paste, setPaste] = useState("");
  const [host, setHost] = useState("");
  const [tagged, setTagged] = useState("auto");
  const [used, setUsed] = useState(null);
  const pasteId = useId();
  const result = useMemo(() => extractHandles(paste, { host, tagged }), [paste, host, tagged]);
  const { handles } = result;

  const groups = [];
  for (const d of result.dropped) {
    if (groups.at(-1)?.reason !== d.reason) groups.push({ reason: d.reason, items: [] });
    groups.at(-1).items.push(d);
  }
  const edit = (setter) => (e) => {
    setter(e.currentTarget.value);
    setUsed(null);
  };
  const trySample = () => {
    setPaste(SAMPLE_THREAD);
    setHost(SAMPLE_HOST);
    setTagged("auto");
    setUsed(null);
  };
  const use = () => {
    onUse(handles);
    setUsed(handles.length);
  };

  return html`
    <details class="x-helper">
      <summary>Giveaway on X? Pull the handles out of a thread</summary>
      <div class="x-helper-body">
        <p class="hint">
          On x.com, open the post, scroll until every reply has loaded, select from the first reply to the last and
          copy. Quote lists, reposts lists and plain lists of handles work too. It all stays in this browser.
        </p>
        <div class="field">
          <span class="field-label">
            <label for=${pasteId}>What you copied</label>
            <button type="button" class="chip chip-action" onClick=${trySample}>Try a made-up thread</button>
          </span>
          <textarea
            id=${pasteId}
            class="textarea x-paste"
            name="x-paste"
            rows="7"
            spellcheck="false"
            placeholder=${"Night-shift Nadia\n@nadia_nights\n·\n1h\nReplying to @you\nin! bringing @a_friend"}
            value=${paste}
            onInput=${edit(setPaste)}
          ></textarea>
        </div>
        <label class="field">
          <span class="field-label">
            <span>Your handle <span class="field-optional">left out of the draw</span></span>
          </span>
          <input
            class="input mono"
            type="text"
            name="x-host"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            placeholder="@yourhandle"
            value=${host}
            onInput=${edit(setHost)}
            onKeyDown=${noSubmit}
          />
        </label>
        ${result.hostProblem
          ? html`<p class="stub-text stub-warn">That is not an X handle (1 to 15 letters, digits or _), so nobody is left out for it yet.</p>`
          : null}
        ${result.busiest
          ? html`<p class="x-guess">
              <span><span class="mono">${result.busiest.handle}</span> shows up ${result.busiest.count} times. Is that you?</span>
              <button
                type="button"
                class="chip chip-action"
                onClick=${() => {
                  setHost(result.busiest.handle);
                  setUsed(null);
                }}
              >
                Leave ${result.busiest.handle} out
              </button>
            </p>`
          : null}

        <div class="parse-line" aria-live="polite">
          <span class="parse-count"><b>${handles.length}</b> ${handles.length === 1 ? "handle" : "handles"}</span>
          <span class="x-read">${READ_AS[result.readAs](result.taggedCounted)}</span>
        </div>
        ${result.readAs === "posts" && result.taggedFound
          ? html`<label class="x-check">
              <input
                type="checkbox"
                checked=${result.taggedCounted}
                onChange=${(e) => {
                  setTagged(e.currentTarget.checked);
                  setUsed(null);
                }}
              />
              <span>Count handles tagged inside posts too</span>
            </label>`
          : null}
        ${groups.length
          ? html`<div class="x-drops">
              <p class="stub-label">Left out</p>
              <ul>${groups.map((g) => html`<${DropGroup} key=${g.reason} reason=${g.reason} items=${g.items} />`)}</ul>
            </div>`
          : null}
        ${handles.length > LIMITS.maxEntries
          ? html`<p class="stub-text stub-warn">That is ${handles.length} handles; a raffle takes at most ${LIMITS.maxEntries}.</p>`
          : null}

        <div class="x-actions">
          <button type="button" class="btn btn-green btn-small" disabled=${!handles.length} onClick=${use}>
            ${handles.length ? `Put ${handles.length} handle${handles.length === 1 ? "" : "s"} in the list` : "No handles yet"}
          </button>
          ${used !== null
            ? html`<span class="hint" role="status">Done: the list above now holds those ${used}, and nothing else.</span>`
            : handles.length
              ? html`<span class="hint">Replaces the list above.</span>`
              : null}
        </div>
      </div>
    </details>
  `;
}
