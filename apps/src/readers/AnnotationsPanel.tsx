import { useEffect, useMemo, useRef, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { UiIcon } from "../components/UiIcon";
import type { Annotation } from "../services/annotationService";
import { groupByChapter } from "../components/highlights/highlightsView";
import { noteDate } from "./HighlightCard";
import { HIGHLIGHT_COLORS, HIGHLIGHT_COLOR_IDS } from "./highlightColors";
import "./notes.css";

type Tab = "highlights" | "bookmarks";

type AnnotationsPanelProps = {
  bookmarks: Annotation[];
  /** In reading order. */
  highlights: Annotation[];
  /** Opens on this highlight ("All notes" from its card): shown, and marked out. */
  focusId?: string | null;
  onAddBookmark: () => void;
  /** What the bookmark button says, where it is not "Bookmark this page" (a PDF's takes the bookmark off again). */
  addBookmarkLabel?: string;
  onOpen: (cfi: string) => void;
  onRemove: (id: string) => void;
  onSaveNote: (id: string, note: string) => void;
  onRecolor: (id: string, color: string) => void;
  onCopy: (text: string) => void;
  /** A highlight as a picture to share. The button is there only when this is. */
  onShare?: (item: Annotation) => void;
  onExport: () => void;
  onClose: () => void;
};

/**
 * The reader's notes: every highlight with its note, under its chapter, and
 * the bookmarks. A panel of its own beside the page, like search and the
 * characters.
 *
 * It was a 320 px popover hung from the toolbar's bookmark icon, in the
 * toolbar's own small capitals: a list of grey boxes with the note as a line
 * of italics under each. It reads now as what it is, the reader's own
 * commonplace book for this novel: the book's words set as the book sets
 * them, the reader's beside them in their own voice.
 */
export const AnnotationsPanel = ({
  bookmarks,
  highlights,
  focusId = null,
  onAddBookmark,
  addBookmarkLabel = "Bookmark this page",
  onOpen,
  onRemove,
  onSaveNote,
  onRecolor,
  onCopy,
  onShare,
  onExport,
  onClose
}: AnnotationsPanelProps) => {
  const [tab, setTab] = useState<Tab>(focusId || highlights.length > 0 || bookmarks.length === 0 ? "highlights" : "bookmarks");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  /** Only this colour, or only those with a note. */
  const [colour, setColour] = useState<string | null>(null);
  const [notedOnly, setNotedOnly] = useState(false);
  const list = useRef<HTMLDivElement | null>(null);

  // The highlight it was opened on is brought into view.
  useEffect(() => {
    if (focusId) {
      list.current?.querySelector<HTMLElement>(`[data-note="${CSS.escape(focusId)}"]`)?.scrollIntoView({ block: "center" });
    }
  }, [focusId]);

  const used = useMemo(() => HIGHLIGHT_COLOR_IDS.filter((id) => highlights.some((item) => (item.color ?? "yellow") === id)), [highlights]);
  const noted = useMemo(() => highlights.filter((item) => item.note).length, [highlights]);
  const shown = useMemo(
    () => highlights.filter((item) => (!colour || (item.color ?? "yellow") === colour) && (!notedOnly || Boolean(item.note))),
    [highlights, colour, notedOnly]
  );

  const startEditing = (item: Annotation) => {
    setEditing(item.id);
    setDraft(item.note ?? "");
  };
  const stopEditing = (save: boolean) => {
    if (save && editing) {
      const before = highlights.find((item) => item.id === editing)?.note ?? "";
      if (draft.trim() !== before.trim()) {
        onSaveNote(editing, draft.trim());
      }
    }
    setEditing(null);
  };

  const tabButton = (id: Tab, label: string, count: number) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      className={`reader-notes-tab ${tab === id ? "is-active" : ""}`}
      onClick={() => {
        stopEditing(true);
        setTab(id);
      }}
    >
      {label} <span className="tabular-nums reader-muted">{count}</span>
    </button>
  );

  return (
    <div className="reader-notes-panel reader-panel reader-border" role="dialog" aria-label="Notes">
      <div className="reader-notes-head">
        <div role="tablist" aria-label="Notes" className="flex gap-1">
          {tabButton("highlights", "Highlights", highlights.length)}
          {tabButton("bookmarks", "Bookmarks", bookmarks.length)}
        </div>
        <button type="button" className="reader-mini-control" onClick={onClose} title="Close (Esc)" aria-label="Close notes">
          <UiIcon name="close" size={16} />
        </button>
      </div>

      {tab === "highlights" && highlights.length > 0 && (
        <div className="reader-notes-filters">
          <span className="flex items-center gap-1.5" role="group" aria-label="Show">
            <button type="button" className={`reader-notes-chip ${!colour && !notedOnly ? "is-on" : ""}`} aria-pressed={!colour && !notedOnly} onClick={() => { setColour(null); setNotedOnly(false); }}>
              All
            </button>
            {used.length > 1 &&
              used.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`reader-notes-dot ${colour === id ? "is-on" : ""}`}
                  style={{ ["--note-colour" as string]: HIGHLIGHT_COLORS[id].swatch }}
                  aria-pressed={colour === id}
                  title={`Only ${HIGHLIGHT_COLORS[id].name.toLowerCase()}`}
                  aria-label={`Only ${HIGHLIGHT_COLORS[id].name.toLowerCase()}`}
                  onClick={() => setColour(colour === id ? null : id)}
                />
              ))}
            {noted > 0 && noted < highlights.length && (
              <button type="button" className={`reader-notes-chip ${notedOnly ? "is-on" : ""}`} aria-pressed={notedOnly} onClick={() => setNotedOnly(!notedOnly)}>
                With a note <span className="tabular-nums reader-muted">{noted}</span>
              </button>
            )}
          </span>
          <button type="button" className="reader-notes-action" onClick={onExport} title="Copies every highlight and note as Markdown">
            Copy all
          </button>
        </div>
      )}

      <div ref={list} className="reader-notes-list">
        {tab === "highlights" && highlights.length === 0 && (
          <div className="reader-notes-empty">
            <UiIcon name="highlight" size={22} />
            <p className="reader-text-color">Nothing highlighted yet</p>
            <p className="reader-muted">Select words in the book to highlight them.</p>
          </div>
        )}
        {tab === "highlights" && highlights.length > 0 && shown.length === 0 && (
          <div className="reader-notes-empty">
            <p className="reader-muted">None like that.</p>
          </div>
        )}

        {/* Under their chapters, by place and not by name (two chapters called
            "Tyrion" are two headings); in a set of books the book is named
            once, above its chapters. As the Library's Highlights dialog. */}
        {tab === "highlights" &&
          groupByChapter(shown).flatMap((group, at) => [
            group.book && group.opensBook ? (
              <h3 key={`book-${at}`} className="reader-notes-book reader-text-color">
                {group.book}
              </h3>
            ) : null,
            <section key={`chapter-${at}`} className="reader-notes-chapter" aria-label={group.chapter ?? "Highlights"}>
              {group.chapter && (
                <h4 className="reader-notes-chapter-head reader-muted">
                  <span>{group.chapter}</span>
                  <span className="tabular-nums">{group.items.length}</span>
                </h4>
              )}
              {group.items.map((item) => {
                const swatch = (HIGHLIGHT_COLORS[item.color ?? "yellow"] ?? HIGHLIGHT_COLORS.yellow).swatch;
                return (
                  <article
                    key={item.id}
                    data-note={item.id}
                    className={`reader-notes-item ${focusId === item.id ? "is-focus" : ""}`}
                    style={{ ["--note-colour" as string]: swatch }}
                  >
                    <button type="button" className="reader-notes-quote" onClick={() => onOpen(item.cfi)} title="Go to this place in the book">
                      {item.text}
                    </button>

                    {editing === item.id ? (
                      <div className="reader-notes-edit">
                        <textarea
                          className="reader-note-field"
                          rows={3}
                          value={draft}
                          autoFocus
                          placeholder="Write a note…"
                          maxLength={8000}
                          onChange={(event) => setDraft(event.target.value)}
                          onKeyDown={(event) => {
                            event.stopPropagation();
                            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                              event.preventDefault();
                              stopEditing(true);
                            } else if (event.key === "Escape") {
                              event.preventDefault();
                              stopEditing(false);
                            }
                          }}
                        />
                        <div className="reader-notes-edit-foot">
                          <span className="flex gap-2">
                            <button type="button" className="reader-notes-action" onClick={() => stopEditing(false)}>
                              Cancel
                            </button>
                            <button type="button" className="reader-notes-action is-primary" onClick={() => stopEditing(true)} title="Save (Ctrl+Enter)">
                              Save
                            </button>
                          </span>
                        </div>
                      </div>
                    ) : (
                      item.note && (
                        <button type="button" className="reader-notes-note" onClick={() => startEditing(item)} title="Edit your note">
                          {item.note}
                        </button>
                      )
                    )}

                    {editing !== item.id && (
                      <div className="reader-notes-item-foot">
                        <span className="reader-muted">{noteDate(item.createdAt)}</span>
                        <span className="reader-notes-item-tools">
                          <span className="reader-notes-recolour" role="group" aria-label="Colour">
                            {HIGHLIGHT_COLOR_IDS.filter((id) => id !== (item.color ?? "yellow")).map((id) => (
                              <button
                                key={id}
                                type="button"
                                className="reader-notes-dot is-small"
                                style={{ ["--note-colour" as string]: HIGHLIGHT_COLORS[id].swatch }}
                                title={`Make it ${HIGHLIGHT_COLORS[id].name.toLowerCase()}`}
                                aria-label={`Make it ${HIGHLIGHT_COLORS[id].name.toLowerCase()}`}
                                onClick={() => onRecolor(item.id, id)}
                              />
                            ))}
                          </span>
                          {!item.note && (
                            <button type="button" className="reader-notes-tool" onClick={() => startEditing(item)} title="Write a note" aria-label="Write a note">
                              <UiIcon name="note" size={14} />
                            </button>
                          )}
                          {onShare && (
                            <button type="button" className="reader-notes-tool" onClick={() => onShare(item)} title="Share as a picture" aria-label="Share as a picture">
                              <ImageIcon size={14} aria-hidden="true" />
                            </button>
                          )}
                          <button type="button" className="reader-notes-tool" onClick={() => onCopy(item.note ? `${item.text ?? ""}\n\n${item.note}` : (item.text ?? ""))} title="Copy" aria-label="Copy">
                            <UiIcon name="copy" size={14} />
                          </button>
                          <button type="button" className="reader-notes-tool" onClick={() => onRemove(item.id)} title="Remove this highlight" aria-label="Remove highlight">
                            <UiIcon name="trash" size={14} />
                          </button>
                        </span>
                      </div>
                    )}
                  </article>
                );
              })}
            </section>
          ])}

        {tab === "bookmarks" && (
          <button type="button" className="reader-notes-add" onClick={onAddBookmark} title="Bookmarks the line under the toolbar (Ctrl+D)">
            <UiIcon name="bookmark" size={15} />
            {addBookmarkLabel}
          </button>
        )}
        {tab === "bookmarks" && bookmarks.length === 0 && (
          <div className="reader-notes-empty">
            <p className="reader-muted">No bookmarks yet.</p>
          </div>
        )}
        {tab === "bookmarks" &&
          bookmarks.map((item) => (
            <div key={item.id} className="reader-notes-bookmark">
              <button type="button" className="reader-notes-bookmark-go" onClick={() => onOpen(item.cfi)} title="Go to this bookmark">
                <UiIcon name="bookmark" size={15} />
                <span className="min-w-0 flex-1">
                  <span className="reader-notes-bookmark-name reader-text-color">{item.chapter || "Bookmark"}</span>
                  <span className="reader-muted">{noteDate(item.createdAt)}</span>
                </span>
              </button>
              <button type="button" className="reader-notes-tool" onClick={() => onRemove(item.id)} title="Remove this bookmark" aria-label="Remove bookmark">
                <UiIcon name="trash" size={14} />
              </button>
            </div>
          ))}
      </div>
    </div>
  );
};
