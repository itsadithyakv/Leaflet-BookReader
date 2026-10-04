import type { ReactNode } from "react";
import { usePeopleSwitch } from "./peoplePrefs";

type CharactersSettingProps = {
  /** The settings page's own switch drawing. */
  renderToggle: (on: boolean) => ReactNode;
};

/**
 * The "Characters" switch, on the settings page (Reading). Off by default.
 * Turning it off hides everything and stops all of its work; it deletes
 * nothing.
 */
export const CharactersSetting = ({ renderToggle }: CharactersSettingProps) => {
  const [on, setOn] = usePeopleSwitch();
  return (
    <div className="paper-surface rounded-xl p-5">
      <p className="text-xs uppercase tracking-widest text-on-surface-variant">In the book</p>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className="inset-field mt-4 flex w-full items-center justify-between gap-3 px-4 py-3 text-xs text-on-surface-variant transition hover:text-primary"
        onClick={() => setOn(!on)}
      >
        <span className="text-left">
          <span className="block">Characters</span>
          <span className="mt-0.5 block text-[11px] opacity-75">
            Keep track of who is who in a book. Select a name and ask who it is, write a line about them, and see how
            people are tied. A card only ever shows what you knew by the page you are on. Nothing leaves this device;
            turning it off hides your notes without deleting them.
          </span>
        </span>
        {renderToggle(on)}
      </button>
    </div>
  );
};
