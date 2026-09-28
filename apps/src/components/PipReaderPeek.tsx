import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { usePipStore } from "../store/pipStore";
import { useEquippedPip } from "../store/pipWardrobeStore";
import { PipSprite } from "./PipSprite";
import { PipSay } from "./PipSay";

/** Long enough to read the line after the move ends, short enough to not linger. */
const LINGER_MS = 1800;

/**
 * Celebrations that happen mid-book. Pip peeks up from the bottom corner, does
 * its move, says one line, and leaves. It sits in the reader's margin, clear of
 * the text column, and selecting it dismisses it early.
 */
export const PipReaderPeek = () => {
  const { peek, clearPeek } = usePipStore(useShallow((state) => ({ peek: state.peek, clearPeek: state.clearPeek })));
  const [leaving, setLeaving] = useState(false);
  const equipped = useEquippedPip();

  useEffect(() => {
    setLeaving(false);
  }, [peek?.id]);

  useEffect(() => {
    if (!leaving || !peek) {
      return;
    }
    const id = peek.id;
    const timer = window.setTimeout(() => clearPeek(id), 350);
    return () => window.clearTimeout(timer);
  }, [leaving, peek, clearPeek]);

  if (!peek) {
    return null;
  }

  const leave = () => setLeaving(true);

  return (
    <button
      type="button"
      className={`pip-peek ${leaving ? "pip-peek-leaving" : ""}`}
      onClick={leave}
      aria-label={`Pip: ${peek.line}. Dismiss`}
    >
      {peek.line && <PipSay text={peek.line} tailAt={88} className="pip-say-peek" />}
      <PipSprite
        move={peek.move}
        size={96}
        skin={equipped.skin}
        outfit={equipped.outfit}
        loops={peek.loops}
        playKey={peek.id}
        onDone={() => window.setTimeout(leave, LINGER_MS)}
      />
    </button>
  );
};
