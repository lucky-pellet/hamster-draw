// One shared, polite poller for the hamster's live status. Components subscribe through useHamster().
import { useEffect, useState } from "preact/hooks";
import config from "../../config.js";
import { apiGet, readCore, readStatus } from "./squeek-api.js";

const STATUS_EVERY_MS = 15_000;

let snapshot = {
  status: null, // readStatus() result
  statusError: null,
  core: null, // readCore() result
  typicalDay: null, // 48 half-hour buckets from the last week
  checkedAt: null,
};
const listeners = new Set();
let started = false;

function publish(patch) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((listener) => listener(snapshot));
}

async function pollStatus() {
  try {
    publish({ status: readStatus(await apiGet("/status")), statusError: null, checkedAt: new Date() });
  } catch (error) {
    publish({ statusError: error, checkedAt: new Date() });
  }
}

function start() {
  if (started) return;
  started = true;
  pollStatus();
  setInterval(() => {
    if (!document.hidden) pollStatus();
  }, STATUS_EVERY_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) pollStatus();
  });
  apiGet("/core")
    .then((body) => publish({ core: readCore(body) }))
    .catch(() => publish({ core: null }));
  apiGet("/measurement/stats?range=7d")
    .then((body) => publish({ typicalDay: body?.activity?.typicalDay ?? null }))
    .catch(() => {});
}

/** Live hamster status, shared by every component that asks. */
export function useHamster() {
  const [state, setState] = useState(snapshot);
  useEffect(() => {
    listeners.add(setState);
    start();
    setState(snapshot);
    return () => listeners.delete(setState);
  }, []);
  return state;
}

/** The round clock: from the API's core configuration, else the configured fallback. */
export function clockFrom(feed) {
  const genesisTimestamp = feed.core?.genesisTimestamp ?? config.fallback.genesisTimestamp;
  const roundDuration = feed.core?.roundDuration ?? config.fallback.roundDuration;
  return { genesisTimestamp, roundDuration };
}

/** Re-renders every `ms` with the current time in milliseconds. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}
