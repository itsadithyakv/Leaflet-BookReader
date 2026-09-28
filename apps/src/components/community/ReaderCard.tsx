import { useEffect, useRef, useState } from "react";
import { Flame, Leaf, Swords, UserCheck, UserPlus, X } from "lucide-react";
import { socialService, type ReaderProfile } from "../../services/socialService";
import { useCommunityStore } from "./communityStore";
import { PipAvatar } from "./PipAvatar";
import { SharedShelf } from "./SharedShelf";
import { at, errorText, minutesText, nameOf } from "./format";

type ReaderCardProps = {
  signedIn: boolean;
  /** Signed in with a public profile. */
  canJoin: boolean;
  showToast: (message: string) => void;
  /** Something changed (follow, duel): refresh the board and duels. */
  onChanged: () => void;
};

const Stat = ({ label, value }: { label: string; value: string | number }) => (
  <div className="rounded-lg bg-surface-container/70 px-3 py-2">
    <p className="text-[10px] uppercase tracking-[0.18em] text-on-surface-variant">{label}</p>
    <p className="mt-0.5 font-headline text-lg font-bold tabular-nums text-on-surface">{value}</p>
  </div>
);

/**
 * Another reader, up close: their Pip, their week, their shelf — and the three
 * friendly things you can do about it. A drawer from the right; Escape or the
 * backdrop closes it.
 */
export const ReaderCard = ({ signedIn, canJoin, showToast, onChanged }: ReaderCardProps) => {
  const handle = useCommunityStore((state) => state.openHandle);
  const close = useCommunityStore((state) => state.closeReader);
  const [reader, setReader] = useState<ReaderProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"follow" | "kudos" | "duel" | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!handle) {
      return;
    }
    let live = true;
    setReader(null);
    setError(null);
    socialService
      .reader(handle)
      .then((profile) => live && setReader(profile))
      .catch((cause) => live && setError(errorText(cause)));
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      live = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [handle, close]);

  if (!handle) {
    return null;
  }

  const act = async (kind: "follow" | "kudos" | "duel", run: () => Promise<Partial<ReaderProfile> | void>, done?: string) => {
    setBusy(kind);
    try {
      const patch = await run();
      if (patch) {
        setReader((current) => (current ? { ...current, ...patch } : current));
      }
      if (done) {
        showToast(done);
      }
      onChanged();
    } catch (cause) {
      showToast(errorText(cause));
    } finally {
      setBusy(null);
    }
  };

  const isYou = Boolean(reader?.isYou);
  const locked = !signedIn || !canJoin || isYou;
  const duel = reader?.activeDuel ?? null;
  const duelLabel = !duel
    ? "Challenge to a duel"
    : duel.status === "accepted"
      ? "Duel on this week"
      : duel.status === "declined"
        ? "Maybe next week"
        : duel.youChallenged
          ? "Challenge sent"
          : "Accept their duel";
  const incoming = duel?.status === "pending" && !duel.youChallenged;
  const respondToDuel = useCommunityStore.getState().respondToDuel;

  return (
    <div className="fixed inset-0 z-[70] flex justify-end" role="dialog" aria-modal="true" aria-label={reader ? `${nameOf(reader)}'s card` : "Reader"}>
      <button type="button" className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" aria-label="Close" onClick={close} />
      <aside className="paper-surface relative flex h-full w-full max-w-md flex-col gap-5 overflow-y-auto rounded-none p-6 shadow-2xl sm:rounded-l-2xl">
        <button
          ref={closeButton}
          type="button"
          onClick={close}
          className="absolute right-4 top-4 rounded-full p-1.5 text-on-surface-variant hover:bg-surface-container-high"
          aria-label="Close"
        >
          <X size={18} />
        </button>

        {!reader && !error && <p className="mt-10 text-sm text-on-surface-variant">Opening {at(handle)}…</p>}
        {error && (
          <div className="mt-10">
            <p className="font-headline text-lg font-bold text-on-surface">{at(handle)}</p>
            <p className="mt-2 text-sm text-on-surface-variant">{error}</p>
          </div>
        )}

        {reader && (
          <>
            <div className="flex items-center gap-4 pr-8">
              <PipAvatar seed={reader.pipSeed} avatar={reader.avatar} size={80} play label={`${nameOf(reader)}'s Pip`} />
              <div className="min-w-0">
                <p className="truncate font-headline text-2xl font-bold text-on-surface">{nameOf(reader)}</p>
                <p className="truncate text-sm text-on-surface-variant">
                  {at(reader.handle)}
                  {reader.followsYou && (
                    <span className="ml-2 rounded-full bg-surface-container-high px-2 py-0.5 text-[10px]">
                      {reader.isFollowing ? "friends" : "follows you · follow back"}
                    </span>
                  )}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat label="This week" value={minutesText(reader.weekMinutes)} />
              <Stat label="Streak" value={`${reader.streak}d`} />
              <Stat label="Finished" value={reader.booksFinished} />
              <Stat label="Kudos" value={reader.kudosThisWeek} />
              <Stat label="Followers" value={reader.followerCount} />
              <Stat label="Following" value={reader.followingCount} />
            </div>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                disabled={locked || busy !== null}
                className={`tactile-button flex items-center justify-center gap-2 px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-60 ${
                  reader.isFollowing ? "" : "tactile-button-primary"
                }`}
                onClick={() => {
                  const follow = !reader.isFollowing;
                  void act(
                    "follow",
                    async () => {
                      await socialService.setFollowing(reader.handle, follow);
                      return { isFollowing: follow, followerCount: Math.max(0, reader.followerCount + (follow ? 1 : -1)) };
                    },
                    follow ? `Following ${at(reader.handle)}.` : undefined
                  );
                }}
              >
                {reader.isFollowing ? <UserCheck size={16} aria-hidden /> : <UserPlus size={16} aria-hidden />}
                {busy === "follow" ? "…" : reader.isFollowing ? "Following · unfollow" : "Follow"}
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={locked || busy !== null || Boolean(reader.kudosSentToday)}
                  className="tactile-button flex items-center justify-center gap-2 px-3 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                  title="One leaf per reader per day"
                  onClick={() =>
                    void act(
                      "kudos",
                      async () => {
                        const result = await socialService.sendKudos(reader.handle);
                        return { kudosSentToday: true, kudosThisWeek: result.kudosThisWeek };
                      },
                      `Leaf sent to ${at(reader.handle)}.`
                    )
                  }
                >
                  <Leaf size={16} className="text-primary" aria-hidden />
                  {reader.kudosSentToday ? "Kudos sent" : busy === "kudos" ? "…" : "Send kudos"}
                </button>
                <button
                  type="button"
                  disabled={locked || busy !== null || (Boolean(duel) && !incoming)}
                  className="tactile-button flex items-center justify-center gap-2 px-3 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                  title="Most minutes by Sunday night wins"
                  onClick={() =>
                    incoming && duel
                      ? void act(
                          "duel",
                          async () => {
                            await respondToDuel(duel.id, true);
                            return { activeDuel: { ...duel, status: "accepted" } };
                          },
                          `Duel on. Good luck against ${at(reader.handle)}!`
                        )
                      : void act(
                      "duel",
                      async () => {
                        const made = await socialService.challenge(reader.handle);
                        return { activeDuel: { id: made.id, status: "pending", youChallenged: true } };
                      },
                      `Challenge sent. ${at(reader.handle)} can accept it from their inbox.`
                    )
                  }
                >
                  <Swords size={16} aria-hidden />
                  {busy === "duel" ? "…" : duelLabel}
                </button>
              </div>

              {isYou ? (
                <p className="text-xs text-on-surface-variant">This is you — looking good.</p>
              ) : !signedIn ? (
                <p className="text-xs text-on-surface-variant">Sign in (Settings → Account) to follow, cheer and duel.</p>
              ) : !canJoin ? (
                <p className="text-xs text-on-surface-variant">Make your profile public to join in.</p>
              ) : incoming ? (
                <p className="text-xs text-on-surface-variant">They challenged you this week. Not up for it? Decline from your inbox.</p>
              ) : (
                <p className="flex items-center gap-1 text-xs text-on-surface-variant">
                  <Flame size={12} aria-hidden /> A duel runs to the end of this week: most minutes wins.
                </p>
              )}
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">Their shelf</p>
              <div className="mt-3">
                <SharedShelf shelf={reader.shelf} emptyText="Nothing on the shelf yet — they're just getting started." />
              </div>
            </div>
          </>
        )}
      </aside>
    </div>
  );
};
