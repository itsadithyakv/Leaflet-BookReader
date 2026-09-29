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
export declare function renderGardenFloor(w: number, h: number, floorY: number, frame?: number): ImageData;
