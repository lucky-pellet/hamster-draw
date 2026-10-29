// Round clock and the hamster's habits. Times are unix seconds unless a name says otherwise.

/** floor((t - genesis) / duration) + 1, or 0 before genesis: the same rule as the contract. */
export const roundAt = (unixSeconds, genesis, duration) =>
  unixSeconds < genesis ? 0 : Math.floor((unixSeconds - genesis) / duration) + 1;

export const roundStart = (round, genesis, duration) => genesis + (Number(round) - 1) * duration;
export const roundEnd = (round, genesis, duration) => genesis + Number(round) * duration;

/** Settlement usually lands 10 to 20 minutes after a round ends. */
export const SETTLE_LAG_SECONDS = 15 * 60;

/** Wheel travel per work unit: 19,380,094 mm of wheel over 22,073 work units. */
export const METERS_PER_WORK = 0.878;

const HALF_HOUR_MS = 30 * 60 * 1000;

/** His usual shifts (UTC): 21:00 to 03:00 and 05:30 to 07:00. Used when the API has no week of data. */
function usualShifts() {
  return Array.from({ length: 48 }, (_, i) => {
    const minute = i * 30;
    return minute >= 21 * 60 || minute < 3 * 60 || (minute >= 5 * 60 + 30 && minute < 7 * 60);
  });
}

/**
 * When he is likely to run next: the start of the next half hour that was busy over the last week
 * (from /v1/measurement/stats typicalDay), else his usual shifts. Returns { at: Date, basis }.
 */
export function nextLikelyRun(nowMs, typicalDay) {
  let busy = null;
  let basis = "his usual shifts";
  if (Array.isArray(typicalDay) && typicalDay.length === 48) {
    const means = typicalDay.map((bucket) => Number(bucket?.meanWorkMilli ?? 0));
    const peak = Math.max(...means);
    if (peak > 0) {
      busy = means.map((mean) => mean >= peak * 0.15);
      basis = "the last week of wheel data";
    }
  }
  busy ??= usualShifts();

  const startOfBucket = Math.floor(nowMs / HALF_HOUR_MS) * HALF_HOUR_MS;
  const bucketOf = (ms) => new Date(ms).getUTCHours() * 2 + (new Date(ms).getUTCMinutes() >= 30 ? 1 : 0);
  for (let step = 1; step <= 48; step++) {
    const at = startOfBucket + step * HALF_HOUR_MS;
    if (busy[bucketOf(at)]) return { at: new Date(at), basis };
  }
  return { at: null, basis };
}
