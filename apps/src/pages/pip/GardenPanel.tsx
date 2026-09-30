import { renderPacket, renderSoil } from "../../pip/garden.js";
import type { HouseLevel } from "../../pip/home.js";
import type { GardenView, PlantState } from "../../services/pipService";
import { PixelImage } from "../../components/pip/PixelImage";
import { Hint, Hints } from "../../components/pip/shopParts";
import { CountUp } from "../../components/community/CountUp";
import { UiIcon } from "../../components/UiIcon";
import { plantInfo, plural, priceOf } from "./common";

type GardenPanelProps = {
  garden: GardenView | undefined;
  /** The floor on screen. */
  level: HouseLevel;
  gardenLevel: HouseLevel | null;
  goToFloor: (next: HouseLevel) => void;
  plotCount: number;
  /** What grows in a plot now, if anything. */
  growing: (plot: number) => PlantState | undefined;
  minutesLeft: (here: PlantState) => number;
  /** The next plot to dig, if any are left. */
  nextPlot: { id: string } | null;
  pick: (here: PlantState) => Promise<void>;
  plantAt: (plot: number) => void;
};

/** The garden's drawer: where seeds come from, and each plot as it grows. */
export const GardenPanel = ({ garden, level, gardenLevel, goToFloor, plotCount, growing, minutesLeft, nextPlot, pick, plantAt }: GardenPanelProps) => {
  const barrel = garden ? Math.round(garden.barrel) : 0;
  return (
    <>
      <Hints>
        <Hint icon="water" more="Reading in focus is water: a minute each, half as much again when a session runs to the end.">
          1 focus minute = 1 water
        </Hint>
        <Hint icon="garden" more="Water flows to the oldest planting first.">
          Oldest plant drinks first
        </Hint>
        <Hint icon="heart" more="Plants wait for you, however long you're away.">
          Nothing withers
        </Hint>
        <span className="seed-chip water-chip" title="Water waiting for a plant to drink it">
          <UiIcon name="water" size={12} />
          Barrel <CountUp value={barrel} /> / {garden?.barrelCap ?? 120}
        </span>
      </Hints>
      {gardenLevel && level.id !== gardenLevel.id && (
        <button type="button" className="pip-key mt-3" onClick={() => goToFloor(gardenLevel)}>
          <UiIcon name="up" size={15} />
          Ride up to the garden
        </button>
      )}
      <div className="mt-3 grid gap-2">
        {Array.from({ length: plotCount }, (_, index) => {
          const plot = index + 1;
          const here = growing(plot);
          const info = here ? plantInfo(here.plant) : null;
          return (
            <div key={plot} className="pip-garden-row">
              <span className="pip-garden-art">
                {/* An empty plot is its dug bed, not somebody else's sunflower. */}
                <PixelImage render={() => (here ? renderPacket(here.plant, 0) : renderSoil(true))} drawKey={`plot-${here?.plant ?? "empty"}`} box={36} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-on-surface">
                  Plot {plot}: {here ? info?.name ?? here.plant : "empty"}
                </p>
                {here && !here.ripe && (
                  <>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-outline-variant/30" aria-hidden="true">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (here.water / here.need) * 100)}%` }} />
                    </div>
                    <p className="mt-0.5 text-[11px] text-on-surface-variant">
                      {Math.floor(here.water)} / {here.need} water · {plural(minutesLeft(here), "more minute")} of focus
                    </p>
                  </>
                )}
                {here?.ripe && <p className="text-[11px] font-semibold text-on-surface">Ripe! {info ? `${info.yield} seeds` : ""}</p>}
              </div>
              {here?.ripe ? (
                <button type="button" className="pip-key pip-key-primary pip-key-small" onClick={() => void pick(here)}>
                  Pick
                </button>
              ) : !here ? (
                <button type="button" className="pip-key pip-key-small" aria-haspopup="dialog" onClick={() => plantAt(plot)}>
                  Plant
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {nextPlot && (
        <p className="mt-3 text-xs text-on-surface-variant">
          <UiIcon name="plus" size={12} className="mr-1 inline" />
          Dig more plots from the dashed bed in the garden ({priceOf("plot", nextPlot.id)} seeds).
        </p>
      )}
    </>
  );
};
