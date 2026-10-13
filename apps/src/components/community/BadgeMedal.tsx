import { BookOpen, CalendarCheck, Clock, Flame, Gamepad2, Gem, Sprout, Star, Sun, Target, type LucideIcon } from "lucide-react";
import { badgeInfo, progressText, shownBadges, type BadgeInfo, type BadgeKind } from "./badges";
import "./friends.css";

const ICONS: Record<BadgeKind, LucideIcon> = {
  streak: Flame,
  hours: Clock,
  books: BookOpen,
  sessions: Target,
  day: Sun,
  garden: Sprout,
  collector: Gem,
  arcade: Gamepad2,
  level: Star,
  month: CalendarCheck
};

/** One badge: a medal in its tier's metal, with what earned it on hover. */
export const BadgeMedal = ({ badge, earned = true, note, size = 40 }: { badge: BadgeInfo; earned?: boolean; note?: string; size?: number }) => {
  const Icon = ICONS[badge.kind];
  const label = `${badge.name}: ${badge.earnedBy}${note ? ` (${note})` : ""}`;
  return (
    <span
      className={`badge-medal badge-tier-${badge.tier}${earned ? "" : " is-unearned"}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={earned ? label : `Not earned yet. ${label}`}
      title={label}
    >
      <Icon size={Math.round(size * 0.48)} strokeWidth={2.2} aria-hidden />
    </span>
  );
};

/** A reader's badges in a row, the hardest first: on their card. */
export const BadgeRow = ({ ids, most = 12 }: { ids: readonly string[] | null | undefined; most?: number }) => {
  const all = shownBadges(ids);
  const shown = all.slice(0, most);
  if (shown.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((badge) => (
        <BadgeMedal key={badge.id} badge={badge} size={34} />
      ))}
      {all.length > shown.length && <span className="text-xs text-on-surface-variant">+{all.length - shown.length}</span>}
    </div>
  );
};

/** As `pip_badges` answers: every badge there is, earned or not, with how far along. */
export type BadgeStatus = { id: string; earned: boolean; value: number; target: number };

/** The reader's own wall: the earned ones as medals, the rest dimmed with how far along they are. */
export const BadgeWall = ({ statuses }: { statuses: BadgeStatus[] }) => {
  const known = statuses
    .map((status) => ({ status, badge: badgeInfo(status.id) }))
    .filter((entry): entry is { status: BadgeStatus; badge: BadgeInfo } => entry.badge !== null);
  return (
    <ul className="badge-wall">
      {known.map(({ status, badge }) => {
        const share = status.target > 0 ? Math.min(1, status.value / status.target) : 0;
        return (
          <li key={badge.id} className={status.earned ? "is-earned" : undefined}>
            <BadgeMedal badge={badge} earned={status.earned} note={status.earned ? undefined : progressText(badge.kind, status.value, status.target)} />
            <span className="badge-wall-name">{badge.name}</span>
            {!status.earned && (
              <span className="badge-wall-bar" aria-hidden="true">
                <span style={{ width: `${Math.round(share * 100)}%` }} />
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
};
