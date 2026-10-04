import { beforeAll, describe, expect, it } from "vitest";
import { ACCESSORIES, LIB, SKINS, dress, renderFrame, resolve } from "./core";
import { AVATARS } from "./avatars";
import { PORTRAIT_PX, SPRITE_PX, artOf, portraitPlacement, portraitScale, type Art, type Pixels } from "./portrait";

/** A 32px frame with the given boxes [left, top, right, bottom] drawn solid, and optionally a faint one. */
const frame = (boxes: number[][], faint: number[][] = []): Pixels => {
  const data = new Uint8ClampedArray(SPRITE_PX * SPRITE_PX * 4);
  const fill = (list: number[][], alpha: number) => {
    for (const [left, top, right, bottom] of list) {
      for (let y = top; y <= bottom; y++) {
        for (let x = left; x <= right; x++) {
          data[(y * SPRITE_PX + x) * 4 + 3] = alpha;
        }
      }
    }
  };
  fill(faint, 0x40);
  fill(boxes, 255);
  return { data, width: SPRITE_PX, height: SPRITE_PX };
};

/** How many drawn pixels the round frame cuts, and how many of those are above `row`. */
const cut = (art: Art, frameSize: number, row = 0) => {
  const at = portraitPlacement(frameSize, art);
  let pixels = 0;
  let above = 0;
  for (let y = 0; y < SPRITE_PX; y++) {
    for (let x = 0; x < SPRITE_PX; x++) {
      if (!art.solid[y * SPRITE_PX + x]) {
        continue;
      }
      // The device-pixel corners of this sprite pixel, against the circle in the canvas.
      const corners = [0, 1].flatMap((i) => [0, 1].map((j) => [at.x + (x + i) * at.perPixel, at.y + (y + j) * at.perPixel]));
      if (corners.some(([px, py]) => Math.hypot(px - frameSize / 2, py - frameSize / 2) > frameSize / 2)) {
        pixels += 1;
        above += y < row ? 1 : 0;
      }
    }
  }
  return { pixels, above, perPixel: at.perPixel };
};

describe("how large a portrait is drawn", () => {
  it("is the largest whole scale at which a standing Pip fits the frame", () => {
    // The header's 44px face: 44, 55, 66 and 88 device pixels at 100%, 125%, 150% and 200%.
    expect([44, 55, 66, 88].map(portraitScale)).toEqual([1, 2, 2, 3]);
    // A 40px board avatar at 125% has no room to double; an 80px reader card triples.
    expect(portraitScale(50)).toBe(1);
    expect(portraitScale(100)).toBe(3);
    expect(portraitScale(2 * PORTRAIT_PX)).toBe(2);
    expect(portraitScale(2 * PORTRAIT_PX - 1)).toBe(1);
  });

  it("is never less than one, however small the frame", () => {
    expect(portraitScale(12)).toBe(1);
    expect(portraitScale(0)).toBe(1);
  });
});

describe("what a portrait is framed by", () => {
  it("is the box around the drawn pixels, not the faint shadow under them", () => {
    const art = artOf([frame([[5, 5, 26, 30]], [[8, 31, 23, 31]])]);
    expect(art).toMatchObject({ left: 5, top: 5, right: 26, bottom: 30 });
  });

  it("takes in every frame of a move that plays", () => {
    const art = artOf([frame([[10, 10, 20, 28]]), frame([[2, 12, 8, 20]]), frame([[14, 3, 16, 9]])]);
    expect(art).toMatchObject({ left: 2, top: 3, right: 20, bottom: 28 });
  });

  it("is nothing when nothing is drawn", () => {
    expect(artOf([frame([])])).toBeNull();
    // The sprite then just sits in the middle of the frame.
    expect(portraitPlacement(55, null)).toEqual({ perPixel: 2, x: -4, y: -4 });
  });
});

describe("where a portrait is drawn", () => {
  it("puts the middle of the art, not of the canvas, in the middle of the frame", () => {
    // 22 by 22 with its middle at (16, 20), in an 80px frame at two pixels each.
    const art = artOf([frame([[5, 9, 26, 30]])]);
    expect(portraitPlacement(80, art)).toEqual({ perPixel: 2, x: 8, y: 0 });
  });

  it("moves the drawing down in a tight frame, to trim the feet rather than the head", () => {
    // 27 tall with a narrow top right of the middle, like Pip and its leaf.
    // Centred, its top would be at -9 or -10 and the frame would cut the tip.
    const art = artOf([frame([[5, 14, 26, 31], [18, 5, 20, 13]])])!;
    expect(portraitPlacement(55, art)).toMatchObject({ perPixel: 2, y: -8 });
    expect(cut(art, 55, 8).above).toBe(0);
  });

  it("leaves a prop far out to one side to the crop, and stays centred", () => {
    // A balloon up in the corner: no small move brings it in, so none is made.
    const art = artOf([frame([[10, 14, 26, 31], [0, 2, 4, 7]])]);
    expect(portraitPlacement(55, art).y).toBeLessThanOrEqual(-6);
  });

  it("lands every sprite pixel on a whole device pixel", () => {
    const art = artOf([frame([[5, 14, 26, 31], [18, 5, 20, 13]])]);
    for (const size of [44, 55, 57, 66, 77, 88, 100]) {
      const at = portraitPlacement(size, art);
      expect(Number.isInteger(at.x) && Number.isInteger(at.y)).toBe(true);
      expect(at.perPixel).toBe(portraitScale(size));
    }
  });
});

describe("Pip's own art in a profile picture", () => {
  beforeAll(() => {
    // The engine draws into an ImageData; outside a browser a plain one will do.
    (globalThis as { ImageData?: unknown }).ImageData ??= class {
      data: Uint8ClampedArray;
      constructor(public width: number, public height: number) {
        this.data = new Uint8ClampedArray(width * height * 4);
      }
    };
  });

  const move = (id: string) => LIB.find((entry) => entry.id === id)!;
  const poster = (moveId: string, skinId: string, outfit: string[] = []) => {
    const pose = move(moveId);
    const skin = dress(SKINS.find((entry) => entry.id === skinId)!, outfit);
    return artOf([renderFrame(pose, pose.poster, resolve(skin, pose.poster))])!;
  };

  it("is about 22 by 27 of the 32px canvas when Pip just stands", () => {
    expect(poster("idle", "sprout")).toMatchObject({ left: 5, top: 5, right: 26, bottom: 31 });
  });

  it("doubles in the header at 125%, and a standing Pip still fits", () => {
    // 55 device pixels: the 44px face at 125%. All that goes is the pixel at
    // the tip of the leaf and the outer corners of the feet.
    const shown = cut(poster("idle", "sprout"), 55);
    expect(shown.perPixel).toBe(2);
    expect(shown.pixels).toBeLessThanOrEqual(4);
  });

  it("keeps every skin's head there: the leaf or the hat, whatever it wears below", () => {
    // Pip's body starts at row 14; a cape may lose its corners below that.
    for (const skin of SKINS) {
      expect(cut(poster("idle", skin.id), 55, 14).above, skin.id).toBeLessThanOrEqual(1);
    }
  });

  it("keeps hats whole too, at the cost of the feet", () => {
    for (const hat of ACCESSORIES.filter((item) => item.slot === "head")) {
      expect(cut(poster("idle", "sprout", [hat.id]), 55, 14).above, hat.id).toBeLessThanOrEqual(1);
    }
  });

  it("cuts nothing at all once the frame has room for the whole pose", () => {
    // 66 device pixels: the header at 150%; 100: a reader card at 125%.
    for (const avatar of AVATARS) {
      const art = poster(avatar.move, avatar.skin);
      const widest = Math.max(art.right - art.left, art.bottom - art.top) + 1;
      if (Math.hypot(widest, widest) <= 33) {
        expect(cut(art, 66).pixels, avatar.id).toBe(0);
      }
    }
    expect(cut(poster("idle", "sprout"), 100).pixels).toBe(0);
  });
});
