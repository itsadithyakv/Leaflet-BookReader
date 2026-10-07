import { useEffect, useState, type KeyboardEvent } from "react";
import { fontService, type CustomFont } from "../services/fontService";
import { customFontFaceCss, customFontId, customTypeface } from "./customFonts";
import { typefaceStack, type ReaderTypeface } from "./readerTypes";
import "./customFaces.css";

type CustomFacesProps = {
  typeface: ReaderTypeface;
  onTypeface: (next: ReaderTypeface) => void;
};

/** The arrow keys choose a typeface from a face (readers/TypePanel.tsx); from these buttons they do nothing. */
const keepArrows = (event: KeyboardEvent<HTMLElement>) => {
  if (event.key.startsWith("Arrow")) {
    event.stopPropagation();
  }
};

/**
 * The reader's own fonts among the typefaces (readers/TypePanel.tsx): a
 * choice for each, with a way to remove it, and a way to add another. They
 * are asked for when the panel opens. Nothing in the browser preview, which
 * has no files to add a font from.
 */
export const CustomFaces = ({ typeface, onTypeface }: CustomFacesProps) => {
  const [fonts, setFonts] = useState<CustomFont[]>([]);
  /** The list has been read: only then is a font not on it known to be gone. */
  const [listed, setListed] = useState(false);
  /** Each font's `@font-face`, for its sample, as its file arrives. */
  const [faces, setFaces] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const chosen = customFontId(typeface);

  const sample = async (id: string) => {
    const css = customFontFaceCss(id, await fontService.data(id));
    if (css) {
      setFaces((had) => ({ ...had, [id]: css }));
    }
  };

  useEffect(() => {
    if (!fontService.available()) {
      return;
    }
    let open = true;
    void (async () => {
      const found = await fontService.list().catch(() => null);
      if (!open || !found) {
        return;
      }
      // With any font added while the list was on its way.
      setFonts((had) => [...found, ...had.filter((font) => !found.some((other) => other.id === font.id))]);
      setListed(true);
      // One file at a time: the panel is up long before the last sample.
      for (const font of found) {
        if (open) {
          await sample(font.id);
        }
      }
    })();
    return () => {
      open = false;
    };
  }, []);

  // The typeface is a font that is no longer there (its file was removed, or
  // the choice is from before the fonts were deleted). The page is already in
  // the book serif, which stands behind every font; the choice says so too.
  useEffect(() => {
    if (listed && chosen && !fonts.some((font) => font.id === chosen)) {
      onTypeface("serif");
    }
  }, [listed, chosen, fonts]);

  if (!fontService.available()) {
    return null;
  }

  const add = async () => {
    setAdding(true);
    setProblem(null);
    try {
      const font = await fontService.pickAndAdd();
      if (font) {
        setFonts((had) => (had.some((other) => other.id === font.id) ? had : [...had, font]));
        onTypeface(customTypeface(font.id));
        void sample(font.id);
      }
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "That font could not be added.");
    } finally {
      setAdding(false);
    }
  };

  const remove = async (font: CustomFont) => {
    setProblem(null);
    try {
      await fontService.remove(font.id);
    } catch {
      setProblem(`${font.name} could not be removed.`);
      return;
    }
    setFonts((had) => had.filter((other) => other.id !== font.id));
    setFaces((had) => Object.fromEntries(Object.entries(had).filter(([id]) => id !== font.id)));
    if (chosen === font.id) {
      onTypeface("serif");
    }
  };

  return (
    <>
      {fonts.map((font) => {
        const face = customTypeface(font.id);
        const on = chosen === font.id;
        return (
          <span key={font.id} className="reader-type-own">
            {faces[font.id] && <style>{faces[font.id]}</style>}
            <button
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              data-face={face}
              title={font.name}
              className={`reader-type-option reader-border ${on ? "is-on" : ""}`}
              onClick={() => onTypeface(face)}
            >
              <span className="reader-type-sample" style={{ fontFamily: typefaceStack(face) ?? undefined }} aria-hidden="true">
                Aa
              </span>
              <span className="reader-type-own-name">{font.name}</span>
            </button>
            <button
              type="button"
              className="reader-type-own-remove"
              aria-label={`Remove ${font.name}`}
              title={`Remove ${font.name}`}
              onClick={() => void remove(font)}
              onKeyDown={keepArrows}
            >
              ×
            </button>
          </span>
        );
      })}
      <button
        type="button"
        className="reader-type-option reader-border"
        title="A font file of your own: .ttf, .otf, .woff or .woff2"
        disabled={adding}
        onClick={() => void add()}
        onKeyDown={keepArrows}
      >
        <span className="reader-type-sample" aria-hidden="true">
          +
        </span>
        <span>Add a font…</span>
      </button>
      {problem && (
        <p className="reader-type-problem reader-muted" role="alert">
          {problem}
        </p>
      )}
    </>
  );
};
