// Hooks shared by the booth pages.
import { useEffect, useState } from "preact/hooks";
import { boothAddress, readBoothInfo } from "../lib/contract.js";
import { clockFrom } from "../lib/feed.js";

/** The deployed booth's fixed facts (core, round clock), or null while loading / when not deployed. */
export function useBoothInfo() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    if (!boothAddress) return;
    readBoothInfo()
      .then(setInfo)
      .catch(() => setInfo({ live: false, unreachable: true }));
  }, []);
  return info;
}

/**
 * The round clock raffles are judged by: the booth contract's own copy when it is live (that is what
 * create() uses), otherwise the API's view of SqueekCore, otherwise the built-in fallback.
 */
export function clockOf(info, feed) {
  if (info?.live) return { genesisTimestamp: info.genesisTimestamp, roundDuration: info.roundDuration };
  return clockFrom(feed);
}

/** True when the booth reads the same SqueekCore the API describes (or we cannot tell yet). */
export function sameCoreAsApi(info, feed) {
  if (!info?.live || !feed.core?.core) return true;
  return info.core.toLowerCase() === feed.core.core.toLowerCase();
}
