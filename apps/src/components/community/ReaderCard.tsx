import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Flame, Gift, Leaf, Lock, Swords, UserCheck, UserPlus, X } from "lucide-react";
import { socialService, type LockedProfile, type ReaderProfile } from "../../services/socialService";
import { friendsService, type BookPost } from "../../services/friendsService";
import { useCommunityStore } from "./communityStore";
import { BadgeRow } from "./BadgeMedal";
import { GiftDialog } from "./GiftDialog";
import { discussService } from "../../services/discussService";
import { useDiscussStore } from "../discuss/discussStore";
import { askConfirm } from "../ConfirmDialog";
import { seedExtras } from "../../services/seedService";
import { usePipWardrobeStore } from "../../store/pipWardrobeStore";
import { PipAvatar } from "./PipAvatar";
import { PostList } from "./Posts";
import { ReaderLibrary } from "./ReaderLibrary";
import { SharedShelf } from "./SharedShelf";
import { at, errorText, minutesText, nameOf } from "./format";
import { COPY, duelDeclinedText, duelOnText, duelSentText, followingText, kudosSentText, relationText, streakText } from "./copy";
import { EYEBROW } from "../ui/SectionHeader";
import { CampVisit } from "../pip/arcade/base/CampExtras";
import { useBackClose } from "../../hooks/useBackClose";
import { isTouchInput } from "../../platform/device";

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

type Tab = "shelf" | "library" | "posts";

/** What a reader finished and said of it; asked for when its tab is opened. */
const ReaderPosts = ({ handle, showToast }: { handle: string; showToast: (message: string) => void }) => {
  const [posts, setPosts] = useState<BookPost[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setPosts(null);
    setFailed(null);
    friendsService
      .postsOf(handle)
      .then((found) => live && setPosts(found))
      .catch((cause) => live && setFailed(errorText(cause)));
    return () => {
      live = false;
    };
  }, [handle]);
  if (failed) {
    return <p className="text-xs text-on-surface-variant">{failed}</p>;
  }
  if (!posts) {
    return <p className="text-xs text-on-surface-variant">Looking…</p>;
  }
  if (posts.length === 0) {
    return <p className="text-xs text-on-surface-variant">Nothing posted yet.</p>;
  }
  return <PostList posts={posts} showToast={showToast} onRemoved={(id) => setPosts((current) => (current ?? []).filter((post) => post.id !== id))} />;
};

/**
 * Another reader, up close: their Pip, their week, their badges, their shelf
 * and (for a reader whose follow they accepted) their library — and the three
 * friendly things you can do about it. A profile kept to followers shows a
 * name and a way to ask, until it says yes. A drawer from the right; Escape
 * or the backdrop closes it, and Tab stays inside it while it is open.
 */
export const ReaderCard = ({ signedIn, canJoin, showToast, onChanged }: ReaderCardProps) => {
  const handle = useCommunityStore((state) => state.openHandle);
  const close = useCommunityStore((state) => state.closeReader);
  const [answer, setAnswer] = useState<ReaderProfile | LockedProfile | null>(null);
  const reader = answer && !answer.locked ? answer : null;
  const lockedOut = answer && answer.locked ? answer : null;
  const setReader = (change: (current: ReaderProfile | null) => ReaderProfile | null) =>
    setAnswer((current) => (current && !current.locked ? change(current) : current));
  const [tab, setTab] = useState<Tab>("shelf");
  // Seeds each side puts on a challenge: none unless chosen.
  const [stake, setStake] = useState(0);
  const [gifting, setGifting] = useState(false);
  const wallet = usePipWardrobeStore((state) => state.overview);
  const loadWallet = usePipWardrobeStore((state) => state.load);
  const seeds = wallet?.wallet.balance ?? 0;
  const mostStake = seedExtras(wallet).stakeRules?.duelMaxSeeds ?? 0;
  useEffect(() => {
    // What can be staked or given depends on the seeds there are, which this page may not have asked for yet.
    if (handle && !wallet) {
      void loadWallet();
    }
  }, [handle, wallet, loadWallet]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"follow" | "kudos" | "duel" | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const drawer = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!handle) {
      return;
    }
    let live = true;
    setAnswer(null);
    setTab("shelf");
    setStake(0);
    setGifting(false);
    setError(null);
    socialService
      .reader(handle)
      .then((profile) => live && setAnswer(profile))
      .catch((cause) => live && setError(errorText(cause)));
    // Focus moves in, and back to whatever opened the card when it closes.
    const opener = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    return () => {
      live = false;
      opener?.focus?.();
    };
  }, [handle]);
  useBackClose(Boolean(handle), close);

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
  const reportReader = useDiscussStore.getState().report;
  // Blocking: neither sees the other from then on, anywhere. Undone under Board → You.
  const block = async (who: { handle: string }) => {
    const ok = await askConfirm({
      title: `Block ${at(who.handle)}?`,
      body: "You stop seeing each other's posts, threads and replies, and neither can follow, challenge or send the other anything. They are not told.",
      confirmLabel: "Block",
      danger: true
    });
    if (!ok) {
      return;
    }
    discussService
      .block(who.handle)
      .then(() => {
        showToast(`${at(who.handle)} is blocked.`);
        onChanged();
        close();
      })
      .catch((cause) => showToast(errorText(cause)));
  };

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

        {!answer && !error && <p className="mt-10 text-sm text-on-surface-variant">Opening {at(handle)}…</p>}
        {lockedOut && (
          <>
            <div className="flex items-center gap-4 pr-8">
              <PipAvatar seed={lockedOut.pipSeed} avatar={lockedOut.avatar} size={80} label={`${nameOf(lockedOut)}'s Pip`} />
              <div className="min-w-0">
                <p className="truncate font-headline text-2xl font-bold text-on-surface">{nameOf(lockedOut)}</p>
                <p className="truncate text-sm text-on-surface-variant">{at(lockedOut.handle)}</p>
              </div>
            </div>
            <p className="flex items-center gap-2 text-sm text-on-surface-variant">
              <Lock size={14} aria-hidden /> Kept to followers.
            </p>
            <button
              type="button"
              disabled={!signedIn || !canJoin || busy !== null}
              className={`tactile-button flex items-center justify-center gap-2 px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-60 ${lockedOut.requested ? "" : "tactile-button-primary"}`}
              title={lockedOut.requested ? "Take the request back" : undefined}
              onClick={() => {
                const ask = !lockedOut.requested;
                setBusy("follow");
                socialService
                  .setFollowing(lockedOut.handle, ask)
                  .then((result) => {
                    if (result.following) {
                      // Accepted meanwhile (or made public): read the whole profile.
                      return socialService.reader(lockedOut.handle).then(setAnswer);
                    }
                    setAnswer({ ...lockedOut, requested: Boolean(result.requested) });
                    if (ask) {
                      showToast(`Asked. ${at(lockedOut.handle)} can accept from their profile.`);
                    }
                  })
                  .catch((cause) => showToast(errorText(cause)))
                  .finally(() => setBusy(null));
              }}
            >
              <UserPlus size={16} aria-hidden />
              {busy === "follow" ? "…" : lockedOut.requested ? "Requested" : "Ask to follow"}
            </button>
            {!signedIn ? (
              <p className="text-xs text-on-surface-variant">{COPY.signIn}</p>
            ) : !canJoin ? (
              <p className="text-xs text-on-surface-variant">{COPY.goPublic}</p>
            ) : null}
          </>
        )}
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
                {/* The note wraps under a long handle rather than being cut off with it. */}
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-on-surface-variant">
                  <span className="min-w-0 truncate">{at(reader.handle)}</span>
                  {relation && <span className="shrink-0 rounded-full bg-surface-container-high px-2 py-0.5 text-[11px]">{relation}</span>}
                  {typeof reader.level === "number" && reader.level > 0 && (
                    <span className="level-chip" title="Their level: from the seeds their reading has earned">
                      Level {reader.level}
                    </span>
                  )}
                </p>
                {reader.reading && (
                  <p className="mt-1 truncate text-xs text-on-surface-variant">
                    Reading <span className="font-semibold text-on-surface">{reader.reading.title}</span> · {reader.reading.percent}%
                  </p>
                )}
              </div>
            </div>

            <BadgeRow ids={reader.badges} />

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
                onClick={async () => {
                  const follow = !reader.isFollowing;
                  // A finger cannot hover to see "Unfollow": a tap on "Following" asks first.
                  if (!follow && isTouchInput()) {
                    const ok = await askConfirm({ title: `Stop following ${at(reader.handle)}?`, confirmLabel: "Unfollow", cancelLabel: "Keep following" });
                    if (!ok) {
                      return;
                    }
                  }
                  void act(
                    "follow",
                    async () => {
                      const result = await socialService.setFollowing(reader.handle, follow);
                      // What the server says, where it does: a profile made "followers only" meanwhile takes a request.
                      const following = follow ? result.following !== false : false;
                      return { isFollowing: following, followerCount: Math.max(0, reader.followerCount + (following ? 1 : follow ? 0 : -1)) };
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
                        const made = await socialService.challenge(reader.handle, stake);
                        return { activeDuel: { id: made.id, status: "pending", youChallenged: true } };
                      },
                      stake > 0 ? `${duelSentText(reader.handle)} ${stake} seeds each ride on it once they accept.` : duelSentText(reader.handle)
                    )
                  }
                >
                  <Swords size={16} aria-hidden />
                  {busy === "duel" ? "…" : duelLabel}
                </button>
              </div>

              {!locked && (
                <div className="flex flex-wrap items-center gap-2">
                  {!duel && mostStake > 0 && (
                    <label className="flex items-center gap-1.5 text-xs text-on-surface-variant" title="Seeds each of you puts on the duel. The winner's come back doubled; nothing is taken unless they accept.">
                      Stake
                      <select className="inset-field px-2 py-1 text-xs text-on-surface" value={stake} onChange={(event) => setStake(Number(event.target.value))}>
                        {[0, 10, 25, 50]
                          .filter((amount) => amount === 0 || (amount <= mostStake && amount <= seeds))
                          .map((amount) => (
                            <option key={amount} value={amount}>
                              {amount === 0 ? "Nothing" : `${amount} seeds`}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                  {reader.isFollowing && reader.followsYou && (
                    <button type="button" className="tactile-button ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs" onClick={() => setGifting(true)}>
                      <Gift size={13} aria-hidden /> Send a present
                    </button>
                  )}
                </div>
              )}

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

            {reader.arcade && reader.arcade.dash + reader.arcade.catch + reader.arcade.flap > 0 && (
              <div>
                <p className={EYEBROW}>Arcade bests</p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <Stat label="Pip Dash" value={reader.arcade.dash} />
                  <Stat label="Leaf Catch" value={reader.arcade.catch} />
                  <Stat label="Page Flap" value={reader.arcade.flap} />
                </div>
              </div>
            )}

            {reader.camp && (
              <div>
                <p className={EYEBROW}>Their camp</p>
                <div className="mt-2">
                  <CampVisit camp={reader.camp} name={at(reader.handle)} />
                </div>
              </div>
            )}

            <div>
              <div className="flex gap-1.5" role="tablist" aria-label={`${at(reader.handle)}'s books`}>
                {(
                  [
                    ["shelf", "Shelf"],
                    ["library", "Library"],
                    ["posts", "Finished"]
                  ] as Array<[Tab, string]>
                )
                  // The library only where it is shared, and only to a reader they accepted (or themself).
                  .filter(([id]) => id !== "library" || Boolean(reader.sharesLibrary))
                  .map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={tab === id}
                      className={`tactile-button px-3 py-1.5 text-xs ${tab === id ? "tactile-button-primary" : ""}`}
                      onClick={() => setTab(id)}
                    >
                      {label}
                    </button>
                  ))}
              </div>
              <div className="mt-3" role="tabpanel">
                {tab === "shelf" && <SharedShelf shelf={reader.shelf} emptyText="Nothing on the shelf yet — they're just getting started." />}
                {tab === "library" &&
                  (reader.isYou || reader.isFollowing ? (
                    <ReaderLibrary handle={reader.handle} />
                  ) : (
                    <p className="text-xs text-on-surface-variant">Follow {at(reader.handle)} to see their library.</p>
                  ))}
                {tab === "posts" && <ReaderPosts handle={reader.handle} showToast={showToast} />}
              </div>
            </div>
          </>
        )}
        {answer && !answer.isYou && signedIn && (
          <p className="mt-auto flex gap-4 border-t border-outline-variant/25 pt-3 text-[11px] text-on-surface-variant">
            <button type="button" className="hover:text-on-surface" onClick={() => reportReader({ target: "profile", id: answer.handle, what: at(answer.handle) })}>
              Report
            </button>
            <button type="button" className="hover:text-error" onClick={() => void block(answer)}>
              Block
            </button>
          </p>
        )}
      </aside>
      {gifting && reader && <GiftDialog to={reader} onClose={() => setGifting(false)} showToast={showToast} />}
    </div>
  );
};
