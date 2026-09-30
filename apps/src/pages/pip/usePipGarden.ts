import { useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { EXTRA_PLOTS, catalogueItem, type ShopKind } from "../../pip/shop";
import type { HouseLevel } from "../../pip/home.js";
import type { GardenView, PlantState } from "../../services/pipService";
import type { HouseSceneHandle, ScenePlot } from "../../components/pip/HouseScene";
import { bump, centerOf, collect, floatText, puff, reducedMotion, seedPixel, type Box, type Captured } from "../../components/pip/fx";
import type { PendingPlant, purchaseFlow } from "./purchaseFlow";
import { aOrAn, errorText, pickOne, plantInfo, plural, priceOf, type Drawer } from "./common";

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];

/**
 * The water each planting had when the garden was last on screen (a
 * preference of this device), so what reading poured in since can rain down
 * the next time it is.
 */
const SEEN_KEY = "leaflet.pip.gardenSeen";
const readSeen = (): Record<string, number> => {
  try {
    const seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}") as unknown;
    return seen && typeof seen === "object" ? (seen as Record<string, number>) : {};
  } catch {
    return {};
  }
};
const writeSeen = (seen: Record<string, number>) => {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // Remembered for this visit only.
  }
};

type Flow = ReturnType<typeof purchaseFlow>;

type PipGardenOptions = {
  garden: GardenView | undefined;
  owns: (kind: ShopKind, id: string) => boolean;
  /** The floor on screen. */
  level: HouseLevel;
  gardenLevel: HouseLevel | null;
  goToFloor: (next: HouseLevel) => void;
  suspended: boolean;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  spendable: number;
  /** Holds the seed counter at a number while seeds fly to it (null lets go). */
  setHeldSeeds: Dispatch<SetStateAction<number | null>>;
  /** How long the seed counter takes to count up. */
  setCountMs: Dispatch<SetStateAction<number>>;
  pendingPlant: PendingPlant | null;
  setPendingPlant: Dispatch<SetStateAction<PendingPlant | null>>;
  harvest: (plantingId: string) => Promise<number>;
  plant: (plot: number, plant: string) => Promise<void>;
  purchase: Flow["purchase"];
  spend: Flow["spend"];
  play: (move: string, loops?: number, text?: string | null) => void;
  clickedArt: () => Captured | null;
  sceneRef: RefObject<HouseSceneHandle>;
  seedChipRef: RefObject<HTMLButtonElement>;
  setPickerPlot: Dispatch<SetStateAction<number | null>>;
  setDrawer: Dispatch<SetStateAction<Drawer | null>>;
  showToast: (message: string) => void;
};

/**
 * Pip's garden: its plots as the scene draws them, the rain that shows what
 * reading poured in meanwhile, and what the reader does there: pick a ripe
 * plant (its seeds fly to the counter), sow a packet, dig a new plot.
 */
export const usePipGarden = ({
  garden,
  owns,
  level,
  gardenLevel,
  goToFloor,
  suspended,
  busy,
  setBusy,
  spendable,
  setHeldSeeds,
  setCountMs,
  pendingPlant,
  setPendingPlant,
  harvest,
  plant,
  purchase,
  spend,
  play,
  clickedArt,
  sceneRef,
  seedChipRef,
  setPickerPlot,
  setDrawer,
  showToast
}: PipGardenOptions) => {
  // Plots shown as they were until the rain on them lands: plot -> growth then.
  const [rainHold, setRainHold] = useState<Record<number, { progress: number; ripe: boolean }> | null>(null);

  const plotCount = garden?.plots ?? 3;
  const growing = (plot: number): PlantState | undefined => garden?.plants.find((entry) => entry.plot === plot && !entry.harvested);
  const nextPlot = EXTRA_PLOTS.find((entry) => !owns("plot", entry.id)) ?? null;
  const scenePlots: ScenePlot[] = [
    ...Array.from({ length: plotCount }, (_, index) => {
      const here = growing(index + 1);
      const held = here ? rainHold?.[index + 1] : undefined;
      // A packet in its grace period is in the ground already.
      const sown = !here && pendingPlant?.plot === index + 1 ? pendingPlant.plant : null;
      return {
        plot: index + 1,
        plant: here?.plant ?? sown,
        progress: held ? held.progress : here ? Math.min(1, here.water / Math.max(1, here.need)) : 0,
        ripe: held ? held.ripe : Boolean(here?.ripe)
      };
    }),
    ...(nextPlot ? [{ plot: plotCount + 1, plant: null, progress: 0, ripe: false, locked: true, price: priceOf("plot", nextPlot.id) }] : [])
  ];
  const minutesLeft = (here: PlantState) => Math.max(1, Math.ceil(here.need - here.water));
  const plotLabel = (plot: ScenePlot) => {
    if (plot.locked) return `Dig a new plot: ${nextPlot ? priceOf("plot", nextPlot.id) : 0} seeds`;
    const here = growing(plot.plot);
    if (!here) return plot.plant ? `Plot ${plot.plot}: just planted.` : `Plot ${plot.plot}: empty. Select to plant a seed.`;
    const name = plantInfo(here.plant)?.name ?? here.plant;
    return here.ripe ? `Plot ${plot.plot}: ${name}, ripe! Select to pick it.` : `Plot ${plot.plot}: ${name}, ${plural(minutesLeft(here), "more minute")} of focus.`;
  };

  // Reading waters the garden out of sight (in the reader, on other days).
  // When the garden is next on screen, what it took rains down on the plots it
  // went to, then their growth catches up: the bars fill, a plant that grew a
  // stage stretches, one that ripened sparkles. Not while a book covers the
  // tab: the rain waits for the reader to come back.
  const onGarden = Boolean(level.garden);
  useEffect(() => {
    if (!onGarden || !garden || suspended) return;
    const seen = readSeen();
    const planted = garden.plants.filter((entry) => !entry.harvested);
    const remember = () => writeSeen(Object.fromEntries(planted.map((entry) => [entry.id, entry.water])));
    const watered = planted
      .filter((entry) => seen[entry.id] !== undefined && entry.water - seen[entry.id] >= 1)
      .sort((a, b) => a.plot - b.plot);
    if (watered.length === 0 || reducedMotion()) {
      remember();
      return;
    }
    // The plots show their old growth from the start; the rain begins once a
    // floor that slid in has settled.
    setRainHold(
      Object.fromEntries(
        watered.map((entry) => [entry.plot, { progress: Math.min(1, seen[entry.id] / Math.max(1, entry.need)), ripe: seen[entry.id] >= entry.need }])
      )
    );
    let current = true;
    const timer = window.setTimeout(() => {
      remember();
      const falling = sceneRef.current?.rain(watered.map((entry) => ({ plot: entry.plot, gained: entry.water - seen[entry.id] })));
      void (falling ?? Promise.resolve()).then(() => {
        if (current) setRainHold(null);
      });
    }, 450);
    return () => {
      current = false;
      window.clearTimeout(timer);
      setRainHold(null);
    };
  }, [onGarden, garden, suspended]);

  const releaseSeeds = () => setHeldSeeds(null);

  /**
   * The seeds a harvest gave fly from where it grew to the counter, which
   * takes each one with a bump and counts up as they land.
   */
  const flySeeds = (from: Box | null, seeds: number) => {
    const chip = seedChipRef.current;
    const icon = chip?.querySelector("svg") ?? chip;
    const target = icon?.getBoundingClientRect();
    if (!from || !target || seeds <= 0 || reducedMotion()) {
      releaseSeeds();
      return;
    }
    const start = { x: from.left + from.width / 2, y: from.top + from.height * 0.45 };
    floatText({ x: start.x, y: from.top }, `+${seeds}`, "gain");
    const count = Math.max(3, Math.min(14, Math.round(seeds / 2)));
    // The count runs while they land: first seed to last.
    setCountMs(count * 55 + 320);
    void collect(start, centerOf(target), {
      sprite: "seed",
      count,
      px: seedPixel(sceneRef.current?.pixel() ?? 4),
      onLand: (index) => {
        if (index === 0) releaseSeeds();
        if (index === count - 1) setCountMs(700);
        bump(chip, index === count - 1 ? 1.2 : 0.5);
      }
    });
  };

  const pick = async (here: PlantState) => {
    if (busy) return;
    // From the garden list, the seeds fly from the row's picture if the plot is not in view.
    const row = clickedArt();
    setBusy(true);
    setHeldSeeds(spendable);
    try {
      const seeds = await harvest(here.id);
      const name = (plantInfo(here.plant)?.name ?? here.plant).toLowerCase();
      const stood = sceneRef.current?.reap(here.plot, here.plant) ?? row?.rect ?? null;
      play(pickOne(["cheer", "sunbathe", "tapdance"]), 1, `fresh ${name}! +${seeds} seeds.`);
      flySeeds(stood, seeds);
    } catch (cause) {
      releaseSeeds();
      showToast(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  /** A packet planted: the seed arcs from the packet into the plot, and a shoot comes up. */
  const sow = (plot: number, plantId: string) => {
    const item = catalogueItem("plant", plantId);
    const info = plantInfo(plantId);
    if (!item || !info) return;
    // The packet's picture first: the picker it is in closes now.
    const packet = clickedArt();
    setPickerPlot(null);
    const planted = `${info.name.toLowerCase()} planted. ${info.water} minutes of reading and it's ripe.`;
    spend(
      item,
      {
        title: `Plant ${aOrAn(info.name)}?`,
        verb: "Plant",
        note: `${info.water} minutes of focus to ripen, then ${info.yield} seeds.`,
        pay: () => plant(plot, plantId),
        before: (from) => sceneRef.current?.expectSprout(plot, Boolean(from?.canvas)),
        after: (from) => {
          sceneRef.current?.sow(plot, from);
          play("idea", 1, planted);
        }
      },
      {
        label: `${info.name} in plot ${plot}`,
        show: (from) => {
          sceneRef.current?.expectSprout(plot, Boolean(from?.canvas));
          setPendingPlant({ plot, plant: plantId });
          sceneRef.current?.sow(plot, from);
          play("idea", 1, planted);
        },
        make: () => plant(plot, plantId),
        landed: () => setPendingPlant((current) => (current?.plot === plot ? null : current)),
        hide: () => {
          setPendingPlant((current) => (current?.plot === plot ? null : current));
          const bed = sceneRef.current?.plotBox(plot);
          if (bed) puff({ x: bed.left + bed.width / 2, y: bed.top + bed.height * 0.8 }, { px: sceneRef.current?.pixel() ?? 4, count: 6, spread: bed.width * 0.6 });
          play("nervous", 1, "okay. back in the packet.");
        }
      },
      packet
    );
  };

  const digPlot = () => {
    if (!nextPlot) return;
    const item = catalogueItem("plot", nextPlot.id);
    const ordinal = ORDINALS[plotCount] ?? "new";
    if (item) void purchase(item, { title: `Dig a ${ordinal} plot?`, verb: "Dig", after: () => play("cheer", 1, "a new plot! room for one more.") });
  };

  const onPlot = (plot: ScenePlot) => {
    if (plot.locked) {
      digPlot();
      return;
    }
    const here = growing(plot.plot);
    if (here?.ripe) {
      void pick(here);
      return;
    }
    if (!here && !plot.plant) {
      setPickerPlot(plot.plot);
      return;
    }
    setDrawer("garden");
  };

  /** "Plant" from the garden list: the picker opens over the plot, riding up to the garden first. */
  const plantAt = (plot: number) => {
    if (gardenLevel && level.id !== gardenLevel.id) {
      goToFloor(gardenLevel);
      window.setTimeout(() => setPickerPlot(plot), reducedMotion() ? 50 : 450);
    } else {
      setPickerPlot(plot);
    }
    setDrawer(null);
  };

  return { plotCount, growing, nextPlot, scenePlots, minutesLeft, plotLabel, releaseSeeds, pick, sow, digPlot, onPlot, plantAt };
};
