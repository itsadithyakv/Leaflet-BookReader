import type { RefObject } from "react";
import { HandHeart, RotateCw, Tent } from "lucide-react";
import type { ShopRequest } from "../../components/pip/PipShop";
import { UiIcon } from "../../components/UiIcon";
import { useCampWaits } from "../../components/pip/arcade/base/CampExtras";
import type { Drawer, FinishPanel } from "./common";

type PipRailProps = {
  railRef: RefObject<HTMLElement>;
  decorateRef: RefObject<HTMLButtonElement>;
  decorating: boolean;
  /** The floor on screen. */
  floorName: string;
  /** Whether the house's art is there (the old single room, with its room styles, if not). */
  house: boolean;
  /** The floor has the arcade cabinet. */
  arcade: boolean;
  /** The floor is the reader's to decorate (a floor only visited is not). */
  canDecorate: boolean;
  drawer: Drawer | null;
  finishPanel: FinishPanel | null;
  /** Garden plots ripe to pick. */
  ripe: number;
  openShop: (request: ShopRequest) => void;
  openDrawer: (id: Drawer) => void;
  startDecorating: () => void;
  stopDecorating: () => void;
  toggleFinish: (which: FinishPanel) => void;
  openArcade: () => void;
  /** Out of the house, to Pip's camp in the woods (the Hollow). */
  openCamp: () => void;
  /** The rail is showing the ways to play with Pip. */
  playing: boolean;
  startPlaying: () => void;
  stopPlaying: () => void;
  /** Plays with Pip as a hand would: every way has a key, so none needs a pointer. */
  playWith: (how: "pet" | "cuddle" | "tickle" | "highfive" | "spin" | "ball" | "toss" | "dance" | "bed") => void;
  /** Pip's snacks, to give her one. */
  openSnacks: () => void;
};

/**
 * The rail of tools under the house: the shop, Pip's things, the garden,
 * Play, Decorate, the way out to her camp (and the arcade, on its floor). Decorating turns it into the
 * mode's own rail: wallpaper, flooring and Done. Play does the same: a key
 * for each way of playing with Pip, which the hand can also do on Pip herself.
 */
export const PipRail = ({
  railRef,
  decorateRef,
  decorating,
  floorName,
  house,
  arcade,
  canDecorate,
  drawer,
  finishPanel,
  ripe,
  openShop,
  openDrawer,
  startDecorating,
  stopDecorating,
  toggleFinish,
  openArcade,
  openCamp,
  playing,
  startPlaying,
  stopPlaying,
  playWith,
  openSnacks
}: PipRailProps) => {
  const campWaits = useCampWaits();
  return playing && !decorating ? (
    <nav ref={railRef} className="pip-rail" aria-label="Playing with Pip">
      <div className="pip-rail-belt pip-rail-decorate pip-rail-playing">
        <p className="pip-rail-mode">
          <UiIcon name="hand" size={20} />
          <span>
            <strong>Playing with Pip</strong>
            <span className="pip-rail-mode-hint">Or use your hand: poke her, stroke her, pick her up by the leaf.</span>
          </span>
        </p>
        <button type="button" className="pip-rail-key" onClick={() => playWith("pet")} title="Stroke Pip">
          <UiIcon name="heart" size={20} />
          <span className="pip-rail-label">Pet</span>
        </button>
        <button type="button" className="pip-rail-key" onClick={() => playWith("cuddle")} title="Cuddle Pip (or press and hold her)">
          <HandHeart size={20} aria-hidden />
          <span className="pip-rail-label">Cuddle</span>
        </button>
        <button type="button" className="pip-rail-key" onClick={() => playWith("tickle")} title="Tickle Pip (rub her leaf instead and she sneezes)">
          <UiIcon name="sparkle" size={20} />
          <span className="pip-rail-label">Tickle</span>
        </button>
        <button type="button" className="pip-rail-key" onClick={() => playWith("highfive")} title="A high five (or tap her twice, quickly)">
          <UiIcon name="hand" size={20} />
          <span className="pip-rail-label">High 5</span>
        </button>
        <button type="button" className="pip-rail-key" onClick={() => playWith("spin")} title="Spin Pip giddy (or swing her round in your hand)">
          <RotateCw size={20} aria-hidden />
          <span className="pip-rail-label">Spin</span>
        </button>
        <button type="button" className="pip-rail-key" onClick={() => playWith("toss")} title="Toss Pip into the air">
          <UiIcon name="up" size={20} />
          <span className="pip-rail-label">Toss</span>
        </button>
        <button type="button" className="pip-rail-key" onClick={() => playWith("ball")} title="Toss Pip the ball: she throws it back (or throw it by hand)">
          <UiIcon name="goal" size={20} />
          <span className="pip-rail-label">Ball</span>
        </button>
        <button type="button" className="pip-rail-key" onClick={() => playWith("dance")} title="Dance with Pip">
          <UiIcon name="move" size={20} />
          <span className="pip-rail-label">Dance</span>
        </button>
        <button type="button" className="pip-rail-key" onClick={() => playWith("bed")} title="Send Pip to bed, or get her up">
          <UiIcon name="moon" size={20} />
          <span className="pip-rail-label">Bed</span>
        </button>
        <button type="button" className="pip-rail-key" onClick={openSnacks} title="Give Pip a snack or a toy">
          <UiIcon name="treat" size={20} />
          <span className="pip-rail-label">Snack</span>
        </button>
        <button type="button" className="pip-rail-key pip-rail-done" onClick={stopPlaying}>
          <UiIcon name="check" size={20} />
          <span className="pip-rail-label">Done</span>
        </button>
      </div>
    </nav>
  ) : decorating ? (
    <nav ref={railRef} className="pip-rail" aria-label="Decorating">
      <div className="pip-rail-belt pip-rail-decorate">
        <p className="pip-rail-mode">
          <UiIcon name="decorate" size={20} />
          <span>
            <strong>Decorating the {floorName}</strong>
            <span className="pip-rail-mode-hint">Select a pin to choose what goes there.</span>
          </span>
        </p>
        <button type="button" className="pip-rail-key" aria-pressed={finishPanel === "wallpaper"} onClick={() => toggleFinish("wallpaper")}>
          <UiIcon name="grid" size={20} />
          <span className="pip-rail-label">{house ? "Wallpaper" : "Room style"}</span>
        </button>
        {house && (
          <button type="button" className="pip-rail-key" aria-pressed={finishPanel === "flooring"} onClick={() => toggleFinish("flooring")}>
            <UiIcon name="home" size={20} />
            <span className="pip-rail-label">Flooring</span>
          </button>
        )}
        <button type="button" className="pip-rail-key pip-rail-done" onClick={stopDecorating}>
          <UiIcon name="check" size={20} />
          <span className="pip-rail-label">Done</span>
        </button>
      </div>
    </nav>
  ) : (
    <nav ref={railRef} className="pip-rail" aria-label="Pip's tools">
      <div className="pip-rail-belt">
        <button type="button" className="pip-rail-key pip-rail-shop" data-walk="shop" onClick={() => openShop({ tab: "variants" })}>
          <UiIcon name="shop" size={22} />
          <span className="pip-rail-label">Shop</span>
        </button>
        <button type="button" className="pip-rail-key" aria-pressed={drawer === "things"} onClick={() => openDrawer("things")}>
          <UiIcon name="things" size={22} />
          <span className="pip-rail-label">Pip's things</span>
        </button>
        <button type="button" className="pip-rail-key" aria-pressed={drawer === "garden"} onClick={() => openDrawer("garden")}>
          <UiIcon name="garden" size={22} />
          <span className="pip-rail-label">Garden</span>
          {ripe > 0 && <span className="pip-hud-dot" aria-label={`${ripe} ripe`} />}
        </button>
        <button type="button" className="pip-rail-key" data-walk="play" onClick={startPlaying}>
          <UiIcon name="hand" size={22} />
          <span className="pip-rail-label">Play</span>
        </button>
        {canDecorate && (
          <button ref={decorateRef} type="button" className="pip-rail-key" data-walk="decorate" onClick={startDecorating}>
            <UiIcon name="decorate" size={22} />
            <span className="pip-rail-label">Decorate</span>
          </button>
        )}
        {/* The house is the burrow in the Hollow, so the way out is on every floor. */}
        <button type="button" className="pip-rail-key" onClick={openCamp} title="Out of the burrow, to the Hollow">
          <Tent size={22} aria-hidden />
          <span className="pip-rail-label">Outside</span>
          {campWaits && <span className="pip-hud-dot" aria-label="Something is waiting in the Hollow" />}
        </button>
        {arcade && (
          <button type="button" className="pip-rail-key pip-rail-play" onClick={() => openArcade()}>
            <UiIcon name="game" size={22} />
            <span className="pip-rail-label">Arcade</span>
          </button>
        )}
      </div>
    </nav>
  );
};
