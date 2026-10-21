/**
 * How the Hollow says reading time (1.5.10): the chapter bar, the chapter card and the guide all say hours read
 * the same way, short enough for a phone on its side. "6 h 20 m", "45 m", "10 h". Never a decimal, never seconds.
 */

/** Minutes read, as hours and minutes: "6 h 20 m", "45 m", "10 h", "0 m". */
export const hoursText = (minutes: number): string => {
  const whole = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return `${rest} m`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} m`;
};

/** The same, said in words for a screen reader: "6 hours 20 minutes". */
export const hoursSaid = (minutes: number): string => {
  const whole = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  const h = `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const m = `${rest} ${rest === 1 ? "minute" : "minutes"}`;
  if (hours === 0) return m;
  return rest === 0 ? h : `${h} ${m}`;
};

/** How many of the bar's cells are full, for so much of the way (0 to 1): a cell only once it is whole, never all of them before the end. */
export const cellsFull = (part: number, cells = 5): number => {
  const along = Math.max(0, Math.min(1, Number.isFinite(part) ? part : 0));
  if (along >= 1) return cells;
  return Math.min(cells - 1, Math.floor(along * cells));
};

/** The bar's fill, in whole CSS pixels of a track `width` wide: a sliver (3 px) once any of the chapter is read, never all of it before the end. */
export const fillOf = (part: number, width = 44): number => {
  const along = Math.max(0, Math.min(1, Number.isFinite(part) ? part : 0));
  if (along >= 1) return width;
  if (along <= 0) return 0;
  return Math.max(3, Math.min(width - 2, Math.round(along * width)));
};

/** How far through, in words for a screen reader: "40% of the way to chapter 5". */
export const percentOf = (part: number): number => Math.floor(Math.max(0, Math.min(1, Number.isFinite(part) ? part : 0)) * 100);

/** How far through a stretch of reading: `done` of `need` minutes, 0 to 1. */
export const partOf = (done: number, need: number): number => (need <= 0 ? 1 : Math.max(0, Math.min(1, done / need)));
