/**
 * The raid field's size and its fixed places, in one small module that
 * imports nothing: the battle (`battle.ts`) and the data it is laid out from
 * (`approaches.ts`, `quirks.ts`) all read them, and none of those has to
 * import another to do it.
 */

export const FIELD_W = 240;
export const FIELD_H = 120;
/** The edge of the field scouts are kept inside; raiders at night come out of the trees, not the sky. */
export const EDGE = { left: 4, right: FIELD_W - 4, top: 14, bottom: FIELD_H - 4 } as const;
/** Where a stronghold's nest stands. */
export const CENTRE = { x: 156, y: 64 } as const;
/** Where a stronghold's wall stands across the field. */
export const WALL_X = 106;

export type Point = { x: number; y: number };
