/**
 * Procedural surface grain.
 *
 * These replace three photographic textures totalling ~3.7 MB. Every place they
 * were used sits under a 88–94% opaque colour wash, so only a few percent of the
 * grain was ever visible — paying megabytes for it was poor value. Generated
 * noise is a few hundred bytes, tiles seamlessly (`stitchTiles`), and scales
 * with the theme instead of being baked into a photo.
 */

const svg = (markup: string) =>
  `url("data:image/svg+xml,${markup
    .replace(/\s+/g, " ")
    .trim()
    .replace(/</g, "%3C")
    .replace(/>/g, "%3E")
    .replace(/#/g, "%23")}")`;

/** Fine tooth of a paper sheet. */
export const PAPER_GRAIN = svg(`
  <svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'>
    <filter id='p' x='0' y='0' width='100%' height='100%'>
      <feTurbulence type='fractalNoise' baseFrequency='0.72' numOctaves='5'
                    stitchTiles='stitch' seed='5'/>
      <feColorMatrix type='saturate' values='0'/>
    </filter>
    <rect width='220' height='220' filter='url(#p)' opacity='0.4'/>
  </svg>
`);
