import { useEffect, useRef, type ReactNode } from "react";
import { useBaseStore } from "../../../../store/baseStore";
import { BaseScreen, type CampGarden } from "./BaseScreen";
import { TipLayer } from "./Tips";
import { HollowCoach } from "../../onboarding/HollowCoach";
import type { HollowNav } from "./HollowMenu";

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
  /** First in the row of chips: the way to the rest of the app, where the tab fills the screen. (Since 1.5.10: `nav`, in the Hollow's menu.) */
  lead?: ReactNode;
  /** The rest of the app, in the Hollow's menu, where the tab fills a phone on its side. */
  nav?: HollowNav;
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
export const HollowPlace = ({ skin, outfit, mood, onInside, onArcade, garden, lead, nav }: HollowPlaceProps) => {
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
          lead={lead}
          nav={nav}
        />
      </div>
      <TipLayer rootRef={rootRef} />
      <HollowCoach rootRef={rootRef} skin={skin} outfit={outfit} />
    </div>
  );
};
