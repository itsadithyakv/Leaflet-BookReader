/**
 * Chapter titles, drop caps and ornaments in many books are pictures: black
 * ink on a white rectangle. On a dark page that is a glaring white box; on the
 * paper finish it is a whiter patch on cream.
 *
 * Such images are recognised by their pixels: no colour, and almost nothing
 * but paper and ink (few in-between greys, which photos, shaded maps and
 * pencil drawings are full of). They are marked `data-leaflet-ink`:
 * - "title" when banner-shaped (wide and short, or small): on a dark page
 *   these are inverted to white ink, so a heading reads like the text.
 * - "art" otherwise (a line map, a full-page drawing): these only lose their
 *   white on the paper finish, and on a dark page stay exactly as drawn, so a
 *   map is never turned into its negative.
 * A click on a picture opens it in the picture viewer, which offers "Show as
 * drawn" and "Blend with page" for a marked one (`data-leaflet-ink-off`; see
 * readers/pictures.ts). It used to be the click itself that switched them.
 */
export const INK_SAMPLE = 40;

/** What a sample of a picture's pixels holds. */
export type InkStats = {
  /** Pixels that are not transparent, of `total` sampled. */
  counted: number;
  total: number;
  /** Paper: nearly white. */
  light: number;
  /** Neither paper nor ink. */
  midtone: number;
  colourful: number;
  /** The share of the midtones that are one grey (within 14 levels of their middle one). */
  midFlat: number;
};

/** Counts a sample (RGBA bytes, as a canvas gives them). */
export const sampleStats = (data: ArrayLike<number>): InkStats => {
  let light = 0;
  let colourful = 0;
  let counted = 0;
  const mids: number[] = [];
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 16) {
      continue;
    }
    counted += 1;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min > 40) {
      colourful += 1;
    }
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (lum > 225) {
      light += 1;
    } else if (lum > 70) {
      mids.push(lum);
    }
  }
  mids.sort((a, b) => a - b);
  const middle = mids.length > 0 ? mids[Math.floor(mids.length / 2)] : 0;
  const near = mids.filter((lum) => Math.abs(lum - middle) <= 14).length;
  return { counted, total: Math.floor(data.length / 4), light, midtone: mids.length, colourful, midFlat: mids.length > 0 ? near / mids.length : 0 };
};

/**
 * Whether a picture is ink on paper, and which kind ("title": banner-shaped
 * or small, inverted on a dark page; "art": only loses its white on a light
 * one). Null for a photograph, a painting, a shaded drawing.
 *
 * Two ways to be ink. Paper and ink and almost nothing between (a little
 * grey at the letters' edges). Or paper and ONE flat grey: outlined letters
 * filled with a tint, an ornament drawn in grey. Those have no ink-black to
 * speak of, a quarter of their pixels are "midtones", and they stayed white
 * boxes on a dark page: thirty chapter headings in one novel, every
 * scene-break ornament in another. A shaded drawing or a photograph on
 * white has greys of every level, not one.
 *
 * `fixed`: the picture cannot be opened in the viewer (it is a link).
 */
export const inkKind =(stats: InkStats, width: number, height: number, fixed = false): "title" | "art" | null => {
  const { counted, total, light, midtone, colourful, midFlat } = stats;
  if (counted <= 0 || colourful / counted >= 0.04) {
    return null;
  }
  // Transparent line art (dark ink, no background) also blends well.
  const transparentInk = counted < total * 0.6;
  // Resampling blurs ink edges into greys, so a little midtone is fine.
  const inkOnly = midtone / counted < 0.12 && (light / counted > 0.55 || transparentInk);
  const flatGrey = light / counted > 0.55 && midtone / counted <= 0.4 && midFlat >= 0.8;
  if (!inkOnly && !flatGrey) {
    return null;
  }
  // What is blended on a dark page too ("title"): a banner, or a picture
  // that is small whatever its shape (a medallion with a part's name in it,
  // a publisher's mark), or one that cannot be opened in the viewer, where
  // the switch between "as drawn" and "blended" is: a picture that is a
  // link, or too small to open. Only a large drawing that the viewer can
  // show (a map, a full-page plate) is left as drawn on a dark page.
  const banner = height <= width * 0.6 || height <= 240;
  const small = Math.max(width, height) <= INK_SMALL;
  return banner || small || fixed ? "title" : "art";
};

/** An ink picture no larger than this either way is blended on a dark page whatever its shape. */
export const INK_SMALL = 480;
export const markInkImages = (doc: Document) => {
  const images = Array.from(doc.querySelectorAll<HTMLImageElement | SVGImageElement>("img, image"));
  images.forEach((node) => {
    if (node.dataset.leafletInkChecked) {
      return;
    }
    node.dataset.leafletInkChecked = "1";
    // epub.js swaps the image's address for its own blob URL after the page
    // is first built, so the check waits for the image itself to load, and a
    // probe that fails (the old address) clears the flag to be tried again.
    // Tag names, not instanceof: the book's images belong to its iframe,
    // whose HTMLImageElement is a different class from this window's.
    const isImg = node.tagName.toLowerCase() === "img";
    if (isImg && !(node as HTMLImageElement).complete) {
      delete node.dataset.leafletInkChecked;
      node.addEventListener("load", () => markInkImages(doc), { once: true });
      return;
    }
    const src =
      isImg
        ? (node as HTMLImageElement).currentSrc || (node as HTMLImageElement).src
        : (node as SVGImageElement).href?.baseVal || node.getAttribute("xlink:href") || "";
    if (!src) {
      delete node.dataset.leafletInkChecked;
      return;
    }
    const probe = new Image();
    probe.onerror = () => {
      delete node.dataset.leafletInkChecked;
    };
    probe.onload = () => {
      try {
        const canvas = doc.createElement("canvas");
        canvas.width = INK_SAMPLE;
        canvas.height = INK_SAMPLE;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context || probe.naturalWidth < 24 || probe.naturalHeight < 12) {
          return;
        }
        // Nearest-neighbour sampling: smoothing blurs thick letters into greys,
        // and a real ink title then failed the paper-and-ink test.
        context.imageSmoothingEnabled = false;
        context.drawImage(probe, 0, 0, INK_SAMPLE, INK_SAMPLE);
        const { data } = context.getImageData(0, 0, INK_SAMPLE, INK_SAMPLE);
        // (A picture that is a link does not open the viewer: readers/pictures.ts.)
        const kind = inkKind(sampleStats(data), probe.naturalWidth, probe.naturalHeight, Boolean(node.closest("a[href]")));
        if (kind) {
          node.dataset.leafletInk = kind;
        }
      } catch {
        // A cross-origin (tainted) image cannot be read; leave it be.
      }
    };
    probe.src = src;
  });
};
