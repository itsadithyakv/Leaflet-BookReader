import { useEffect, useRef } from "react";
import { UiIcon } from "../components/UiIcon";
import "./shortcutsSheet.css";

export type ShortcutsSheetSection = { title: string; rows: Array<{ keys: string[]; label: string }> };

type ShortcutsSheetProps = {
  /** What is being described ("Scrolling · Smart Read"). */
  context?: string;
  /** The keys, in sections. The text reader builds its own from its key table (readers/readerKeys.ts); any reader may pass a list. */
  sections: ShortcutsSheetSection[];
  onClose: () => void;
};

/**
 * The keyboard shortcuts, on a sheet over the page. It lists what it is
 * given, so a reader with its own keys can show its own. Escape, the close
 * button or a click beside it closes it.
 */
export const ShortcutsSheet = ({ context, sections, onClose }: ShortcutsSheetProps) => {
  const sheet = useRef<HTMLDivElement | null>(null);

  // The keyboard comes to the sheet, and goes back where it was.
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheet.current?.focus({ preventScroll: true });
    return () => {
      if (before?.isConnected) {
        before.focus({ preventScroll: true });
      }
    };
  }, []);

  return (
    <div className="reader-shortcuts-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={sheet}
        className="reader-shortcuts reader-panel reader-border"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reader-shortcuts-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          } else if (event.key === "Tab") {
            // One thing to focus besides the sheet: Tab stays in.
            event.preventDefault();
            sheet.current?.querySelector<HTMLElement>("button")?.focus();
          }
        }}
      >
        <div className="reader-shortcuts-head">
          <div>
            <h2 id="reader-shortcuts-title" className="font-headline text-lg font-bold reader-text-color">
              Keyboard shortcuts
            </h2>
            {context && <p className="reader-shortcuts-context reader-muted">{context}</p>}
          </div>
          <button type="button" className="reader-mini-control" onClick={onClose} title="Close (Esc)" aria-label="Close keyboard shortcuts">
            <UiIcon name="close" size={16} />
          </button>
        </div>
        <div className="reader-shortcuts-body">
          {sections.map((section) => (
            <section key={section.title} aria-label={section.title}>
              <h3 className="reader-shortcuts-title reader-muted">{section.title}</h3>
              <dl>
                {section.rows.map((row) => (
                  <div key={`${row.keys.join(" ")}-${row.label}`} className="reader-shortcuts-row">
                    <dt>
                      {row.keys.map((key, index) => (
                        <span key={key}>
                          {index > 0 && <span className="reader-muted"> or </span>}
                          <kbd>{key}</kbd>
                        </span>
                      ))}
                    </dt>
                    <dd>{row.label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};
