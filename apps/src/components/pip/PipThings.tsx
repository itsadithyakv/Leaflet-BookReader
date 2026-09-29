import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { UiIcon, type UiIconName } from "../UiIcon";
import { isComplete, tallyLabel, tallyText, type Tally } from "./collection";

export type ThingsTab = {
  id: string;
  label: string;
  icon: UiIconName;
  /** How much of this kind Pip has, of all there is. */
  tally: Tally;
  body: ReactNode;
  /** "Get more" opens the shop on the matching tab. */
  more: { label: string; open: () => void };
};

/**
 * Pip's things: everything Pip owns, to use. Wear a look, give a treat, do a
 * move. Nothing is sold here; each tab ends with a way into the shop for more,
 * and says how much of the set Pip has. `onTab` hears the tab chosen, so the
 * panel can open on it again next time.
 */
export const PipThings = ({ tabs, initial, onTab }: { tabs: ThingsTab[]; initial?: string | null; onTab?: (id: string) => void }) => {
  const [tab, setTabState] = useState(() => tabs.find((entry) => entry.id === initial)?.id ?? tabs[0]?.id);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = tabs.find((entry) => entry.id === tab) ?? tabs[0];
  const setTab = (id: string) => {
    setTabState(id);
    onTab?.(id);
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const to =
      event.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : null;
    if (to === null) return;
    event.preventDefault();
    setTab(tabs[to].id);
    tabRefs.current[to]?.focus();
  };

  if (!current) return null;
  return (
    <>
      <div className="pip-things-tabs" role="tablist" aria-label="Pip's things">
        {tabs.map((entry, index) => (
          <button
            key={entry.id}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`pip-things-tab-${entry.id}`}
            aria-selected={entry.id === current.id}
            aria-controls="pip-things-panel"
            tabIndex={entry.id === current.id ? 0 : -1}
            className="pip-tab"
            onClick={() => setTab(entry.id)}
            onKeyDown={(event) => onTabKey(event, index)}
          >
            <UiIcon name={entry.icon} size={15} />
            <span>{entry.label}</span>
            <span className="pip-tally" data-complete={isComplete(entry.tally) || undefined} aria-label={tallyLabel(entry.tally)}>
              {tallyText(entry.tally)}
            </span>
          </button>
        ))}
      </div>
      <div id="pip-things-panel" role="tabpanel" aria-labelledby={`pip-things-tab-${current.id}`} className="pip-things-panel">
        {current.body}
        <button type="button" className="pip-get-more" onClick={current.more.open}>
          <UiIcon name="shop" size={15} />
          <span>{current.more.label}</span>
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </>
  );
};
