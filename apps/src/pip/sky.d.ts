/** Typed boundary for sky.js: the living sky over Pip's garden, a pure function of the clock. */

/** How much of the garden floor the sky fills, from the top. */
export declare const SKY_H: number;

/** The rare things that cross the sky. */
export type SkyEventKind = "dragon" | "star" | "balloon";
/** One of them under way: `t` runs 0 to 1 through its crossing. */
export type SkyEvent = { kind: SkyEventKind; t: number; seed: number };

/** How long each takes, in milliseconds. */
export declare const EVENT_MS: Record<SkyEventKind, number>;
/** The sky's colours at an hour (0-24): top and bottom as [r, g, b], and how dark it is (0 day, 1 night). */
export declare function skyColours(hour: number): { top: number[]; bot: number[]; night: number };
/** The reader's local hour at a moment, with its minutes as a fraction. */
export declare function hourOf(timeMs: number): number;
/** What one slot of the clock holds, if anything: the kind, when it starts and its seed. */
export declare function eventInSlot(slot: number): { kind: SkyEventKind; at: number; seed: number } | null;
/** The rare things in the sky at a moment. */
export declare function skyEvents(timeMs: number): SkyEvent[];
/** The sky at a moment. `events` replaces the clock's own; `still` leaves out what moves fast. */
export declare function renderSky(w: number, h: number, timeMs: number, events?: SkyEvent[] | null, still?: boolean): ImageData;
/** Changes whenever the picture would: redraw only then. */
export declare function skySignature(w: number, h: number, timeMs: number, events?: SkyEvent[] | null, still?: boolean): string;
