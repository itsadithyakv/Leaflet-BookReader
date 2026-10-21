/**
 * Pictures that are the same, as one picture.
 *
 * A move's frames, and a room's, are each drawn once and kept; many of them are
 * the same pixels as the one before (a held pose, a room whose only motion is a
 * lamp that flickers now and then). Given the same object for the same pixels,
 * whatever draws them can skip a frame that would put up what is already
 * there: nothing is drawn again, and the screen has nothing new to show.
 *
 * Asked once, when a frame is first drawn (a few KB of pixels for a sprite):
 * never on the frames that follow.
 */
export type Pixels = { width: number; height: number; data: ArrayLike<number> };

/** Two 32-bit hashes of the pixels, so pictures that differ almost never share one; equal ones are compared in full. */
export const pixelKey = (picture: Pixels) => {
  const data = picture.data;
  let a = 0x811c9dc5;
  let b = 0x2545f491;
  // Four bytes at a time would be quicker in a Uint32Array, but `data` may be any array of bytes.
  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    a = Math.imul(a ^ byte, 0x01000193);
    b = Math.imul(b + byte + (b << 6), 0x5bd1e995) ^ (b >>> 13);
  }
  return `${picture.width}x${picture.height}:${(a >>> 0).toString(36)}:${(b >>> 0).toString(36)}`;
};

const samePixels = (one: Pixels, other: Pixels) => {
  if (one.width !== other.width || one.height !== other.height || one.data.length !== other.data.length) return false;
  for (let i = 0; i < one.data.length; i++) if (one.data[i] !== other.data[i]) return false;
  return true;
};

/**
 * A pool of pictures: `same(picture)` gives back the first picture it was
 * given with these pixels (or this one, now the first). Capped: a pool past
 * `cap` pictures starts again, which only costs a frame drawn twice.
 */
export const picturePool = <T extends Pixels>(cap = 4000) => {
  const kept = new Map<string, T[]>();
  let count = 0;
  return {
    same(picture: T): T {
      const key = pixelKey(picture);
      const found = kept.get(key);
      if (found) {
        for (const other of found) if (other === picture || samePixels(other, picture)) return other;
      }
      if (count >= cap) {
        kept.clear();
        count = 0;
      }
      count += 1;
      if (found && kept.has(key)) found.push(picture);
      else kept.set(key, [picture]);
      return picture;
    },
    clear() {
      kept.clear();
      count = 0;
    },
    get size() {
      return count;
    }
  };
};

/**
 * What a canvas last showed, so the same picture is not put up again. `put`
 * says whether the picture was new to the canvas (and so was drawn).
 */
export const shownOnce = <T>() => {
  let shown: T | null = null;
  return {
    put(picture: T, draw: (picture: T) => void) {
      if (picture === shown) return false;
      shown = picture;
      draw(picture);
      return true;
    },
    /** The canvas was cleared or resized: the next picture is drawn whatever it is. */
    forget() {
      shown = null;
    }
  };
};
