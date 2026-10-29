// The public Squeekchain API. Big numbers arrive as decimal strings; "unavailable" means unknown, never zero.
import config from "../../config.js";

const etags = new Map();

/** GET with If-None-Match: a 304 reuses the last body we saw for that URL. */
export async function apiGet(path, { signal } = {}) {
  const url = `${config.api}${path}`;
  const cached = etags.get(url);
  const response = await fetch(url, {
    headers: cached ? { "If-None-Match": cached.etag } : {},
    cache: "no-store",
    signal,
  });
  if (response.status === 304 && cached) return cached.body;
  if (!response.ok) throw new Error(`The Squeekchain API answered ${response.status} for ${path}`);
  const body = await response.json();
  const etag = response.headers.get("ETag");
  if (etag) etags.set(url, { etag, body });
  return body;
}

const known = (value) => value !== null && value !== undefined && value !== "";
const big = (value) => (known(value) ? BigInt(value) : null);
const num = (value) => (known(value) ? Number(value) : null);

/** /v1/status, flattened. Every field is null when the API does not know it. */
export function readStatus(body) {
  const m = body?.measurement && body.measurement.status !== "unavailable" ? body.measurement : null;
  const anchor = body?.builder?.status === "available" ? body.builder.anchor : null;
  return {
    measured: Boolean(m),
    freshness: m?.freshness ?? null, // "online" | "stale"
    coreStatus: m?.coreStatus ?? null, // "IDLE" | "ACTIVE" | "COUNTER_FAULT"
    rpm: known(m?.rpmMilli) ? num(m.rpmMilli) / 1000 : null,
    metersPerSecond: known(m?.speedMmPerSecond) ? num(m.speedMmPerSecond) / 1000 : null,
    todayMeters: known(m?.distanceMm) ? num(m.distanceMm) / 1000 : null,
    observedAt: m?.observedAt ? new Date(m.observedAt) : null,
    settledThroughRound: big(anchor?.settledThroughRound),
    settledAt: anchor?.confirmedAt ? new Date(anchor.confirmedAt) : null,
  };
}

/** /v1/core: the live core address and its round clock. */
export function readCore(body) {
  if (!body || body.status === "unavailable") return null;
  const core = body.identities?.core;
  const genesis = num(body.configuration?.genesisTimestamp);
  const duration = num(body.configuration?.roundDuration);
  return {
    core: /^0x[0-9a-fA-F]{40}$/.test(core ?? "") ? core : null,
    genesisTimestamp: genesis,
    roundDuration: duration && duration > 0 ? duration : null,
    settledThroughRound: big(body.core?.settledThroughRound),
  };
}
