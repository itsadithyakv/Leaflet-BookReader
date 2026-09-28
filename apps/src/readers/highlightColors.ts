/**
 * Highlight colours: the swatch the picker shows, and the fill drawn over the
 * text (translucent, multiplied, so the words stay legible on paper and on a
 * dark page alike).
 */
export const HIGHLIGHT_COLORS: Record<string, { name: string; swatch: string; fill: string }> = {
  yellow: { name: "Yellow", swatch: "#f4c542", fill: "#f4c542" },
  green: { name: "Green", swatch: "#7cc46a", fill: "#7cc46a" },
  blue: { name: "Blue", swatch: "#6aa8e8", fill: "#6aa8e8" },
  pink: { name: "Pink", swatch: "#ec8fb4", fill: "#ec8fb4" }
};

export const HIGHLIGHT_COLOR_IDS = Object.keys(HIGHLIGHT_COLORS);
