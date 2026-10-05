import { useRef, useState } from "react";
import { resolveBookLink } from "../bookLinks";
import { classifyNoteLink, elementById, linkFacts, noteBlockOf, noteText, targetFacts, type NoteRun } from "../footnotes";
import { setInkOff } from "../pictures";
import { type ViewedPicture } from "../ImageViewer";
import type { WithMarks } from "./scope";

/** A book's own links: a footnote shown in place, a picture opened large. */
export const useNotesAndPictures = (reader: WithMarks) => {
  const { bookRef, clearSelectionRef, displayChapter, noteJumpFromHere, renditionRef, selectionRef } = reader;
  const followBookLinkRef = useRef<(anchor: Element, sectionIndex: number | undefined) => void>(() => undefined);
  /**
   * A footnote shown in place (readers/footnotes.ts): its words, and where it
   * is for "Go to note". Plain text only, so it outlives the chapter it was
   * read from.
   */
  const [note, setNote] = useState<{ href: string; marker: string; paragraphs: NoteRun[][]; truncated: boolean } | null>(null);
  const noteRef = useRef(note);
  noteRef.current = note;
  /** Counts note look-ups: one that comes back after another was asked for is dropped. */
  const noteRequestRef = useRef(0);
  const closeNoteRef = useRef<() => void>(() => undefined);
  /** A picture from the book, opened large (readers/ImageViewer.tsx). */
  const [picture, setPicture] = useState<ViewedPicture | null>(null);
  const pictureRef = useRef(picture);
  pictureRef.current = picture;
  const openPictureRef = useRef<(found: ViewedPicture) => void>(() => undefined);

  /**
   * A link within the book was clicked (from the book's own documents, bound
   * once). It is a jump like any other: the line left is kept, and the place
   * is gone to the reader's way, clear of the toolbar. epub.js's own handling
   * went to the very top of the window, and in the scrolling layout showed a
   * neighbouring section for a link into the middle of a file.
   */
  followBookLinkRef.current = (anchor, sectionIndex) => {
    const epub = bookRef.current as any;
    const section = typeof sectionIndex === "number" ? epub?.spine?.get?.(sectionIndex) : null;
    const link = resolveBookLink(anchor.getAttribute("href") ?? "", String(section?.href ?? ""));
    const targetSection = link ? epub?.spine?.get?.(link.path) : null;
    if (!link || !targetSection) {
      return;
    }
    const jump = () => {
      noteJumpFromHere();
      displayChapter(link.href, { useSaved: false });
    };
    if (!link.id) {
      jump();
      return;
    }
    // A note reference shows its note here instead of leaving the page
    // (readers/footnotes.ts); anything else is a jump, as it always was.
    const facts = linkFacts(anchor);
    const request = (noteRequestRef.current += 1);
    const show = (target: Element | null) => {
      if (request !== noteRequestRef.current || bookRef.current !== epub) {
        return;
      }
      const isNote = target !== null && classifyNoteLink({ ...facts, target: targetFacts(target) }) === "note";
      const text = isNote && target ? noteText(noteBlockOf(target)) : null;
      if (!text || text.paragraphs.length === 0) {
        jump();
        return;
      }
      if (selectionRef.current) {
        clearSelectionRef.current();
      }
      setNote({ href: link.href, marker: facts.text.trim(), ...text });
    };
    try {
      if (targetSection.index === sectionIndex) {
        show(elementById(anchor.ownerDocument, link.id));
        return;
      }
      // Another file: on the page already (scrolling shows several chapters),
      // or read through epub.js and let go again.
      const shown = (renditionRef.current?.manager as any)?.views?.find?.(targetSection)?.contents?.document as Document | undefined;
      if (shown) {
        show(elementById(shown, link.id));
        return;
      }
      void Promise.resolve(targetSection.load(epub.load.bind(epub)))
        .then(
          (root: Element | undefined) => {
            const doc: Document | undefined = targetSection.document ?? root?.ownerDocument;
            show(doc ? elementById(doc, link.id) : null);
          },
          () => show(null)
        )
        .then(() => {
          try {
            targetSection.unload?.();
          } catch {
            // Already let go.
          }
        });
    } catch {
      jump();
    }
  };
  closeNoteRef.current = () => {
    noteRequestRef.current += 1;
    setNote(null);
  };
  const goToNote = () => {
    const open = noteRef.current;
    if (!open) {
      return;
    }
    noteJumpFromHere();
    displayChapter(open.href, { useSaved: false });
  };

  openPictureRef.current = (found) => {
    closeNoteRef.current();
    setPicture(found);
  };
  /** "Show as drawn" / "Blend with page", from the viewer: every copy of the picture on the page. */
  const togglePictureInk = () => {
    const open = pictureRef.current;
    if (!open) {
      return;
    }
    const docs = ((renditionRef.current?.getContents?.() ?? []) as any[])
      .map((contents) => contents?.document as Document | undefined)
      .filter((doc): doc is Document => Boolean(doc));
    setInkOff(docs, open.src, !open.inkOff);
    setPicture({ ...open, inkOff: !open.inkOff });
  };

  return {
    followBookLinkRef, note, setNote, noteRef, noteRequestRef, closeNoteRef, picture, setPicture, pictureRef,
    openPictureRef, goToNote, togglePictureInk
  };
};
