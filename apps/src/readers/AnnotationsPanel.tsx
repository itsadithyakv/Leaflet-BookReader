import { UiIcon } from "../components/UiIcon";
import { useState } from "react";
import type { Annotation } from "../services/annotationService";
import { HIGHLIGHT_COLORS } from "./highlightColors";

type Tab = "bookmarks" | "highlights";

type AnnotationsPanelProps = {
  bookmarks: Annotation[];
  /** In reading order. */
  highlights: Annotation[];
  /** Opens with this highlight's note being edited (from a tap on it in the page). */
  focusId?: string | null;
  onAddBookmark: () => void;
  onOpen: (cfi: string) => void;
  onRemove: (id: string) => void;
  onSaveNote: (id: string, note: string) => void;
  onExport: () => void;
};

/**
 * The reader's notes: bookmarks, and highlights with their notes. Replaces a
 * bookmarks-only popover whose list lived in the webview's storage.
 */
export const AnnotationsPanel = ({
  bookmarks,
  highlights,
  focusId = null,
  onAddBookmark,
  onOpen,
  onRemove,
  onSaveNote,
  onExport
}: AnnotationsPanelProps) => {
  const [tab, setTab] = useState<Tab>(focusId || (bookmarks.length === 0 && highlights.length > 0) ? "highlights" : "bookmarks");
  const [editing, setEditing] = useState<string | null>(focusId);
  const [draft, setDraft] = useState(() => highlights.find((item) => item.id === focusId)?.note ?? "");

  const startEditing = (item: Annotation) => {
    setEditing(item.id);
    setDraft(item.note ?? "");
  };

  const tabButton = (id: Tab, label: string, count: number) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      className={`reader-notes-tab ${tab === id ? "is-active" : ""}`}
      onClick={() => setTab(id)}
    >
      {label} <span className="tabular-nums reader-muted">{count}</span>
    </button>
  );

  return (
    <div className="absolute right-0 mt-3 w-80 rounded-xl border p-4 text-xs shadow-2xl reader-panel reader-border" role="dialog" aria-label="Notes">
      <div className="flex items-center justify-between gap-2">
        <div role="tablist" aria-label="Notes" className="flex gap-1">
          {tabButton("bookmarks", "Bookmarks", bookmarks.length)}
          {tabButton("highlights", "Highlights", highlights.length)}
        </div>
        {tab === "bookmarks" ? (
          <button type="button" className="reader-notes-action" onClick={onAddBookmark}>
            Add here
          </button>
        ) : (
          <button
            type="button"
            className="reader-notes-action"
            onClick={onExport}
            disabled={highlights.length === 0}
            title="Copies every highlight and note as Markdown"
          >
            Copy all
          </button>
        )}
      </div>

      <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
        {tab === "bookmarks" && bookmarks.length === 0 && (
          <p className="rounded-lg border px-3 py-2 text-[11px] reader-border reader-muted reader-pill">
            No bookmarks yet. "Add here" marks the page you are on.
          </p>
        )}
        {tab === "highlights" && highlights.length === 0 && (
          <p className="rounded-lg border px-3 py-2 text-[11px] leading-relaxed reader-border reader-muted reader-pill">
            No highlights yet. Select some text in the book to highlight it or add a note.
          </p>
        )}

        {tab === "bookmarks" &&
          bookmarks.map((item) => (
            <div key={item.id} className="group flex items-start gap-2 rounded-lg border px-3 py-2 reader-border reader-pill">
              <button type="button" className="min-w-0 flex-1 text-left reader-hover-accent" onClick={() => onOpen(item.cfi)}>
                <div className="truncate text-xs font-semibold reader-text-color">{item.chapter || "Bookmark"}</div>
                <div className="text-[10px] uppercase tracking-widest reader-muted">{new Date(item.createdAt).toLocaleDateString()}</div>
              </button>
              <button type="button" className="reader-notes-remove" onClick={() => onRemove(item.id)} aria-label="Remove bookmark">
                <UiIcon name="close" size={14} />
              </button>
            </div>
          ))}

        {tab === "highlights" &&
          highlights.map((item) => (
            <div key={item.id} className="rounded-lg border px-3 py-2 reader-border reader-pill">
              <div className="flex items-start gap-2">
                <span
                  className="mt-1 h-3 w-1 shrink-0 rounded-full"
                  style={{ background: HIGHLIGHT_COLORS[item.color ?? "yellow"]?.swatch ?? HIGHLIGHT_COLORS.yellow.swatch }}
                  aria-hidden
                />
                <button type="button" className="min-w-0 flex-1 text-left reader-hover-accent" onClick={() => onOpen(item.cfi)}>
                  <span className="line-clamp-4 text-[12px] leading-snug reader-text-color">{item.text}</span>
                  {item.chapter && <span className="mt-1 block text-[10px] uppercase tracking-widest reader-muted">{item.chapter}</span>}
                </button>
                <button type="button" className="reader-notes-remove" onClick={() => onRemove(item.id)} aria-label="Remove highlight">
                  <UiIcon name="close" size={14} />
                </button>
              </div>
              {editing === item.id ? (
                <div className="mt-2">
                  <textarea
                    className="reader-notes-input w-full"
                    rows={3}
                    value={draft}
                    autoFocus
                    placeholder="Your note"
                    onChange={(event) => setDraft(event.target.value)}
                  />
                  <div className="mt-1 flex justify-end gap-2">
                    <button type="button" className="reader-notes-action" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="reader-notes-action is-primary"
                      onClick={() => {
                        onSaveNote(item.id, draft.trim());
                        setEditing(null);
                      }}
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : item.note ? (
                <button type="button" className="mt-2 block w-full text-left text-[11px] italic leading-snug reader-muted" onClick={() => startEditing(item)}>
                  {item.note}
                </button>
              ) : (
                <button type="button" className="mt-1 text-[10px] uppercase tracking-widest reader-muted reader-hover-accent" onClick={() => startEditing(item)}>
                  Add a note
                </button>
              )}
            </div>
          ))}
      </div>
    </div>
  );
};
