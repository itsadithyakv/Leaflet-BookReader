/** Typed boundary for garden.js: plots and plants in the room art's pixels. */
export declare const PLOT_W: number;
export declare const PLOT_H: number;
/** One plot: empty soil (plantId null), or a plant at its growth (0..1). */
export declare function renderPlot(plantId: string | null, progress: number, ripe: boolean, frame?: number): ImageData;
/** The soil bed alone; `dug` shows the rows of an empty plot. */
export declare function renderSoil(dug: boolean): ImageData;
/** The plant alone, over transparency, the same size as its plot. */
export declare function renderPlant(plantId: string, progress: number, ripe: boolean, frame?: number): ImageData;
export declare function renderPacket(plantId: string, frame?: number): ImageData;
export declare const BARREL_W: number;
export declare const BARREL_H: number;
/** The rain barrel, `fill` 0..1 full: the water waiting for the next planting. */
export declare function renderBarrel(fill: number, frame?: number): ImageData;
export declare function renderGardenFloor(w: number, h: number, floorY: number, frame?: number): ImageData;

/** The bed's picture is this tall, from the top of the lawn. */
export declare const BED_H: number;
/** The garden's rows: furrows, stakes and the dug marks of empty plots, `w` wide and BED_H tall. */
export declare function renderGardenBed(
  w: number,
  rows: ReadonlyArray<{ y: number; depth: number; x0: number; x1: number }>,
  holes?: ReadonlyArray<{ x: number; y: number }>
): ImageData;
