// Hand-drawn SVG props for the booth. Static markup only: no data ever goes into these drawings.
import { html } from "./html.js";

/** Squeektoshi, curled up asleep or mid-sprint. */
export function Hamster({ pose = "asleep", size = 64, label }) {
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": "true" };
  if (pose === "running") {
    return html`
      <svg class="hamster is-running" viewBox="0 0 84 58" width=${size} height=${Math.round(size * 0.69)} ...${a11y}>
        <path class="hamster-line" d="M13 30 q-6 -1 -8 4" />
        <g class="hamster-legs legs-a"><path d="M25 42 l-5 9 M55 41 l4 9" /></g>
        <g class="hamster-legs legs-b"><path d="M31 43 l3 9 M49 42 l-3 9" /></g>
        <circle class="hamster-fur" cx="59" cy="14" r="5.5" />
        <circle class="hamster-ear" cx="59" cy="14" r="2.6" />
        <ellipse class="hamster-fur" cx="38" cy="31" rx="26" ry="14.5" />
        <circle class="hamster-fur" cx="63" cy="26" r="12" />
        <path class="hamster-belly" d="M24 40 q14 5 30 0" />
        <circle class="hamster-eye" cx="67" cy="22.5" r="2.3" />
        <circle class="hamster-nose" cx="74.6" cy="27.5" r="2.1" />
        <path class="hamster-line" d="M66 31 q3 2.5 7 0.5" />
      </svg>`;
  }
  return html`
    <svg class="hamster is-asleep" viewBox="0 0 84 58" width=${size} height=${Math.round(size * 0.69)} ...${a11y}>
      <text class="hamster-z z1" x="64" y="12">z</text>
      <text class="hamster-z z2" x="73" y="6">z</text>
      <circle class="hamster-fur" cx="55" cy="20" r="6" />
      <circle class="hamster-ear" cx="55" cy="20" r="2.8" />
      <path class="hamster-fur" d="M9 46 C5 28 23 14 42 15 C61 16 73 28 71 42 C70 50 61 53 41 53 C23 53 11 52 9 46 Z" />
      <path class="hamster-line" d="M57 33 q4 3.2 8.4 0" />
      <circle class="hamster-nose" cx="70.2" cy="37.5" r="2.2" />
      <path class="hamster-belly" d="M51 53 q4.5 -6.5 10 0" />
      <path class="hamster-belly" d="M18 44 q10 6 24 4" />
    </svg>`;
}

const SHELL = "166,82 133,139.2 67,139.2 34,82 67,24.8 133,24.8";
const INNER = "150,82 125,125.3 75,125.3 50,82 75,38.7 125,38.7";

/** The raffle drum. `spinning` turns the cage and tumbles the tickets inside. */
export function Drum({ spinning = false, size = 220 }) {
  return html`
    <svg
      class=${`drum${spinning ? " is-spinning" : ""}`}
      viewBox="0 0 200 176"
      width=${size}
      height=${Math.round(size * 0.88)}
      role="img"
      aria-label=${spinning ? "The raffle drum is spinning" : "The raffle drum"}
    >
      <g class="drum-stand">
        <path d="M100 84 L56 164 M100 84 L144 164" />
        <rect x="32" y="162" width="136" height="9" rx="2" />
      </g>
      <g class="drum-cage">
        <polygon class="drum-shell" points=${SHELL} />
        <polygon class="drum-wire" points=${INNER} />
        <path class="drum-spokes" d="M34 82 H166 M67 24.8 L133 139.2 M133 24.8 L67 139.2" />
        <g class="drum-tickets">
          <rect class="drum-ticket t-red" x="72" y="88" width="20" height="11" rx="1.5" transform="rotate(18 82 93)" />
          <rect class="drum-ticket t-green" x="106" y="62" width="20" height="11" rx="1.5" transform="rotate(-32 116 67)" />
          <rect class="drum-ticket t-paper" x="88" y="50" width="20" height="11" rx="1.5" transform="rotate(64 98 55)" />
          <rect class="drum-ticket t-red" x="112" y="98" width="20" height="11" rx="1.5" transform="rotate(-8 122 103)" />
          <rect class="drum-ticket t-paper" x="64" y="64" width="20" height="11" rx="1.5" transform="rotate(42 74 69)" />
          <rect class="drum-ticket t-green" x="90" y="110" width="20" height="11" rx="1.5" transform="rotate(-50 100 115)" />
        </g>
        <path class="drum-crank" d="M100 82 L152 112" />
        <circle class="drum-knob" cx="152" cy="112" r="7" />
      </g>
      <circle class="drum-axle" cx="100" cy="82" r="8" />
    </svg>`;
}

/** Inline check / cross marks for the verification list (shapes, not emoji). */
export function Mark({ ok }) {
  return ok
    ? html`<svg class="mark mark-ok" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10.5 l4 4 l8 -9" /></svg>`
    : html`<svg class="mark mark-bad" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5 l10 10 M15 5 l-10 10" /></svg>`;
}
