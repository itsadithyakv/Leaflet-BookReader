import type { RefObject } from "react";
import type { ShopRequest } from "../../components/pip/PipShop";
import { UiIcon } from "../../components/UiIcon";
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
  /** The rail is showing the ways to play with Pip. */
  playing: boolean;
  startPlaying: () => void;
  stopPlaying: () => void;
  /** Plays with Pip as a hand would: every way has a key, so none needs a pointer. */
  playWith: (how: "pet" | "tickle" | "ball" | "toss" | "dance" | "bed") => void;
  /** Pip's snacks, to give her one. */
  openSnacks: () => void;
};

/**
 * The rail of tools under the house: the shop, Pip's things, the garden,
 * Play, Decorate (and the arcade, on its floor). Decorating turns it into the
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
  playing,
  startPlaying,
  stopPlaying,
  playWith,
  openSnacks
}: PipRailProps) =>
  playing && !decorating ? (
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
        <button type="button" className="pip-rail-key" onClick={() => playWith("tickle")} title="Tickle Pip">
          <UiIcon name="sparkle" size={20} />
          <span className="pip-rail-label">Tickle</span>
        </button>
        <button type="button" className="pip-rail-key" onClick={() => playWith("toss")} title="Toss Pip into the air">
          <UiIcon name="up" size={20} />
          <span className="pip-rail-label">Toss</span>
        </button>
        <button type="button" className="pip-rail-key" onClick={() => playWith("ball")} title="Throw the ball for Pip to fetch">
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
        {arcade && (
          <button type="button" className="pip-rail-key pip-rail-play" onClick={() => openArcade()}>
            <UiIcon name="game" size={22} />
            <span className="pip-rail-label">Arcade</span>
          </button>
        )}
      </div>
    </nav>
  );
