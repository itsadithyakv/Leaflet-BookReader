/**
 * The radio: rain, a fire, a cafe behind the page while a book is open.
 *
 * - `ReaderAmbience`, `ReaderAmbienceRow` and the popover's three functions
 *   are for the two readers' toolbars, menus and Escape.
 * - `AmbiencePanel` is for Pip's room, opened from the radio there, and
 *   `useRadioThing` is what the room draws and names the radio from (lit
 *   when on, notes when sounding, "playing rain").
 * - `useAmbienceState` is the whole of it, for anything else that asks.
 */
export { ambience, useAmbienceState, useRadioThing, type AmbienceView, type RadioThing } from "./ambience";
export { AmbiencePanel } from "./AmbiencePanel";
export { ReaderAmbience, ReaderAmbienceRow, ambiencePopoverOpen, closeAmbiencePopover, openAmbiencePopover, useAmbiencePopoverOpen } from "./ReaderAmbience";
export { SCENES, SCENE_ORDER, type SceneId } from "./scenes";
export type { Phase } from "./state";
