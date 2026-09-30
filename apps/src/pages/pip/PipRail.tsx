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
};

/**
 * The rail of tools under the house: the shop, Pip's things, the garden,
 * Decorate (and the arcade, on its floor). Decorating turns it into the
 * mode's own rail: wallpaper, flooring and Done.
 */
export const PipRail = ({
  railRef,
  decorateRef,
  decorating,
  floorName,
  house,
  arcade,
  drawer,
  finishPanel,
  ripe,
  openShop,
  openDrawer,
  startDecorating,
  stopDecorating,
  toggleFinish,
  openArcade
}: PipRailProps) =>
  decorating ? (
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
        <button ref={decorateRef} type="button" className="pip-rail-key" data-walk="decorate" onClick={startDecorating}>
          <UiIcon name="decorate" size={22} />
          <span className="pip-rail-label">Decorate</span>
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
