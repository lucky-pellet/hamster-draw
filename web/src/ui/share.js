// Share a finished draw: post it on X through the web intent, or copy the results with their proof line.
import { useState } from "preact/hooks";
import { postText, resultsText, xIntentUrl } from "../lib/share-text.js";
import { html } from "./html.js";

export function ShareBar({ receipt }) {
  const [copied, setCopied] = useState("");
  const copy = async (what, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(""), 1800);
    } catch {
      setCopied("blocked");
    }
  };
  return html`
    <div class="share-bar">
      <a class="btn btn-green" href=${xIntentUrl(postText(receipt), receipt.link)} target="_blank" rel="noopener noreferrer">
        Post on X
      </a>
      <button class="btn" type="button" onClick=${() => copy("results", resultsText(receipt))}>
        ${copied === "results" ? "Copied" : "Copy results"}
      </button>
      <button class="btn btn-quiet" type="button" onClick=${() => copy("link", receipt.link)}>
        ${copied === "link" ? "Link copied" : receipt.practice ? "Copy replay link" : "Copy link"}
      </button>
      ${receipt.embed
        ? html`<a class="btn btn-quiet" href=${receipt.embed} target="_blank" rel="noopener" title="The bare reveal, for OBS or an iframe">
            Stream view
          </a>`
        : null}
      ${copied === "blocked" ? html`<span class="hint">Your browser blocked the clipboard.</span>` : null}
    </div>
  `;
}
