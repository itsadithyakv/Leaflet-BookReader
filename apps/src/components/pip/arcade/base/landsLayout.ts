/**
 * Where everything stands on the Magpie Lands (`pip/base/lands.ts` says what is there): one winding path, measured
 * along it in art pixels (`u`) and across it (`v`), laid out left to right where the screen is wide and bottom to top
 * where it is tall (a phone held upright), so the same map reads both ways. Whole art pixels throughout, and a whole
 * number of device pixels to each art pixel (`scaleFor`), so the map's pixels stay square and hard-edged.
 *
 * Plain numbers: no DOM, no canvas.
 */
import { CAMPS_A_NAME } from "../../../../pip/base/rules";
import { FAR_SHOWN, MAIN_STRONGHOLDS, REGIONS, type Lands, type LandsNode } from "../../../../pip/base/lands";

/** Along the path: Pip's camp, then each region, then the King's peak, then the Far Rookeries. */
export const CAMP_LEN = 56;
export const REGION_LEN = 128;
export const PEAK_LEN = 72;
export const FAR_LEN = 150;
export const PATH_LEN = CAMP_LEN + REGIONS * REGION_LEN + PEAK_LEN + FAR_LEN;
/** Where each of a region's three strongholds stands along it; the keep last. */
const NODE_AT = [30, 68, 106];
export const PEAK_FROM = CAMP_LEN + REGIONS * REGION_LEN;
export const FAR_FROM = PEAK_FROM + PEAK_LEN;
const FAR_STEP = 44;
/** The path's wave: how long one bend is. */
const BEND = 176;

/** The art height (wide) or width (tall) the scale is chosen to show about. */
const WIDE_AIM = 190;
const TALL_AIM = 176;
/** The least the band the path winds in may be, across. */
const BAND_LEAST = 84;
/** Room at the far ends of the path. */
const END_ROOM = 10;

export type Orient = "wide" | "tall";

export type LandsView = {
  orient: Orient;
  /** Device pixels to each art pixel: a whole number. */
  scale: number;
  /** CSS pixels to each art pixel. */
  css: number;
  /** The whole map, in art pixels. */
  world: { w: number; h: number };
  /** The screen's part of it, in art pixels. */
  screen: { w: number; h: number };
  /** The middle of the band the path winds in (across), and how far it swings either side. */
  mid: number;
  amp: number;
  /** Across, the band's edges (art pixels): the land the scenery is scattered over runs past them. */
  lo: number;
  hi: number;
  /** Where the path begins: across the screen (wide), or down it (tall). */
  start: number;
};

/** The device pixels to each art pixel for a screen of so many device pixels across the path: a whole number. */
export const scaleFor = (acrossDevice: number, orient: Orient): number => Math.max(1, Math.floor(Math.max(1, acrossDevice) / (orient === "wide" ? WIDE_AIM : TALL_AIM)));

/**
 * The map for a screen of `w` by `h` CSS pixels at `ratio` device pixels to each, with so many CSS pixels kept clear at
 * the top (the bar along the top) and at the foot (the row of keys) where those lie over it.
 */
export const viewFor = (w: number, h: number, ratio: number, clear: { top: number; bottom: number } = { top: 0, bottom: 0 }): LandsView => {
  const dpr = ratio > 0 ? ratio : 1;
  const orient: Orient = w >= h * 1.05 ? "wide" : "tall";
  let scale = scaleFor((orient === "wide" ? h : w) * dpr, orient);
  const fits = (s: number) => (orient === "wide" ? (h - clear.top - clear.bottom) * (dpr / s) >= BAND_LEAST : true);
  while (scale > 1 && !fits(scale)) scale--;
  const css = scale / dpr;
  const screen = { w: Math.ceil(w / css), h: Math.ceil(h / css) };
  if (orient === "wide") {
    const lo = Math.round(clear.top / css) + 4;
    const hi = Math.max(lo + BAND_LEAST, screen.h - Math.round(clear.bottom / css) - 4);
    // Things stand up from their foot: the path sits a little below the band's middle.
    const mid = Math.round((lo + hi) / 2 + 8);
    const amp = Math.max(6, Math.min(30, Math.floor((hi - lo) / 2) - 22));
    return { orient, scale, css, world: { w: Math.max(screen.w, PATH_LEN + END_ROOM * 2), h: screen.h }, screen, mid, amp, lo, hi, start: END_ROOM };
  }
  const mid = Math.round(screen.w / 2);
  const amp = Math.max(8, Math.min(46, Math.floor(screen.w / 2) - 30));
  const top = Math.round(clear.top / css) + 40;
  const bottom = Math.round(clear.bottom / css) + 20;
  const tall = Math.max(screen.h, PATH_LEN + top + bottom);
  return { orient, scale, css, world: { w: screen.w, h: tall }, screen, mid, amp, lo: 0, hi: screen.w, start: tall - bottom };
};

/** How far the path swings across, at a point along it. */
export const acrossAt = (view: Pick<LandsView, "amp">, u: number) => Math.round(view.amp * Math.sin((u / BEND) * Math.PI * 2 + 0.5));

/** A point along the path and across it, as a point on the map (art pixels, whole). */
export const pointAt = (view: LandsView, u: number, v = 0): { x: number; y: number } => {
  const across = acrossAt(view, u) + v;
  if (view.orient === "wide") return { x: view.start + Math.round(u), y: view.mid + across };
  return { x: view.mid + across, y: view.start - Math.round(u) };
};

/** The point along the path where a region begins (region 5 is the Far Rookeries). */
export const regionFrom = (region: number) => (region >= REGIONS ? FAR_FROM : CAMP_LEN + region * REGION_LEN);
export const regionLen = (region: number) => (region >= REGIONS ? FAR_LEN : REGION_LEN);

/** Where a stronghold stands along the path; the Far Rookeries' few in a row, the next one last. */
export const nodeAlong = (node: Pick<LandsNode, "n">, next: number): number => {
  if (node.n < MAIN_STRONGHOLDS) return CAMP_LEN + Math.floor(node.n / CAMPS_A_NAME) * REGION_LEN + NODE_AT[node.n % CAMPS_A_NAME];
  const first = Math.max(MAIN_STRONGHOLDS, next - FAR_SHOWN);
  return FAR_FROM + 26 + (node.n - first) * FAR_STEP;
};
/** The King's roost stands on the peak, a little off the path. */
export const ROOST_ALONG = PEAK_FROM + 36;
export const ROOST_ACROSS = -6;
/** Pip's camp, at the start, and the friends' signpost beside it. */
export const CAMP_ALONG = 24;
export const SIGN_ALONG = 46;
export const SIGN_ACROSS = 22;

/** Where along the path the next stronghold is, and so where Pip stands and the road camps walk. */
export const frontierAlong = (lands: Pick<Lands, "nodes" | "next">) => {
  const node = lands.nodes.find((entry) => entry.next);
  return node ? nodeAlong(node, lands.next) : PATH_LEN - 20;
};

/** A road camp's beat: back and forth along a side road near the frontier (art pixels along, and across). */
export const ROAD_BEAT = 10;
export const roadAt = (frontier: number, slot: number): { u: number; v: number } => {
  const u = Math.min(PATH_LEN - 24, Math.max(CAMP_LEN + 8, frontier + 14 + slot * 22));
  return { u, v: slot % 2 === 0 ? 24 : -26 };
};

/** Where the map is scrolled to begin with: the next stronghold in the middle of the screen. */
export const scrollFor = (view: LandsView, lands: Pick<Lands, "nodes" | "next">): { left: number; top: number } => {
  const at = pointAt(view, frontierAlong(lands));
  if (view.orient === "wide") return { left: Math.max(0, Math.min(view.world.w - view.screen.w, at.x - Math.round(view.screen.w / 2))) * view.css, top: 0 };
  return { left: 0, top: Math.max(0, Math.min(view.world.h - view.screen.h, at.y - Math.round(view.screen.h * 0.55))) * view.css };
};
