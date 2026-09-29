export declare const FLOWER_W: number;
export declare const FLOWER_H: number;
export type FocusFlowerKind = "tulip" | "daisy" | "sunflower" | "rose";
export type FocusFlowerState = "growing" | "bloomed" | "wilted";
export declare const FOCUS_FLOWERS: Record<FocusFlowerKind, { petal: string; light: string; dead: string; middle: string }>;
export declare function flowerStage(progress: number): 0 | 1 | 2 | 3;
export declare function renderFocusFlower(kind: string, progress: number, state: FocusFlowerState, frame?: number): ImageData;
