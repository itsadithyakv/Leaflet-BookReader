import type { ReactNode } from "react";
import { DoorOpen, Flower2, Hammer, House, Move, Nut, Pencil, Shield, Swords, Tent, Users } from "lucide-react";
import { Sprite } from "./Sprite";

/** The Build panel's four tabs, by what a thing is for (1.5.10: they were four keys of the dock). */
export type BuildTab = "camp" | "defence" | "people" | "decor";
export const BUILD_TABS: ReadonlyArray<{ id: BuildTab; name: string; icon: typeof House }> = [
  { id: "camp", name: "Camp", icon: House },
  { id: "defence", name: "Defence", icon: Shield },
  { id: "people", name: "People", icon: Users },
  { id: "decor", name: "Decor", icon: Flower2 }
];

/** What Edit does to a tap on the picture: move buildings, slide the wall along the trail (1.5.11: it was laying fence), or set decorations down. */
export type EditMode = "move" | "fence" | "decor";

type CampDock = {
  where: "camp";
  buildOpen: boolean;
  onBuild: () => void;
  /** Something on the Build panel waits (acorns on the oak), or the next goal is done there. */
  buildMark: "nudge" | "waiting" | null;
  raid: { open: boolean; rested: number; nudge: boolean; onRaid: () => void } | null;
  onEdit: (() => void) | null;
  /** The next goal is done in Edit (lay fence, set a decoration down). */
  editMark?: boolean;
};
type EditDock = {
  where: "edit";
  mode: EditMode;
  onMode: (mode: EditMode) => void;
  /** The fence's level (0: not built) and the pieces still to lay. */
  fence: number;
  piecesLeft: number;
  /** The gate's key, while fence is laid: on, and whether it can be. */
  gate: { on: boolean; can: boolean; why: string; exists: boolean; onToggle: () => void } | null;
  decorOpen: boolean;
  status: string;
  onDone: () => void;
};
type MeadowDock = {
  where: "meadow";
  onCamp: () => void;
  animals: { count: number; of: number; last: number; chosen: boolean; onOpen: () => void };
  decor: { chosen: boolean; onOpen: () => void };
  /** (1.5.11) The Blooms list: every finished book's bloom on the Reading Path. */
  blooms?: { count: number; last: number; chosen: boolean; onOpen: () => void };
};

/**
 * The row of keys at the foot of the picture (1.5.10): three keys, Build, Raid and Edit. Build opens the panel of
 * everything there is to build, post or buy, in four tabs; Raid the Magpie Lands; Edit lays the camp out (move, fence,
 * decorate). The meadow has its own small row, and Edit its own bar while it is on.
 */
export const HollowDock = ({ dock, after }: { dock: CampDock | EditDock | MeadowDock; after?: ReactNode }) => (
  <div className="pip-base-under">
    {dock.where === "edit" ? (
      <div className="pip-base-dock pip-edit-dock">
        <span className="flex" role="group" aria-label="What a tap on the picture does">
          <button
            type="button"
            className={`tactile-button rounded-r-none px-3 py-1 text-xs ${dock.mode === "move" ? "tactile-button-primary" : ""}`}
            aria-pressed={dock.mode === "move"}
            title="Drag a building to where it should stand"
            onClick={() => dock.onMode("move")}
          >
            <span className="flex items-center gap-1.5">
              <Move size={13} aria-hidden /> Move
            </span>
          </button>
          <button
            type="button"
            className={`tactile-button rounded-none px-3 py-1 text-xs disabled:opacity-60 ${dock.mode === "fence" ? "tactile-button-primary" : ""}`}
            aria-pressed={dock.mode === "fence"}
            disabled={dock.fence === 0}
            title={dock.fence === 0 ? "Build a fence first" : "Slide the wall along the trail, nearer the trees or nearer the camp"}
            onClick={() => dock.onMode("fence")}
          >
            <span className="flex items-center gap-1.5">
              <Sprite name="fencepiece" variant={Math.max(1, dock.fence)} box={16} className={dock.fence === 0 ? "is-locked" : ""} />
              Fence
              {dock.fence > 0 && dock.piecesLeft > 0 ? <span className="pip-edit-left">{dock.piecesLeft}</span> : null}
            </span>
          </button>
          <button
            type="button"
            className={`tactile-button rounded-l-none px-3 py-1 text-xs disabled:opacity-60 ${dock.mode === "decor" ? "tactile-button-primary" : ""}`}
            aria-pressed={dock.mode === "decor"}
            disabled={!dock.decorOpen}
            title={dock.decorOpen ? "Set decorations down: drag one onto the grass" : "Decorations come with a later chapter"}
            onClick={() => dock.onMode("decor")}
          >
            <span className="flex items-center gap-1.5">
              <Flower2 size={13} aria-hidden /> Decorate
            </span>
          </button>
        </span>
        {dock.gate && (
          <button
            type="button"
            className={`tactile-button flex items-center gap-1.5 px-3 py-1 text-xs disabled:opacity-60 ${dock.gate.on ? "tactile-button-primary" : ""}`}
            aria-pressed={dock.gate.on}
            disabled={!dock.gate.can}
            title={dock.gate.why}
            onClick={dock.gate.onToggle}
          >
            <DoorOpen size={13} aria-hidden /> {dock.gate.exists ? "Move gate" : "Gate"}
          </button>
        )}
        <span className="pip-base-chip pip-edit-status" role="status">
          {dock.status}
        </span>
        <button type="button" className="tactile-button tactile-button-primary ml-auto px-3 py-1 text-xs font-semibold" onClick={dock.onDone}>
          Done
        </button>
      </div>
    ) : dock.where === "meadow" ? (
      <div className="pip-base-dock" role="group" aria-label="The meadow">
        <button type="button" className="tactile-button flex items-center gap-1.5 px-3 py-1.5 text-xs" onClick={dock.onCamp}>
          <Tent size={13} aria-hidden /> Camp
        </button>
        <span className="pip-base-dock-gap" aria-hidden="true" />
        <button
          type="button"
          className={`pip-base-tile ${dock.animals.chosen ? "is-chosen" : ""}`}
          aria-pressed={dock.animals.chosen}
          aria-label={`The animals: ${dock.animals.count} of ${dock.animals.of} here`}
          title="The animals"
          onClick={dock.animals.onOpen}
        >
          <Sprite name="animal" variant={dock.animals.last} box={28} className={dock.animals.count === 0 ? "is-locked" : ""} />
          <span className="pip-base-tile-level">{dock.animals.count}</span>
        </button>
        <button
          type="button"
          className={`pip-base-tile ${dock.decor.chosen ? "is-chosen" : ""}`}
          aria-pressed={dock.decor.chosen}
          aria-label="Set something down"
          title="Set something down"
          onClick={dock.decor.onOpen}
        >
          <Sprite name="decor" variant={10} box={28} />
        </button>
        {dock.blooms && (
          <button
            type="button"
            className={`pip-base-tile ${dock.blooms.chosen ? "is-chosen" : ""}`}
            aria-pressed={dock.blooms.chosen}
            aria-label={`Blooms: ${dock.blooms.count}, one for every book you finished`}
            title="Blooms: one for every book you finished"
            onClick={dock.blooms.onOpen}
          >
            <Sprite name="bloom" variant={dock.blooms.last} box={28} className={dock.blooms.count === 0 ? "is-locked" : ""} />
            <span className="pip-base-tile-level">{dock.blooms.count}</span>
          </button>
        )}
      </div>
    ) : (
      <div className="pip-base-dock pip-hollow-dock" role="group" aria-label="The camp">
        <button type="button" className={`pip-base-tile is-key ${dock.buildOpen ? "is-chosen" : ""}`} aria-pressed={dock.buildOpen} title="Build, upgrade, post and buy" onClick={dock.onBuild}>
          <Hammer size={17} aria-hidden />
          Build
          {dock.buildMark === "waiting" && !dock.buildOpen && <Nut size={11} className="pip-base-tile-mark is-waiting" aria-hidden />}
          {dock.buildMark === "nudge" && !dock.buildOpen && <span className="pip-base-nudge" aria-label="Next" />}
        </button>
        {dock.raid && (
          <button type="button" className={`pip-base-tile is-key ${dock.raid.open ? "is-chosen" : ""}`} aria-pressed={dock.raid.open} title="Raid the magpies' strongholds" onClick={dock.raid.onRaid}>
            <Swords size={17} aria-hidden />
            Raid
            {dock.raid.rested > 0 && <span className="pip-base-count">{dock.raid.rested}</span>}
            {dock.raid.nudge && !dock.raid.open && <span className="pip-base-nudge" aria-label="Next" />}
          </button>
        )}
        {dock.onEdit && (
          <button type="button" className="pip-base-tile is-key" title="Lay the camp out: move things, slide the wall, decorate" onClick={dock.onEdit}>
            <Pencil size={16} aria-hidden />
            Edit
            {dock.editMark && <span className="pip-base-nudge" aria-label="Next" />}
          </button>
        )}
      </div>
    )}
    {after}
  </div>
);

/** The Build panel's tabs, at its head. */
export const BuildTabs = ({ tab, shown, marks, onTab }: { tab: BuildTab; shown: readonly BuildTab[]; marks: Partial<Record<BuildTab, boolean>>; onTab: (tab: BuildTab) => void }) => (
  <div className="pip-build-tabs" role="tablist" aria-label="Build">
    {BUILD_TABS.filter(({ id }) => shown.includes(id)).map(({ id, name, icon: Icon }) => (
      <button key={id} type="button" role="tab" aria-selected={tab === id} className={`pip-build-tab ${tab === id ? "is-chosen" : ""}`} onClick={() => onTab(id)}>
        <Icon size={13} aria-hidden />
        {name}
        {marks[id] && tab !== id && <span className="pip-build-tab-dot" aria-label="Next" />}
      </button>
    ))}
  </div>
);
