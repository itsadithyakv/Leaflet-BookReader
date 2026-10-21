import { describe, expect, it } from "vitest";
import { edgeBands, edgePattern, fillPlace, rowPeriod, sceneScale } from "./sceneFit";

// A floor of the house: 240 by 120 art pixels.
const W = 240;
const H = 120;

describe("how big the house is drawn", () => {
  it("fills an 820 px window with a half step rather than leaving it half empty", () => {
    // 820 wide: the rail, the page's gutters and the lift leave about 650.
    expect(sceneScale(W, H, 650, 600)).toBe(2.5);
    expect(W * sceneScale(W, H, 650, 600)).toBe(600);
  });

  it("takes half steps at 1024 and 1280 too", () => {
    expect(sceneScale(W, H, 854, 520)).toBe(3.5);
    expect(sceneScale(W, H, 1118, 556)).toBe(4.5);
  });

  it("keeps whole steps when they fit exactly", () => {
    expect(sceneScale(W, H, 1440, 720)).toBe(6);
    expect(sceneScale(W, H, 1459, 900)).toBe(6);
  });

  it("is limited by the height on a wide, short window", () => {
    expect(sceneScale(W, H, 1600, 400)).toBe(3);
    expect(sceneScale(W, H, 1600, 430)).toBe(3.5);
  });

  it("allows 1.5 but nothing between one and one and a half", () => {
    expect(sceneScale(W, H, 370, 400)).toBe(1.5);
    expect(sceneScale(W, H, 300, 400)).toBe(1);
  });

  it("never draws smaller than one device pixel a pixel", () => {
    expect(sceneScale(W, H, 100, 40)).toBe(1);
  });

  it("counts in device pixels on a scaled display", () => {
    // 125% scaling: 480 CSS px is 600 device px, two and a half a pixel.
    expect(sceneScale(W, H, 480, 400, 1.25)).toBe(2.5);
    // A phone at 3x: 290 CSS px is 870 device px.
    expect(sceneScale(W, H, 290, 400, 3)).toBe(3.5);
  });
});

describe("the room as the whole screen (a phone on its side)", () => {
  it("is whole, crisp and in the middle of what the controls leave clear", () => {
    // A Pixel 7 on its side (915 x 412 at 2.625, a 28 px status bar): the clear box under the HUD, between the lift and the rail.
    const box = { width: 915 - 60 - 96, height: 412 - 74 - 6 };
    const per = sceneScale(W, H, box.width, box.height, 2.625);
    expect(Number.isInteger(per)).toBe(true);
    const scale = per / 2.625;
    expect(H * scale).toBeLessThanOrEqual(box.height);
    expect(W * scale).toBeLessThanOrEqual(box.width);
    const place = fillPlace(W * scale, H * scale, box.width, box.height, 2.625);
    expect(place.left).toBeGreaterThanOrEqual(0);
    expect(place.top).toBeGreaterThanOrEqual(0);
    expect(Math.abs(place.left * 2 + W * scale - box.width)).toBeLessThanOrEqual(1);
  });

  it("carries the room's edge out as bands of its own colours, the first up to the top and the last down to the foot", () => {
    const bands = edgeBands(["#a", "#a", "#b", "#c", "#c"], -10, 4);
    expect(bands).toBe("linear-gradient(to bottom, #a 0px -2px, #b -2px 2px, #c 2px 100%)");
    expect(edgeBands([], 0, 1)).toBe("none");
  });
});

describe("the room carried on past its edges, in its own pattern", () => {
  // The bedroom's Plain Cream: a dot every 10 pixels (at 5, 15, 25 ...), on cream; the shade under the ceiling.
  // Packed as a canvas's pixels are read (a Uint32Array over RGBA, little-endian: 0xAABBGGRR).
  const CREAM = 0xffc6e4f2;
  const DOT = 0xffaad2e6;
  const SHADE = 0xffacc6d2;
  const SHELF = 0xff345a8a;
  const PALETTE = [0xff3e4a9a, 0xff8c5e3f, 0xff3e84a8, 0xff56743e, 0xff8e5a6a, 0xff40649a, 0xff14263e];
  const creamRow = (dots: boolean) => Array.from({ length: 240 }, (_, x) => (dots && x % 10 === 5 ? DOT : CREAM));
  const fromRight = (row: number[]) => [...row].reverse();
  // Stars on glass, books on a shelf: drawn at random (as pip/house.js's rnd), with no repeat.
  const noise = (x: number, seed: number) => PALETTE[Math.floor((Math.abs(Math.sin(x * 12.9898 + seed * 78.233)) * 43758.5453) % 1 * 7)];

  it("finds a row's repeat, and none where a thing stands at the edge or the pattern is drawn at random", () => {
    expect(rowPeriod(creamRow(true))).toBe(10);
    expect(rowPeriod(creamRow(false))).toBe(1);
    expect(rowPeriod(Array.from({ length: 240 }, (_, x) => (x < 20 ? SHELF : CREAM)))).toBeNull();
    expect(rowPeriod(Array.from({ length: 240 }, (_, x) => noise(x, 1)))).toBeNull();
  });

  it("carries the dots and the shade under the ceiling on with no seam, on both sides", () => {
    const room = [Array(240).fill(SHADE), creamRow(false), ...Array.from({ length: 20 }, (_, r) => creamRow(r % 10 === 5))];
    const width = 30;
    const left = edgePattern(room, room.map(() => CREAM), "left", width, room.length);
    const right = edgePattern(room.map(fromRight), room.map(() => CREAM), "right", width, room.length);
    // The shade runs on across the band.
    expect(Array.from(left.slice(0, width)).every((colour) => colour === SHADE)).toBe(true);
    // A dotted row: the band's columns are x = -30 .. -1 on the left, 240 .. 269 on the right, the dots where the
    // wallpaper's would be (x % 10 === 5).
    const row = 7;
    const leftRow = Array.from(left.slice(row * width, (row + 1) * width));
    const rightRow = Array.from(right.slice(row * width, (row + 1) * width));
    leftRow.forEach((colour, column) => expect(colour).toBe((((column - width) % 10) + 10) % 10 === 5 ? DOT : CREAM));
    rightRow.forEach((colour, column) => expect(colour).toBe((240 + column) % 10 === 5 ? DOT : CREAM));
  });

  it("takes the room's light drifting across its wallpaper for the same wallpaper, and meets the room in its own shade", () => {
    // The day through the window: the cream a shade lighter every other pixel, the dots likewise.
    const rgb = (r: number, g: number, b: number) => (0xff000000 | (Math.min(255, b) << 16) | (Math.min(255, g) << 8) | Math.min(255, r)) >>> 0;
    const lit = (x: number) => {
      const day = Math.floor(x / 4);
      return x % 10 === 5 ? rgb(200, 180 + day, 140 + day) : rgb(200, 200 + day, 190 + day);
    };
    const row = Array.from({ length: 240 }, (_, x) => lit(x));
    expect(rowPeriod(row)).toBe(10);
    const band = edgePattern([row], [CREAM], "left", 10, 1);
    // x = -1 is the repeat's last pixel nearest the edge (x = 9), as lit there.
    expect(band[9]).toBe(lit(9));
    expect(band[5]).toBe(lit(5));
  });

  it("carries a wall with no pattern on in one colour, not with a stray line of a window's bar or a shelf", () => {
    const glass = (seed: number) => Array.from({ length: 240 }, (_, x) => noise(x, seed));
    const bar = Array(240).fill(SHELF);
    const room = [Array(240).fill(SHADE), glass(1), glass(2), glass(3), bar, glass(4), glass(5), glass(6), bar, glass(7)];
    const band = edgePattern(room, room.map(() => CREAM), "left", 8, room.length);
    // The trim under the ceiling is kept; the lone bars go with the glass.
    expect(band[0]).toBe(SHADE);
    for (let r = 1; r < room.length; r++) expect(band[r * 8]).toBe(CREAM);
  });
});
