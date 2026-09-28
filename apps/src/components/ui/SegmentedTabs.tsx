import { useRef, type KeyboardEvent } from "react";

export type SegmentedTab<T extends string> = {
  id: T;
  label: string;
  /** Shown on hover; for a disabled tab, why it is disabled. */
  hint?: string;
  disabled?: boolean;
};

type SegmentedTabsProps<T extends string> = {
  /** Names the tab list for screen readers, and prefixes the ids. */
  label: string;
  idPrefix: string;
  tabs: SegmentedTab<T>[];
  value: T;
  onChange: (id: T) => void;
  size?: "sm" | "md";
};

/** The id of the panel a tab controls, for `aria-labelledby` on that panel. */
export const tabId = (idPrefix: string, id: string) => `${idPrefix}-tab-${id}`;
export const panelId = (idPrefix: string, id: string) => `${idPrefix}-panel-${id}`;

/**
 * Pill tabs: the one tab style in the app's pages. A proper tab list: the
 * chosen tab is the only one in the Tab order, and the arrow keys (plus Home
 * and End) move between the others.
 */
export const SegmentedTabs = <T extends string>({ label, idPrefix, tabs, value, onChange, size = "sm" }: SegmentedTabsProps<T>) => {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = tabs.map((tab, index) => (tab.disabled ? -1 : index)).filter((index) => index >= 0);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = enabled.indexOf(tabs.findIndex((tab) => tab.id === value));
    const step: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
    let next: number | null = null;
    if (event.key in step) {
      next = enabled[(current + step[event.key] + enabled.length) % enabled.length];
    } else if (event.key === "Home") {
      next = enabled[0];
    } else if (event.key === "End") {
      next = enabled[enabled.length - 1];
    }
    if (next === null || next === undefined) {
      return;
    }
    event.preventDefault();
    onChange(tabs[next].id);
    buttons.current[next]?.focus();
  };

  const pad = size === "md" ? "px-4 py-2 text-sm" : "px-3.5 py-1.5 text-xs";
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 rounded-full bg-surface-container p-1" onKeyDown={onKeyDown}>
      {tabs.map((tab, index) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="tab"
            id={tabId(idPrefix, tab.id)}
            aria-selected={selected}
            aria-controls={panelId(idPrefix, tab.id)}
            tabIndex={selected ? 0 : -1}
            disabled={tab.disabled}
            title={tab.hint}
            onClick={() => onChange(tab.id)}
            className={`rounded-full font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 ${pad} ${
              selected ? "bg-primary text-on-primary" : "text-on-surface-variant hover:bg-surface-container-high"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
};
