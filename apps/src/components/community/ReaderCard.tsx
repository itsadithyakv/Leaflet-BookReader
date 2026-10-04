import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Flame, Leaf, Swords, UserCheck, UserPlus, X } from "lucide-react";
import { socialService, type ReaderProfile } from "../../services/socialService";
import { useCommunityStore } from "./communityStore";
import { PipAvatar } from "./PipAvatar";
import { SharedShelf } from "./SharedShelf";
import { at, errorText, minutesText, nameOf } from "./format";
import { COPY, duelDeclinedText, duelOnText, duelSentText, followingText, kudosSentText, relationText, streakText } from "./copy";
import { EYEBROW } from "../ui/SectionHeader";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
    <p className={EYEBROW}>{label}</p>
    <p className="mt-0.5 font-headline text-lg font-bold tabular-nums text-on-surface">{value}</p>
  </div>
);

/**
 * Another reader, up close: their Pip, their week, their shelf — and the three
 * friendly things you can do about it. A drawer from the right; Escape or the
 * backdrop closes it, and Tab stays inside it while it is open.
 */
export const ReaderCard = ({ signedIn, canJoin, showToast, onChanged }: ReaderCardProps) => {
  const handle = useCommunityStore((state) => state.openHandle);
  const close = useCommunityStore((state) => state.closeReader);
  const [reader, setReader] = useState<ReaderProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"follow" | "kudos" | "duel" | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const drawer = useRef<HTMLElement | null>(null);

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
    // Focus moves in, and back to whatever opened the card when it closes.
    const opener = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    return () => {
      live = false;
      opener?.focus?.();
    };
  }, [handle]);

  if (!handle) {
    return null;
  }

  // Escape closes this card and nothing else; Tab cycles within it.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab" || !drawer.current) {
      return;
    }
    const items = Array.from(drawer.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) {
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

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
  const relation = reader ? relationText(Boolean(reader.isFollowing), Boolean(reader.followsYou)) : null;
  const respondToDuel = useCommunityStore.getState().respondToDuel;

  return (
    <div
      className="fixed inset-0 z-[70] flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={reader ? `${nameOf(reader)}'s card` : "Reader"}
      onKeyDown={onKeyDown}
    >
      <button type="button" tabIndex={-1} className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" aria-label="Close" onClick={close} />
      <aside ref={drawer} className="paper-surface relative flex h-full w-full max-w-md flex-col gap-5 overflow-y-auto rounded-none p-6 shadow-2xl sm:rounded-l-2xl">
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
                  {relation && <span className="ml-2 rounded-full bg-surface-container-high px-2 py-0.5 text-[10px]">{relation}</span>}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat label="This week" value={minutesText(reader.weekMinutes)} />
              <Stat label="Streak" value={streakText(reader.streak)} />
              <Stat label="Finished" value={reader.booksFinished} />
              <Stat label="Kudos" value={reader.kudosThisWeek} />
              <Stat label="Followers" value={reader.followerCount} />
              <Stat label="Following" value={reader.followingCount} />
            </div>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                disabled={locked || busy !== null}
                aria-label={reader.isFollowing ? `Unfollow ${at(reader.handle)}` : `Follow ${at(reader.handle)}`}
                className={`tactile-button group flex items-center justify-center gap-2 px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-60 ${
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
                    follow ? followingText(reader.handle) : undefined
                  );
                }}
              >
                {reader.isFollowing ? <UserCheck size={16} aria-hidden /> : <UserPlus size={16} aria-hidden />}
                {busy === "follow" ? (
                  "…"
                ) : reader.isFollowing ? (
                  <>
                    <span className="group-hover:hidden group-focus-visible:hidden">Following</span>
                    <span className="hidden group-hover:inline group-focus-visible:inline">Unfollow</span>
                  </>
                ) : (
                  "Follow"
                )}
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={locked || busy !== null || Boolean(reader.kudosSentToday)}
                  className="tactile-button flex items-center justify-center gap-2 px-3 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                  title={COPY.kudosRule}
                  onClick={() =>
                    void act(
                      "kudos",
                      async () => {
                        const result = await socialService.sendKudos(reader.handle);
                        return { kudosSentToday: true, kudosThisWeek: result.kudosThisWeek };
                      },
                      kudosSentText(reader.handle)
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
                  title={COPY.duelRule}
                  onClick={() =>
                    incoming && duel
                      ? void act(
                          "duel",
                          async () => {
                            await respondToDuel(duel.id, true);
                            return { activeDuel: { ...duel, status: "accepted" } };
                          },
                          duelOnText(reader.handle)
                        )
                      : void act(
                      "duel",
                      async () => {
                        const made = await socialService.challenge(reader.handle);
                        return { activeDuel: { id: made.id, status: "pending", youChallenged: true } };
                      },
                      duelSentText(reader.handle)
                    )
                  }
                >
                  <Swords size={16} aria-hidden />
                  {busy === "duel" ? "…" : duelLabel}
                </button>
              </div>

              {isYou ? (
                <p className="text-xs text-on-surface-variant">This is you, looking good.</p>
              ) : !signedIn ? (
                <p className="text-xs text-on-surface-variant">{COPY.signIn}</p>
              ) : !canJoin ? (
                <p className="text-xs text-on-surface-variant">{COPY.goPublic}</p>
              ) : incoming && duel ? (
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-on-surface-variant">
                  They challenged you this week.
                  <button
                    type="button"
                    className="font-semibold text-primary hover:underline disabled:opacity-60"
                    disabled={busy !== null}
                    onClick={() =>
                      void act(
                        "duel",
                        async () => {
                          await respondToDuel(duel.id, false);
                          return { activeDuel: { ...duel, status: "declined" } };
                        },
                        duelDeclinedText
                      )
                    }
                  >
                    Decline
                  </button>
                </p>
              ) : (
                <p className="flex items-center gap-1 text-xs text-on-surface-variant">
                  <Flame size={12} aria-hidden /> {COPY.duelRule}.
                </p>
              )}
            </div>

            <div>
              <p className={EYEBROW}>{at(reader.handle)}'s shelf</p>
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
