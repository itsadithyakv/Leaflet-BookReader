import { footerText, nextFooterMode, shownFooterMode, type FooterFacts } from "../phoneReading";
import type { ReaderScope } from "./scope";

/**
 * What a phone shows over the page while the chrome is away
 * (readers/phoneReading.ts): one faint line at the foot (a tap on it says
 * something else), a ribbon in the top right corner while the place is
 * bookmarked, and for a few seconds after a jump the way back.
 */
export const PhoneReadingMarks = ({ reader }: { reader: ReaderScope }) => {
  const { backChip, clock, clockLeads, footerMode, goBackFromChip, loading, outlook, pageMarked, pageOf, paged, phoneReading, setFooterMode } = reader;
  if (!phoneReading || loading) {
    return null;
  }
  const facts: FooterFacts = {
    chapter: outlook.chapter,
    book: outlook.book,
    progress: outlook.progress,
    pageOf: paged ? pageOf : null,
    clock,
    clockLeads
  };
  const shown = shownFooterMode(footerMode, facts);
  const line = footerText(footerMode, facts);
  return (
    <>
      {line && (
        <button
          type="button"
          className="reader-phone-footer"
          onClick={() => setFooterMode(nextFooterMode(shown ?? footerMode, facts))}
          aria-label={`${line}. Tap to show something else`}
        >
          {line}
        </button>
      )}
      {pageMarked && <span className="reader-bookmark-ribbon" aria-hidden="true" />}
      {backChip && (
        <button type="button" className="reader-back-chip reader-panel reader-border reader-text-color" onClick={goBackFromChip}>
          <span className="material-symbols-outlined" aria-hidden="true">
            arrow_back
          </span>
          <span className="reader-back-chip-label">Back to {backChip.label}</span>
        </button>
      )}
    </>
  );
};
