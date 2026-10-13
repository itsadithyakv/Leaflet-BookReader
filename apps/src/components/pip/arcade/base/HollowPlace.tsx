import { useEffect, useRef } from "react";
import { Gamepad2, House } from "lucide-react";
import { useBaseStore } from "../../../../store/baseStore";
import { BaseScreen, type CampGarden } from "./BaseScreen";
import { TipLayer } from "./Tips";

type HollowPlaceProps = {
  skin: string;
  outfit: readonly string[];
  /** How Pip is at home, 0 to 100, once it is known: the camp is told. */
  mood?: number;
  /** Into the burrow: Pip's rooms. */
  onInside: () => void;
  /** Up to the cabinet in the attic. */
  onArcade: () => void;
  /** The garden: its bed lies by the burrow, and this is the way to it. */
  garden?: CampGarden;
};

/**
 * The Hollow as Pip's tab.
 *
 * It was a game in the attic's cabinet, three taps from the tab that is
 * about Pip. It is where she lives: the clearing, with her burrow in it.
 * So the tab is the clearing, the whole of it, with no title over it and
 * no box round it: what there is to do is laid over the picture. Her rooms
 * are through the burrow's door (twice on the burrow, or the key in the
 * corner), the garden through its bed beside it, and the cabinet keeps the
 * games that are games.
 */
export const HollowPlace = ({ skin, outfit, mood, onInside, onArcade, garden }: HollowPlaceProps) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    void useBaseStore.getState().open();
  }, []);
  useEffect(() => {
    useBaseStore.getState().setMood(mood);
  }, [mood]);
  return (
    <div ref={rootRef} className="pip-arcade pip-hollow-place" role="region" aria-label="The Hollow, Pip's camp">
      <div className="pip-arcade-page">
        <BaseScreen
          skin={skin}
          outfit={outfit}
          onInside={onInside}
          onArcade={onArcade}
          garden={garden}
          corner={
            <>
              <button type="button" className="tactile-button flex items-center gap-1.5 px-3 py-1.5 text-xs" title="The cabinet in Pip's attic: three games and the word quiz" onClick={onArcade}>
                <Gamepad2 size={14} aria-hidden /> Arcade
              </button>
              <button
                type="button"
                className="tactile-button tactile-button-primary flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
                title="Into the burrow: Pip's rooms, her things, and the shop. Twice on the burrow does the same."
                onClick={onInside}
              >
                <House size={14} aria-hidden /> Go inside
              </button>
            </>
          }
        />
      </div>
      <TipLayer rootRef={rootRef} />
    </div>
  );
};
