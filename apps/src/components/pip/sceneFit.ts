/** The smallest half step: 1.5 device pixels an art pixel (at 1 there is no smaller whole step to add half to). */
const MIN_HALF_STEP = 1.5;

/**
 * How big Pip's house is drawn: device pixels per art pixel, for a floor of
 * `artWidth` by `artHeight` in a box of `boxWidth` by `boxHeight` CSS pixels.
 *
 * Whole steps keep every art pixel the same size, but on their own they leave
 * much of the page empty on a narrow window: at 820 px the room was two
 * pixels a pixel, 480 px across in 680. So half steps count too (1.5, 2.5,
 * 3.5): the art's pixels alternate by one device pixel, which still reads as
 * the same pixel art, and the room fills most of what it is given. Never
 * fewer than one.
 */
export const sceneScale = (artWidth: number, artHeight: number, boxWidth: number, boxHeight: number, ratio = 1) => {
  const exact = Math.min((boxWidth * ratio) / artWidth, (boxHeight * ratio) / artHeight);
  const whole = Math.max(1, Math.floor(exact + 1e-6));
  const half = Math.floor(exact * 2 + 1e-6) / 2;
  return half >= MIN_HALF_STEP ? Math.max(whole, half) : whole;
};

/**
 * Where a room of `roomWidth` by `roomHeight` CSS pixels sits in the box it is fitted to, snapped to device
 * pixels: in the middle of it. (Where Pip's tab is the whole screen the box is what the HUD, the rail and the lift
 * leave clear, so nothing that can be tapped in the room is under one of them; the room's own edges, carried out
 * past it (`edgeBands`), fill the rest of the screen.)
 */
export const fillPlace = (roomWidth: number, roomHeight: number, boxWidth: number, boxHeight: number, ratio = 1) => {
  const snap = (value: number) => Math.round(value * ratio) / ratio;
  return { left: snap((boxWidth - roomWidth) / 2), top: snap((boxHeight - roomHeight) / 2) };
};

/**
 * The room's edge carried out to the box's: one colour an art row (the left or right column of the room's
 * picture), as a CSS gradient over the box, each row as tall as it is drawn, from the room's `top` (CSS pixels in
 * the box). The first row runs up to the box's top and the last down to its foot. Rows of one colour are merged.
 */
export const edgeBands = (rows: readonly string[], top: number, scale: number) => {
  if (rows.length === 0) return "none";
  const px = (value: number) => `${Math.round(value * 100) / 100}px`;
  const stops: string[] = [];
  let from = 0;
  for (let row = 0; row < rows.length; row++) {
    if (row + 1 < rows.length && rows[row + 1] === rows[row]) continue;
    const start = from === 0 ? "0px" : px(top + from * scale);
    const end = row === rows.length - 1 ? "100%" : px(top + (row + 1) * scale);
    stops.push(`${rows[row]} ${start} ${end}`);
    from = row + 1;
  }
  return `linear-gradient(to bottom, ${stops.join(", ")})`;
};

/**
 * How far past each side of the room its picture is carried on (art pixels), in the pattern it is drawn in
 * (`edgePattern`): wider than any band beside the room on a phone on its side.
 */
export const BAND_ART = 200;
/** The longest repeat looked for along a row, and how far in from the edge it must hold. */
const MAX_PERIOD = 32;
/** The fewest rows of a wall in a row that make a pattern (`edgePattern`), and the trim under the ceiling. */
const WALL_RUN = 6;
const TRIM_ROWS = 4;
const RUN = 72;
/** A row with no repeat is carried on in its own commonest colour where it is this much of it (stars on a dark sky). */
const MOSTLY = 0.85;

/**
 * Two packed colours as near as makes no odds: within `NEAR` on each channel. The room is lit (the day through
 * its window, a lamp), so its wallpaper drifts a shade across the room and a dot ten pixels on is not the same
 * colour to the bit; a dot against its paper is far more than that.
 */
const NEAR = 10;
export const nearColour = (a: number, b: number) => {
  if (a === b) return true;
  for (let shift = 0; shift < 32; shift += 8) if (Math.abs(((a >>> shift) & 255) - ((b >>> shift) & 255)) > NEAR) return false;
  return true;
};

/**
 * The shortest repeat of a row of pixels read in from the room's edge (`pixels[0]` at the edge, as packed
 * colours): the smallest `p` with `pixels[k]` as `pixels[k + p]` (`nearColour`) all along the first `RUN`. Null
 * where there is none (a shelf at the edge, a wallpaper drawn at random): that row is carried on in one colour.
 * Carried on, a repeat is its `p` pixels nearest the edge, so it meets the room in the room's own shade.
 */
export const rowPeriod = (pixels: ArrayLike<number>, maxPeriod = MAX_PERIOD, run = RUN): number | null => {
  const span = Math.min(run, pixels.length);
  for (let period = 1; period <= maxPeriod && period * 2 <= span; period++) {
    let repeats = true;
    for (let k = 0; k + period < span; k++) {
      if (!nearColour(pixels[k], pixels[k + period])) {
        repeats = false;
        break;
      }
    }
    if (repeats) return period;
  }
  return null;
};

/**
 * One side of the room carried on past its edge, `width` art pixels, as packed colours (row by row, the column
 * nearest the room last on the left side and first on the right): each row in its own repeat (the dots of a
 * wallpaper, the shade under the ceiling, the tiles of a counter), so the pattern runs on to the screen's edge
 * with no seam; a row with none, in `flat`'s colour for it. `rows[r][k]`: row `r`, `k` pixels in from the edge.
 * Above `wallTo` (the skirting) a pattern is a stretch of rows (`WALL_RUN` or more) that each repeat, or the trim
 * under the ceiling (its first `TRIM_ROWS`): a lone line that repeats among rows that do not (a window's bar
 * among its stars, a shelf among books) is carried on in `flat`'s colour, as they are, not as a stray line.
 */
export const edgePattern = (rows: readonly (ArrayLike<number>)[], flat: readonly number[], side: "left" | "right", width = BAND_ART, wallTo = 0): Uint32Array => {
  const out = new Uint32Array(width * rows.length);
  const periods = rows.map((row) => rowPeriod(row));
  const wallRows = Math.min(wallTo, rows.length);
  // Each wall row that repeats: how many in a row with it do.
  const kept = periods.map((period) => period !== null);
  for (let r = 0; r < wallRows; ) {
    if (periods[r] === null) {
      r++;
      continue;
    }
    let end = r;
    while (end < wallRows && periods[end] !== null) end++;
    if (end - r < WALL_RUN) for (let at = r; at < end; at++) if (at >= TRIM_ROWS) kept[at] = false;
    r = end;
  }
  // A row with no repeat: its own colour where it is mostly one (the dark between a sky's stars), else `flat`'s.
  const mostly = (row: ArrayLike<number>, r: number) => {
    const span = Math.min(RUN, row.length);
    // Counted by shade (a sixteenth of each channel), as lit; the one nearest the edge of the commonest is the colour.
    const counts = new Map<number, { count: number; first: number }>();
    let best: { count: number; first: number } | null = null;
    for (let k = 0; k < span; k++) {
      const shade = (row[k] >>> 4) & 0x0f0f0f0f;
      const entry = counts.get(shade) ?? { count: 0, first: row[k] };
      entry.count += 1;
      counts.set(shade, entry);
      if (!best || entry.count > best.count) best = entry;
    }
    return best && best.count >= span * MOSTLY ? best.first : flat[r];
  };
  rows.forEach((row, r) => {
    const period = kept[r] ? periods[r] : null;
    // (A lone line that repeats, among rows that do not, is `flat`'s colour: its own would draw it on.)
    const one = period !== null ? 0 : periods[r] !== null ? flat[r] : mostly(row, r);
    for (let d = 1; d <= width; d++) {
      // d pixels out from the edge: the repeat carried on (k = -d, brought into it), or the row's one colour.
      const colour = period === null ? one : row[(((-d) % period) + period) % period];
      const column = side === "left" ? width - d : d - 1;
      out[r * width + column] = colour;
    }
  });
  return out;
};
