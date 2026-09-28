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
 * Clicking a marked image shows the original, and clicking again blends it.
 */
export const INK_SAMPLE = 40;
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
        let light = 0;
        let midtone = 0;
        let colourful = 0;
        let counted = 0;
        for (let i = 0; i < data.length; i += 4) {
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
            midtone += 1;
          }
        }
        // Transparent line art (dark ink, no background) also blends well.
        const transparentInk = counted < INK_SAMPLE * INK_SAMPLE * 0.6 && colourful / Math.max(1, counted) < 0.04;
        // Resampling blurs ink edges into greys, so a little midtone is fine.
        const inkOnly = counted > 0 && colourful / counted < 0.04 && midtone / counted < 0.12;
        if (inkOnly && (light / counted > 0.55 || transparentInk)) {
          const banner = probe.naturalHeight <= probe.naturalWidth * 0.6 || probe.naturalHeight <= 240;
          node.dataset.leafletInk = banner ? "title" : "art";
          node.addEventListener("click", () => {
            node.dataset.leafletInkOff = node.dataset.leafletInkOff ? "" : "1";
          });
        }
      } catch {
        // A cross-origin (tainted) image cannot be read; leave it be.
      }
    };
    probe.src = src;
  });
};
