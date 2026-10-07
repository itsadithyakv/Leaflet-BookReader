/**
 * A font of the reader's own as a typeface (see readerTypes.ts for the ones
 * that come with the system). The file is kept by Rust
 * (src-tauri/src/fonts.rs), which gives it an id; the typeface chosen is then
 * `custom:<id>`, and each chapter is given an `@font-face` for it made from
 * the file's bytes.
 *
 * The id and the bytes both end up inside a stylesheet, so each is checked
 * to be only what it should be before it is written there.
 */
export type CustomTypeface = `custom:${string}`;

const PREFIX = "custom:";
/** As Rust makes them: sixteen hex digits of the file's hash. */
const ID = /^[0-9a-f]{16}$/;
/** As Rust hands a font over: its type, then base64 and nothing else. */
const DATA_HEAD = /^data:font\/(ttf|otf|woff|woff2);base64,/;
const NOT_BASE64 = /[^A-Za-z0-9+/=]/;
const FORMAT: Record<string, string> = { ttf: "truetype", otf: "opentype", woff: "woff", woff2: "woff2" };
const STYLE_ID = "reader-custom-font";

export const customTypeface = (id: string): CustomTypeface => `${PREFIX}${id}`;

/** The font a typeface names, or null when it is not one of the reader's own (or is not an id Rust could have made). */
export const customFontId = (typeface: string | null | undefined): string | null => {
  if (!typeface || !typeface.startsWith(PREFIX)) {
    return null;
  }
  const id = typeface.slice(PREFIX.length);
  return ID.test(id) ? id : null;
};

export const isCustomTypeface = (value: string): value is CustomTypeface => customFontId(value) !== null;

/** What the font is called in a stylesheet: by its id, never by the name its file had. */
export const customFamily = (id: string) => `"Leaflet font ${id}"`;

/**
 * The `@font-face` for a font, from the data URL Rust returned. Empty when
 * there is none to make: no data (the font is gone), or something that is
 * not a font's data URL. The text shows in the face behind until the font is
 * read, and stays in it if it never is.
 */
export const customFontFaceCss = (id: string, dataUrl: string | null | undefined): string => {
  const head = ID.test(id) && typeof dataUrl === "string" ? DATA_HEAD.exec(dataUrl) : null;
  if (!head || !dataUrl || dataUrl.length === head[0].length || NOT_BASE64.test(dataUrl.slice(head[0].length))) {
    return "";
  }
  const kind = head[1];
  return `@font-face { font-family: ${customFamily(id)}; src: url("${dataUrl}") format("${FORMAT[kind]}"); font-display: swap; }`;
};

/** A font ready for a page: its id, and its `@font-face`. */
export type CustomFontFace = { id: string; css: string };

/**
 * Puts the font's `@font-face` in a chapter's document, in a style element
 * of its own (the reader's stylesheet is written once a chapter; the font can
 * change, or arrive, later). Null takes it out. A document that already has
 * this font is left alone: the rule is the size of the file.
 */
export const applyCustomFont = (doc: Document, font: CustomFontFace | null) => {
  const existing = doc.getElementById(STYLE_ID);
  if (!font || !font.css) {
    existing?.remove();
    return;
  }
  if (existing?.getAttribute("data-font") === font.id) {
    return;
  }
  const style = existing ?? doc.createElement("style");
  style.id = STYLE_ID;
  style.setAttribute("data-font", font.id);
  style.textContent = font.css;
  if (!existing) {
    doc.head?.appendChild(style);
  }
};
