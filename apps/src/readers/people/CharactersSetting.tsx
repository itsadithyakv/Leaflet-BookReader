import type { ReactNode } from "react";
import { usePeopleHover, usePeopleSwitch, useWikiMode, type WikiMode } from "./peoplePrefs";

type CharactersSettingProps = {
  /** The settings page's own switch drawing. */
  renderToggle: (on: boolean) => ReactNode;
};

const WIKI_CHOICES: Array<{ mode: WikiMode; label: string; title: string }> = [
  { mode: "ask", label: "When I ask", title: "A “Wiki” button on the card fetches it" },
  { mode: "auto", label: "Straight away", title: "Fetched with the card, every time" },
  { mode: "off", label: "Never", title: "No button, and nothing is ever fetched" }
];

const row =
  "inset-field mt-3 flex w-full items-center justify-between gap-3 px-4 py-3 text-xs text-on-surface-variant transition hover:text-primary";

/**
 * "Characters", on the settings page (Reading): the switch (on unless turned
 * off), whether resting the pointer on a name shows what the book has said
 * of it, and whether a fan wiki's summary may be fetched. Turning the switch
 * off hides everything and stops all of its work; it deletes nothing.
 */
export const CharactersSetting = ({ renderToggle }: CharactersSettingProps) => {
  const [on, setOn] = usePeopleSwitch();
  const [hover, setHover] = usePeopleHover();
  const [wiki, setWiki] = useWikiMode();
  return (
    <div className="paper-surface rounded-xl p-5">
      <p className="text-xs uppercase tracking-widest text-on-surface-variant">In the book</p>
      <button type="button" role="switch" aria-checked={on} className={`${row} !mt-4`} onClick={() => setOn(!on)}>
        <span className="text-left">
          <span className="block">Characters</span>
          <span className="mt-0.5 block text-[11px] opacity-75">
            Who is who in a book, as far as you have read. Made on this device.
          </span>
        </span>
        {renderToggle(on)}
      </button>

      {on && (
        <>
          <button type="button" role="switch" aria-checked={hover} className={row} onClick={() => setHover(!hover)}>
            <span className="text-left">
              <span className="block">Show a name's card when the pointer rests on it</span>
              <span className="mt-0.5 block text-[11px] opacity-75">
                A person, a place, an order.
              </span>
            </span>
            {renderToggle(hover)}
          </button>

          <div className={`${row} flex-wrap hover:!text-on-surface-variant`} role="group" aria-label="Summaries from a fan wiki">
            <span className="min-w-[14rem] flex-1 text-left">
              <span className="block">Summaries from a fan wiki</span>
              <span className="mt-0.5 block text-[11px] opacity-75">
                From the book's fan wiki. They can give away what happens later. Sends the name and the book's title.
              </span>
            </span>
            <span className="flex flex-none gap-1">
              {WIKI_CHOICES.map((choice) => (
                <button
                  key={choice.mode}
                  type="button"
                  className={`rounded-md border px-2.5 py-1.5 text-[11px] transition ${
                    wiki === choice.mode ? "border-primary text-primary" : "border-outline-variant hover:text-primary"
                  }`}
                  aria-pressed={wiki === choice.mode}
                  title={choice.title}
                  onClick={() => setWiki(choice.mode)}
                >
                  {choice.label}
                </button>
              ))}
            </span>
          </div>
        </>
      )}
    </div>
  );
};
