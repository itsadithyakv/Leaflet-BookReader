import type { ReactNode } from "react";
import { AudioLines } from "lucide-react";
import { UiIcon, type UiIconName } from "../../components/UiIcon";
import { openAmbiencePopover, useAmbienceState } from "../../ambience";
import type { ReaderDisplayMode } from "../readerTypes";
import { ROTATION_CHOICES, canLockRotation } from "../touchLayout";
import type { RotationLock } from "../../platform/android";
import type { ReaderScope } from "./scope";

/**
 * A phone's toolbar has four buttons (Back, Contents, Aa, ···): the rest are
 * rows of the ··· sheet, each with its icon, and the layout, the page finish
 * and the rotation are in the Aa sheet (docs/android.md, "Upright").
 */

/** One row of a sheet: an icon and a name, and what it shows on the right. */
export const SheetRow = ({
  icon,
  label,
  detail,
  onClick,
  pressed
}: {
  icon: ReactNode;
  label: string;
  detail?: ReactNode;
  onClick: () => void;
  pressed?: boolean;
}) => (
  <button type="button" className="reader-sheet-row reader-icon" onClick={onClick} aria-pressed={pressed}>
    <span className="reader-sheet-row-icon" aria-hidden="true">
      {icon}
    </span>
    <span className="reader-sheet-row-label">{label}</span>
    {detail !== undefined && <span className="reader-sheet-row-detail reader-muted">{detail}</span>}
  </button>
);

const icon = (name: UiIconName) => <UiIcon name={name} size={20} />;

/** The ··· sheet's first rows on a phone: what the desktop's toolbar has as buttons. */
export const ReaderMoreRows = ({ reader, close }: { reader: ReaderScope; close: () => void }) => {
  const { addBookmark, closeSearch, people, setBookmarkPanelOpen, setNotesFocus, setSearchOpen } = reader;
  const sideways = reader.shape === "sideways";
  const sound = useAmbienceState();
  return (
    <div className="reader-sheet-rows" role="group" aria-label="More">
      {/* On its side the strip has search and notes of its own (ReaderToolbar.tsx). */}
      {!sideways && (
        <SheetRow
          icon={icon("search")}
          label="Search in this book"
          onClick={() => {
            close();
            setSearchOpen(true);
          }}
        />
      )}
      {people.enabled && (
        <SheetRow
          icon={icon("people")}
          label="Characters"
          onClick={() => {
            close();
            closeSearch();
            people.openPanel();
          }}
        />
      )}
      {!sideways && (
        <SheetRow
          icon={icon("note")}
          label="Notes"
          onClick={() => {
            close();
            setNotesFocus(null);
            setBookmarkPanelOpen(true);
          }}
        />
      )}
      <SheetRow
        icon={icon("bookmark")}
        label="Bookmark this place"
        onClick={() => {
          close();
          addBookmark();
        }}
      />
      <SheetRow
        icon={<AudioLines size={20} strokeWidth={2} />}
        label="Sound"
        detail={sound.on ? sound.sceneName : "Off"}
        onClick={() => {
          close();
          openAmbiencePopover();
        }}
      />
    </div>
  );
};

/** A small row of choices, one lit. */
const Choices = <T extends string>({
  label,
  options,
  value,
  onChoose
}: {
  label: string;
  options: Array<{ id: T; label: string }>;
  value: T;
  onChoose: (next: T) => void;
}) => (
  <div className="reader-type-block">
    <span className="reader-type-label reader-muted">{label}</span>
    <div className="reader-sheet-choices" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          className={`reader-notes-tab ${value === option.id ? "is-active" : ""}`}
          onClick={() => onChoose(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  </div>
);

export const FINISHES: Array<{ id: ReaderDisplayMode; label: string }> = [
  { id: "paper", label: "Warm paper" },
  { id: "dark-paper", label: "Dark paper" },
  { id: "true-white", label: "True white" },
  { id: "true-black", label: "True black" },
  { id: "app", label: "Match app theme" }
];

/** The turn lock, offered only in the Android app (anywhere else the screen does not turn for Leaflet). */
export const RotationChoice = ({ value, onChoose }: { value: RotationLock; onChoose: (next: RotationLock) => void }) =>
  canLockRotation() ? <Choices label="Turning" options={ROTATION_CHOICES} value={value} onChoose={onChoose} /> : null;

/** The Aa sheet's own rows on a phone: the layout (for this way up), the page finish, the turn lock. */
export const ReaderLookRows = ({ reader }: { reader: ReaderScope }) => {
  const { chooseLayout, chooseRotation, displayMode, layout, rotation, setDisplayMode, shape } = reader;
  return (
    <>
      <Choices
        label={shape === "sideways" ? "Layout on its side" : "Layout"}
        options={[
          { id: "scroll", label: "Scroll" },
          { id: "pages", label: shape === "sideways" ? "Two pages" : "Pages" }
        ]}
        value={layout}
        onChoose={chooseLayout}
      />
      <label className="reader-type-block">
        <span className="reader-type-label reader-muted">Page finish</span>
        <select className="reader-select w-full" value={displayMode} onChange={(event) => setDisplayMode(event.target.value as ReaderDisplayMode)}>
          {FINISHES.map((finish) => (
            <option key={finish.id} value={finish.id}>
              {finish.label}
            </option>
          ))}
        </select>
      </label>
      <RotationChoice value={rotation} onChoose={chooseRotation} />
    </>
  );
};
