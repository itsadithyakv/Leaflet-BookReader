import { useEffect, useRef, useState } from "react";
import { pushBackLayer } from "../platform/back";

/**
 * Android's Back closes this while `open`, the same as its Escape does: put
 * beside a dialog's Escape handler. `close` may answer `false` when it could
 * not close (a download running, say); the layer is then put back on top, so
 * the next press asks again rather than going past it to the page beneath.
 */
export const useBackClose = (open: boolean, close: () => boolean | void) => {
  const latest = useRef(close);
  latest.current = close;
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!open) return undefined;
    return pushBackLayer(() => {
      if (latest.current() === false) setRound((value) => value + 1);
    });
  }, [open, round]);
};
