import { UiIcon, type UiIconName } from "./UiIcon";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { RAIL_QUERY } from "./Sidebar";

export type MobileNavItem = {
  label: string;
  icon: UiIconName;
};

/**
 * The four places. Settings is not one of them on a phone: it is behind the
 * profile button in the header, with the reader's account and backup. And
 * there is no "Read" key: the book being read has its own bar at the foot of
 * the page, with Continue on it.
 */
export const MOBILE_NAV_ITEMS: readonly MobileNavItem[] = [
  { label: "Library", icon: "library" },
  { label: "Collections", icon: "collections" },
  { label: "Social", icon: "analytics" },
  { label: "Pip", icon: "pip" }
];

type MobileNavProps = {
  activeItem: string;
  onNavigate: (label: string) => void;
  /** Unread counts by nav label (e.g. community news on Social). Shown as a dot. */
  badge?: Partial<Record<string, number>>;
};

/**
 * Primary navigation on a phone held upright.
 *
 * The leather sidebar is `hidden md:block`, which left a phone with no way to
 * reach Collections or Social at all — the app opened on the Library and
 * stayed there. This is the same destinations within thumb reach.
 *
 * It is deliberately *not* shown in landscape: a bar across the bottom costs
 * height, which is the scarce dimension there, so the sidebar rail takes over
 * instead. See the `short` breakpoint.
 */
export const MobileNav = ({ activeItem, onNavigate, badge }: MobileNavProps) => {
  // The tour points at whichever of this and the rail is on screen.
  const railShown = useMediaQuery(RAIL_QUERY);
  return (
    <nav
      className="mobile-nav md:hidden short:hidden"
      aria-label="Primary navigation"
      data-tour={railShown ? undefined : "nav"}
    >
      {MOBILE_NAV_ITEMS.map((item) => {
        const active = item.label === activeItem;
        return (
          <button
            key={item.label}
            type="button"
            className="mobile-nav-item"
            data-active={active || undefined}
            aria-current={active ? "page" : undefined}
            onClick={() => onNavigate(item.label)}
          >
            <span className="relative inline-flex">
              <UiIcon name={item.icon} size={21} />
              {(badge?.[item.label] ?? 0) > 0 && (
                <span
                  className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-surface"
                  aria-label={`${badge?.[item.label]} new`}
                />
              )}
            </span>
            <span className="mobile-nav-label">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
};
