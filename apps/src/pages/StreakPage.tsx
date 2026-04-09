import { useMemo } from "react";
import { useLibraryStore } from "../store/libraryStore";

export type StreakPageProps = {
  onNavigate: (tab: "library" | "collections" | "analytics" | "settings") => void;
};

const formatDate = (value: string | null) => {
  if (!value) {
    return "No sessions yet";
  }
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
};

export const StreakPage = ({ onNavigate }: StreakPageProps) => {
  const { stats, books } = useLibraryStore();
  const finishedBooks = useMemo(() => books.filter((book) => book.progress >= 1).length, [books]);

  return (
    <div className="flex min-h-full flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-headline font-bold">Streak & Rhythm</h2>
          <p className="mt-2 text-sm text-on-surface-variant">
            Track your reading cadence and celebrate the ritual.
          </p>
        </div>
        <button
          type="button"
          className="rounded-full border border-outline-variant/30 px-4 py-2 text-xs text-on-surface-variant transition hover:text-primary"
          onClick={() => onNavigate("library")}
        >
          Back to Library
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-low p-5">
          <p className="text-xs uppercase tracking-widest text-on-surface-variant">Current Streak</p>
          <p className="mt-3 font-headline text-3xl font-bold text-on-surface">{stats.streakDays} days</p>
        </div>
        <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-low p-5">
          <p className="text-xs uppercase tracking-widest text-on-surface-variant">Days Read (7d)</p>
          <p className="mt-3 font-headline text-3xl font-bold text-on-surface">{stats.daysLast7} days</p>
        </div>
        <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-low p-5">
          <p className="text-xs uppercase tracking-widest text-on-surface-variant">Last Read</p>
          <p className="mt-3 font-headline text-2xl font-bold text-on-surface">{formatDate(stats.lastReadAt)}</p>
        </div>
        <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-low p-5">
          <p className="text-xs uppercase tracking-widest text-on-surface-variant">Books Finished</p>
          <p className="mt-3 font-headline text-3xl font-bold text-on-surface">{finishedBooks}</p>
        </div>
      </div>
    </div>
  );
};
