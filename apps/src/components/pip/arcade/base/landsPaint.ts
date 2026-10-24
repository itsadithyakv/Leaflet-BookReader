/**
 * Painting the Magpie Lands (`LandsMap.tsx`), in art pixels, onto two canvases the size of the whole map that the page
 * scales up by a whole number of device pixels (`landsLayout.ts`): the land, drawn once for as long as nothing on it
 * changes (`paintLand`), and what moves on it, drawn only when one of them takes a step (`paintMoving`, which says
 * when that is). The pieces are base-art.js's (`landnode`, `landkeep`, `landroost` and the rest); the ground and the
 * path are painted here, a pixel at a time, with no blur.
 */
import type { GameArt, GameSprite } from "../gameArt";
import { REGIONS, type Lands } from "../../../../pip/base/lands";
import { seasonOf } from "../../../../pip/base/rules";
import {
  CAMP_ALONG,
  CAMP_LEN,
  FAR_FROM,
  PATH_LEN,
  PEAK_FROM,
  ROAD_BEAT,
  ROOST_ACROSS,
  ROOST_ALONG,
  SIGN_ACROSS,
  SIGN_ALONG,
  frontierAlong,
  nodeAlong,
  pointAt,
  regionFrom,
  regionLen,
  roadAt,
  type LandsView
} from "./landsLayout";

/** Each stretch's ground: body, light speckle, dark speckle. The five regions, the Far Rookeries, then the peak. */
const GROUND: ReadonlyArray<readonly [number, number, number]> = [
  [0x7cc35e, 0x96d672, 0x5da24c],
  [0x6aa955, 0x82bc66, 0x4c8642],
  [0xc8bf7c, 0xdcd392, 0xa79d5e],
  [0x9cad8a, 0xb2c19f, 0x7d8d6f],
  [0x8f8aa2, 0xa59fb6, 0x6f6a86],
  [0x6d6799, 0x827cac, 0x534d7d],
  [0xb6bcc6, 0xcfd5dd, 0x949ba7]
];
const PEAK = 6;
/** Which stretch a point along the path is in. */
const stretchAt = (u: number) => (u < CAMP_LEN ? 0 : u < PEAK_FROM ? Math.min(REGIONS - 1, Math.floor((u - CAMP_LEN) / 128)) : u < FAR_FROM ? PEAK : REGIONS);
/** Two scattered pieces of land (`landbit`) for each stretch. */
const BITS: ReadonlyArray<readonly number[]> = [[0, 1, 0, 1, 0], [2, 3, 1, 2], [4, 5, 1, 0, 1], [6, 7, 6, 9], [8, 9, 8, 6], [11, 10, 11], [10, 4, 10]];

/** The art's own scatter (room.js `rnd`): the same land every time. */
const rnd = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const hash = (x: number, y: number) => rnd(x * 12.9898 + y * 78.233);

/** Bottom-centred, as the camp draws everything: its foot on (x, y). */
const stand = (ctx: CanvasRenderingContext2D, sprite: GameSprite | null, x: number, y: number, flip = false) => {
  if (!sprite) return;
  const left = Math.round(x - sprite.w / 2);
  const top = Math.round(y - sprite.h);
  if (!flip) {
    ctx.drawImage(sprite.image, left, top);
    return;
  }
  ctx.save();
  ctx.translate(left + sprite.w, top);
  ctx.scale(-1, 1);
  ctx.drawImage(sprite.image, 0, 0);
  ctx.restore();
};

/** Along the path, for a point on the map. */
const alongOf = (view: LandsView, x: number, y: number) => (view.orient === "wide" ? x - view.start : view.start - y);

/** What the land is drawn from: everything that changes it. */
export const landKey = (view: LandsView, lands: Lands, campLevel: number, day: string) =>
  [
    view.orient,
    view.world.w,
    view.world.h,
    view.mid,
    view.amp,
    campLevel,
    seasonOf(day),
    lands.next,
    lands.nodes.map((node) => `${node.n}${node.taken ? "t" : ""}${node.fogged ? "f" : ""}`).join(","),
    lands.regions.map((region) => (region.fogged ? 1 : 0)).join(""),
    lands.roost.lit ? 1 : 0,
    lands.roost.fogged ? 1 : 0,
    lands.roost.banners.join(","),
    lands.friends ? 1 : 0,
    lands.road.length
  ].join("|");

export type LandExtras = { campLevel: number; sign: boolean };

/** The land: ground, borders, path, scenery, Pip's camp, the strongholds, the roost and its banners, and fog. */
export const paintLand = (canvas: HTMLCanvasElement, view: LandsView, lands: Lands, art: GameArt, extras: LandExtras) => {
  const { w, h } = view.world;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext?.("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;

  // ---- the ground, a pixel at a time: each stretch its own, blended into the next with a dither.
  const image = ctx.createImageData(w, h);
  const data = image.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = Math.max(0, Math.min(PATH_LEN, alongOf(view, x, y)));
      let stretch = stretchAt(u);
      const near = stretchAt(u + 8);
      const before = stretchAt(u - 8);
      const r = hash(x, y);
      if (near !== stretch && r < 0.35) stretch = near;
      else if (before !== stretch && r > 0.65) stretch = before;
      const [body, light, dark] = GROUND[stretch];
      const grain = hash(x * 3 + 7, y * 5 + 1);
      const colour = grain > 0.94 ? light : grain < 0.05 ? dark : (x + y) % 7 === 0 && grain > 0.6 ? light : body;
      const at = (y * w + x) * 4;
      data[at] = colour >> 16;
      data[at + 1] = (colour >> 8) & 0xff;
      data[at + 2] = colour & 0xff;
      data[at + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  const across = view.orient === "wide" ? view.world.h : view.world.w;
  const crossLine = (u: number, colour: string) => {
    ctx.fillStyle = colour;
    for (let v = -across; v <= across; v += 3) {
      const p = pointAt(view, u, v);
      if (p.x >= 0 && p.y >= 0 && p.x < w && p.y < h) ctx.fillRect(p.x, p.y, 1, 1);
    }
  };
  // ---- the regions' borders: dotted, as on a drawn map.
  for (let region = 1; region <= REGIONS; region++) crossLine(regionFrom(region), "rgba(42, 30, 22, 0.28)");
  crossLine(PEAK_FROM, "rgba(42, 30, 22, 0.28)");

  // ---- the path: trodden as far as the next stronghold, dotted beyond it.
  const frontier = frontierAlong(lands);
  for (let u = 0; u <= PATH_LEN - 6; u++) {
    const p = pointAt(view, u);
    if (u <= frontier) {
      ctx.fillStyle = "#9A7A52";
      ctx.fillRect(p.x - 2, p.y - 1, 4, 3);
      ctx.fillStyle = "#E4CC98";
      ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
    } else if (u % 4 === 0) {
      ctx.fillStyle = "rgba(42, 30, 22, 0.45)";
      ctx.fillRect(p.x, p.y + 1, 2, 1);
      ctx.fillStyle = "#F4E8C8";
      ctx.fillRect(p.x, p.y, 2, 1);
    }
  }
  // The spur up to the roost, and the side road the day's camps walk.
  const spur = (from: { x: number; y: number }, to: { x: number; y: number }, steps: number) => {
    for (let k = 0; k <= steps; k += 2) {
      const x = Math.round(from.x + ((to.x - from.x) * k) / steps);
      const y = Math.round(from.y + ((to.y - from.y) * k) / steps);
      ctx.fillStyle = "rgba(42, 30, 22, 0.4)";
      ctx.fillRect(x, y + 1, 1, 1);
      ctx.fillStyle = "#F4E8C8";
      ctx.fillRect(x, y, 1, 1);
    }
  };
  const roostAt = pointAt(view, ROOST_ALONG, view.orient === "wide" ? ROOST_ACROSS : 0);
  for (const camp of lands.road) {
    const road = roadAt(frontier, camp.slot);
    const at = pointAt(view, road.u, road.v);
    spur({ x: at.x - ROAD_BEAT - 6, y: at.y }, { x: at.x + ROAD_BEAT + 6, y: at.y }, (ROAD_BEAT + 6) * 2);
  }

  // ---- what stands on the land, back to front.
  type Piece = { y: number; draw: () => void };
  const pieces: Piece[] = [];
  const nodePoints = lands.nodes.map((node) => pointAt(view, nodeAlong(node, lands.next)));
  const keepClear: Array<{ x: number; y: number; r: number }> = [
    ...nodePoints.map((p) => ({ ...p, r: 18 })),
    { ...pointAt(view, CAMP_ALONG), r: 30 },
    { ...roostAt, r: 26 },
    ...(extras.sign ? [{ ...pointAt(view, SIGN_ALONG, SIGN_ACROSS), r: 12 }] : []),
    ...lands.road.map((camp) => {
      const road = roadAt(frontier, camp.slot);
      return { ...pointAt(view, road.u, road.v), r: 18 };
    })
  ];
  const scatter = Math.round((PATH_LEN * across) / 420);
  for (let k = 0; k < scatter; k++) {
    const u = Math.floor(rnd(k * 3.17 + 1) * PATH_LEN);
    const v = Math.round((rnd(k * 7.31 + 2) - 0.5) * across * 1.2);
    const p = pointAt(view, u, v);
    if (p.x < 4 || p.x > w - 4 || p.y < 8 || p.y > h + 4) continue;
    if (Math.abs(v + 0) < 14) continue;
    if (keepClear.some((spot) => Math.abs(spot.x - p.x) < spot.r && Math.abs(spot.y - p.y) < spot.r)) continue;
    const kinds = BITS[stretchAt(u)];
    const variant = kinds[Math.floor(rnd(k * 1.93 + 5) * kinds.length)];
    pieces.push({ y: p.y, draw: () => stand(ctx, art.sprite("landbit", 0, { variant }), p.x, p.y) });
  }
  // Pip's camp at the start of it all.
  const camp = pointAt(view, CAMP_ALONG);
  pieces.push({ y: camp.y + 4, draw: () => stand(ctx, art.sprite("burrow", 0, { variant: Math.max(1, extras.campLevel) }), camp.x, camp.y + 4) });
  if (extras.sign) {
    const sign = pointAt(view, SIGN_ALONG, SIGN_ACROSS);
    pieces.push({ y: sign.y, draw: () => stand(ctx, art.sprite("landsign", 0), sign.x, sign.y) });
  }
  lands.nodes.forEach((node, index) => {
    const p = nodePoints[index];
    const sprite = node.kind === "keep" ? "landkeep" : "landnode";
    pieces.push({ y: p.y + 4, draw: () => stand(ctx, art.sprite(sprite, 0, { variant: node.region, rank: node.taken ? 1 : 0 }), p.x, p.y + 4) });
  });
  pieces.push({ y: roostAt.y + 4, draw: () => stand(ctx, art.sprite("landroost", 0, { variant: lands.roost.lit ? 1 : 0 }), roostAt.x, roostAt.y + 4) });
  // Every banner won flies on the summit, the newest nearest the roost (a dozen at most are drawn).
  lands.roost.banners.slice(-12).forEach((month, index, shown) => {
    const k = shown.length - 1 - index;
    const flag = { x: roostAt.x + 22 + (k % 6) * 6, y: roostAt.y + 2 - Math.floor(k / 6) * 6 - (k % 2) };
    pieces.push({ y: flag.y, draw: () => stand(ctx, art.sprite("landflag", 0, { variant: seasonOf(`${month}-15`) }), flag.x, flag.y) });
  });
  pieces.sort((a, b) => a.y - b.y).forEach((piece) => piece.draw());

  // ---- fog over what the reading has not reached: a pale wash with a ragged edge, and puffs of cloud on it.
  const fogged: Array<[number, number]> = [];
  lands.regions.forEach((region) => {
    if (region.fogged) fogged.push([regionFrom(region.index), regionFrom(region.index) + regionLen(region.index)]);
  });
  if (lands.roost.fogged) fogged.push([PEAK_FROM, FAR_FROM]);
  if (!lands.far.open) fogged.push([FAR_FROM, PATH_LEN + 20]);
  if (fogged.length > 0) {
    const covered = (u: number, x: number, y: number) =>
      fogged.some(([from, to]) => {
        const ragged = Math.round(hash(view.orient === "wide" ? y >> 1 : x >> 1, from) * 5);
        return u >= from + ragged && (to > PATH_LEN || u < to + ragged);
      });
    const lit = ctx.getImageData(0, 0, w, h);
    const px = lit.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!covered(alongOf(view, x, y), x, y)) continue;
        // A pale wash, dithered two ways: what is under it shows through only a little.
        const at = (y * w + x) * 4;
        const [fr, fg, fb, keep] = (x + y) % 2 === 0 ? [246, 240, 226, 0.12] : [234, 226, 208, 0.16];
        px[at] = Math.round(px[at] * keep + fr * (1 - keep));
        px[at + 1] = Math.round(px[at + 1] * keep + fg * (1 - keep));
        px[at + 2] = Math.round(px[at + 2] * keep + fb * (1 - keep));
      }
    }
    ctx.putImageData(lit, 0, 0);
    for (const [from, to] of fogged) {
      const end = Math.min(to, PATH_LEN);
      for (let k = 0; k < Math.ceil((end - from) / 18); k++) {
        const u = from + 8 + Math.floor(rnd(from + k * 4.1) * Math.max(1, end - from - 16));
        const v = Math.round((rnd(from * 0.3 + k * 9.7) - 0.5) * across * 0.9);
        const p = pointAt(view, u, v);
        stand(ctx, art.sprite("landfog", 0, { variant: k % 3 === 0 ? 1 : 0 }), p.x, p.y);
      }
    }
  }
};

/** Frames a second Pip idles at; a road camp's steps; the marker's slow bob. */
const PIP_MS = 1000 / 6;
const STEP_MS = 300;
const BOB_MS = 700;

/**
 * What moves: Pip at the next stronghold, the marker over it, and the day's road camps walking their beat (a pixel a
 * step, the legs only: nothing bobs or shakes). `still`: drawn at rest, once. Returns how long until something next
 * changes (ms), or null when nothing will.
 */
export const paintMoving = (canvas: HTMLCanvasElement, view: LandsView, lands: Lands, art: GameArt, time: number, still: boolean): number | null => {
  const { w, h } = view.world;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext?.("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, w, h);
  const frontier = frontierAlong(lands);
  const next = lands.nodes.find((node) => node.next);
  const t = still ? 0 : time;
  // Road camps first, so Pip stands in front of them.
  for (const camp of lands.road) {
    if (camp.done) continue;
    const road = roadAt(frontier, camp.slot);
    const at = pointAt(view, road.u, road.v);
    const step = Math.floor(t / STEP_MS) + camp.slot * 7;
    const leg = step % (ROAD_BEAT * 2);
    const ahead = leg < ROAD_BEAT;
    const x = at.x - ROAD_BEAT / 2 + (ahead ? leg : ROAD_BEAT * 2 - leg);
    stand(ctx, art.sprite("landfolk", still ? 0 : step % 4, { variant: camp.slot }), x, at.y + 1, !ahead);
  }
  if (next) {
    const node = pointAt(view, frontier);
    const tall = next.kind === "keep" ? 28 : 18;
    stand(ctx, art.sprite("landhere", still ? 0 : Math.floor(t / BOB_MS) % 2), node.x, node.y + 4 - tall - 2);
    const pip = art.pip("idle", still ? 0 : Math.floor(t / PIP_MS));
    const standAt = pointAt(view, Math.max(4, frontier - 18));
    ctx.drawImage(pip.image, Math.round(standAt.x - 16), Math.round(standAt.y - 28));
  }
  if (still) return null;
  const until = (every: number) => every - (time % every);
  return Math.max(16, Math.min(until(PIP_MS), lands.road.some((camp) => !camp.done) ? until(STEP_MS) : Infinity, until(BOB_MS)));
};
