import type { ReactNode } from "react";
import { useWordsSwitch } from "./wordPrefs";

type WordsSettingProps = {
  /** The settings page's own switch drawing. */
  renderToggle: (on: boolean) => ReactNode;
};

/**
 * The "Keep the words I look up" switch, on the settings page (Reading). On
 * by default. Turning it off stops words being kept; it deletes nothing.
 */
export const WordsSetting = ({ renderToggle }: WordsSettingProps) => {
  const [on, setOn] = useWordsSwitch();
  return (
    <div className="paper-surface rounded-xl p-5">
      <p className="text-xs uppercase tracking-widest text-on-surface-variant">Looking words up</p>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className="inset-field mt-4 flex w-full items-center justify-between gap-3 px-4 py-3 text-xs text-on-surface-variant transition hover:text-primary"
        onClick={() => setOn(!on)}
      >
        <span className="text-left">
          <span className="block">Keep the words I look up</span>
          <span className="mt-0.5 block text-[11px] opacity-75">
            A word you look up while reading is kept with its meaning and its place in the book, for “My words” and the
            word quiz in Pip's arcade. They are kept on this device and in your backup, and sent nowhere else. Turning
            this off stops new words being kept; the ones you have stay until you remove them.
          </span>
        </span>
        {renderToggle(on)}
      </button>
    </div>
  );
};
