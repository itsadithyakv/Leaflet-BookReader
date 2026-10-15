import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { usePipStore } from "../store/pipStore";
import { useEquippedPip } from "../store/pipWardrobeStore";
import { PipSprite } from "./PipSprite";
import { PipSay } from "./PipSay";
import { useMediaQuery } from "../hooks/useMediaQuery";

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
  // A phone's screen is small: she peeks smaller there.
  const small = useMediaQuery("(max-width: 767px), (max-height: 520px)");
  const ref = useRef<HTMLButtonElement | null>(null);

  // Never over the reader's own controls at the foot of the page (a phone's chapter dock is most of its width):
  // where she would stand on them, she stands on top of them instead.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.removeProperty("bottom");
    const me = el.getBoundingClientRect();
    const docks = Array.from(document.querySelectorAll(".reader-chapter-dock, .pdf-notes-dock"))
      .map((dock) => dock.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.left < me.right && r.right > me.left && r.top < me.bottom && r.bottom > me.top);
    if (docks.length === 0) return;
    const top = Math.min(...docks.map((r) => r.top));
    el.style.bottom = `${Math.max(0, window.innerHeight - top + 6)}px`;
  }, [peek?.id, small]);

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
      ref={ref}
      type="button"
      className={`pip-peek ${leaving ? "pip-peek-leaving" : ""}`}
      onClick={leave}
      aria-label={`Pip: ${peek.line}. Dismiss`}
    >
      {peek.line && <PipSay text={peek.line} tailAt={88} className="pip-say-peek" />}
      <PipSprite
        move={peek.move}
        size={small ? 64 : 96}
        skin={equipped.skin}
        outfit={equipped.outfit}
        loops={peek.loops}
        playKey={peek.id}
        onDone={() => window.setTimeout(leave, LINGER_MS)}
      />
    </button>
  );
};
