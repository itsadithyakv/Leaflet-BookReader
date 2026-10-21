import { UiIcon, type UiIconName } from "./UiIcon";
import { useShellShapeIs } from "../platform/shape";
import { useTouchInput } from "../platform/device";

/**
 * Whether the rail is shown (App.tsx: `md:block short:block`): every shape of window but upright
 * (platform/shape.ts). Elsewhere the bottom bar is the tour's "nav".
 */
export const useRailShown = () => useShellShapeIs("wide", "sideways");

const navItems = [
  { label: "Library", icon: "library" },
  { label: "Collections", icon: "collections" },
  { label: "Social", icon: "analytics" },
  { label: "Pip", icon: "pip" }
] satisfies Array<{ label: string; icon: UiIconName }>;

type SidebarProps = {
  activeItem: string;
  onNavigate: (label: string) => void;
  onStartReading: () => void;
  startDisabled?: boolean;
  /** Unread counts by nav label (e.g. community news on Social). Shown as a dot. */
  badge?: Partial<Record<string, number>>;
};

export const Sidebar = ({ activeItem, onNavigate, onStartReading, startDisabled, badge }: SidebarProps) => {
  const shown = useRailShown();
  // Under a finger (a phone or a tablet) the rail is the four places only: Settings is behind the
  // profile button in the header, and the book being read has its own bar with Continue on it.
  const touch = useTouchInput();
  return (
    <aside
      className="leather-surface leaflet-sidebar absolute inset-y-0 left-0 z-40 flex h-full flex-col border-r border-black/60 py-5"
      aria-label="Primary navigation"
    >
      <nav className="flex-1 space-y-2 text-sm" data-tour={shown ? "nav" : undefined}>
        {navItems.map((item) => (
          <button
            key={item.label}
            className="sidebar-nav-item"
            type="button"
            onClick={() => onNavigate(item.label)}
            data-tour={item.label === "Pip" ? "hollow" : undefined}
            aria-current={item.label === activeItem ? "page" : undefined}
          >
            <span className="sidebar-icon-well relative">
              <UiIcon name={item.icon} size={20} />
              {(badge?.[item.label] ?? 0) > 0 && (
                <span
                  className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-surface"
                  aria-label={`${badge?.[item.label]} new`}
                />
              )}
            </span>
            <span className="sidebar-copy font-semibold">{item.label}</span>
            {/* Under a finger the rail stays a rail: a small label under the icon (styles/touch-shell.css). */}
            <span className="sidebar-rail-label" aria-hidden="true">
              {item.label}
            </span>
          </button>
        ))}
      </nav>

      {!touch && (
        <>
          <button
            className="sidebar-nav-item mb-3 text-sm"
            type="button"
            onClick={() => onNavigate("Settings")}
            aria-current={activeItem === "Settings" ? "page" : undefined}
          >
            <span className="sidebar-icon-well">
              <UiIcon name="settings" size={20} />
            </span>
            <span className="sidebar-copy font-semibold">Settings</span>
          </button>

          <div className="sidebar-reading-action mt-auto">
            <button
              className="sidebar-start-button disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              onClick={onStartReading}
              disabled={startDisabled}
              title="Start reading"
            >
              <span className="sidebar-start-icon">
                <UiIcon name="book-open" size={22} strokeWidth={2.1} />
              </span>
              <span className="sidebar-copy font-bold">Start Reading</span>
            </button>
          </div>
        </>
      )}
    </aside>
  );
};
