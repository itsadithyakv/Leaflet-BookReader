import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowLeft, Flame, Gift, Globe, Leaf, Lock, Pencil, Swords, UserCheck, UserPlus } from "lucide-react";
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
import { COPY, VISIBILITY_LABELS, duelDeclinedText, duelOnText, duelSentText, followLabel, followingText, kudosSentText, relationText, streakText } from "./copy";
import { InfoTip } from "../ui/InfoTip";
import { EYEBROW } from "../ui/SectionHeader";
import { CampBanner } from "../pip/arcade/base/CampExtras";
import { useBackClose } from "../../hooks/useBackClose";
import { isTouchInput } from "../../platform/device";
import { getDateKey } from "../../services/habitService";

type ReaderCardProps = {
  signedIn: boolean;
  /** Signed in with a public profile. */
  canJoin: boolean;
  showToast: (message: string) => void;
  /** Something changed (follow, duel): refresh the board and duels. */
  onChanged: () => void;
};

const Stat = ({ label, value, info, note }: { label: string; value: string | number; info?: string; note?: string }) => (
  <div className="paper-surface rounded-xl px-4 py-3">
    <p className={`${EYEBROW} flex items-center gap-1`}>
      {label}
      {info && <InfoTip text={info} />}
    </p>
    <p className="mt-1 font-headline text-xl font-bold tabular-nums text-on-surface">
      {value}
      {note && <span className="ml-1.5 font-body text-xs font-normal text-on-surface-variant">{note}</span>}
    </p>
  </div>
);

/** "12 followers · 30 following": on your own page each opens that list on the People tab. */
const FollowCounts = ({ followers, following, own }: { followers: number; following: number; own: boolean }) => {
  const showPeople = useCommunityStore((state) => state.showPeople);
  const part = (count: number, one: string, many: string, list: "followers" | "following") => {
    const words = (
      <>
        <span className="font-semibold tabular-nums text-on-surface">{count}</span> {count === 1 ? one : many}
      </>
    );
    return own ? (
      <button type="button" className="touch-hit rounded hover:text-primary hover:underline" onClick={() => showPeople(list)}>
        {words}
      </button>
    ) : (
      <span>{words}</span>
    );
  };
  return (
    <p className="reader-counts mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-on-surface-variant">
      {part(followers, "follower", "followers", "followers")}
      <span aria-hidden>·</span>
      {part(following, "following", "following", "following")}
    </p>
  );
};

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section aria-label={title} className="flex flex-col gap-3">
    <h2 className={EYEBROW}>{title}</h2>
    {children}
  </section>
);

/** A post that says the book is worth reading: finished or reviewed with four stars or five. */
export const recommends = (post: BookPost) => post.kind !== "quote" && (post.rating ?? 0) >= 4;

/**
 * What a reader finished and said of it, asked for as the page opens. `null`
 * while it comes; a sentence when it could not be had.
 */
const useReaderPosts = (handle: string | null) => {
  const [posts, setPosts] = useState<BookPost[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!handle) return undefined;
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
  const remove = (id: string) => setPosts((current) => (current ?? []).filter((post) => post.id !== id));
  return { posts, failed, remove };
};

/**
 * Another reader, as a page of its own on the Social page: their camp in the
 * Hollow across the top as its banner (the Hollow postcard's picture), their
 * Pip and their name under it, then the friendly things you can do about
 * them, their week, their badges, the books they recommend, their library
 * (where they share it, with a reader whose follow they accepted), their
 * shelf and what else they posted. A profile kept to followers shows a name
 * and a way to ask, until it says yes. Back (the button, Escape or Android's
 * Back) returns to the tab it was opened from.
 */
export const ReaderCard = ({ signedIn, canJoin, showToast, onChanged }: ReaderCardProps) => {
  const handle = useCommunityStore((state) => state.openHandle);
  const close = useCommunityStore((state) => state.closeReader);
  const [answer, setAnswer] = useState<ReaderProfile | LockedProfile | null>(null);
  const reader = answer && !answer.locked ? answer : null;
  const lockedOut = answer && answer.locked ? answer : null;
  const setReader = (change: (current: ReaderProfile | null) => ReaderProfile | null) =>
    setAnswer((current) => (current && !current.locked ? change(current) : current));
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
  const backButton = useRef<HTMLButtonElement | null>(null);
  const page = useRef<HTMLDivElement | null>(null);
  // Only a profile that is open to this reader has posts to read.
  const { posts, failed: postsFailed, remove: removePost } = useReaderPosts(reader ? reader.handle : null);
  // Today's kudos, from this page or from one of their posts below it: either way the day's one is spent.
  const today = getDateKey();
  const kudosNoted = useCommunityStore((state) => Boolean(handle) && state.kudosSent[(handle ?? "").toLowerCase()] === today);
  const recommended = useMemo(() => (posts ?? []).filter(recommends), [posts]);
  const otherPosts = useMemo(() => (posts ?? []).filter((post) => !recommends(post)), [posts]);

  useEffect(() => {
    if (!handle) {
      return;
    }
    let live = true;
    setAnswer(null);
    setStake(0);
    setGifting(false);
    setError(null);
    socialService
      .reader(handle)
      .then((profile) => {
        if (!live) return;
        setAnswer(profile);
        // Sent today from another device, or before this one remembered: the posts' buttons say so too.
        if (!profile.locked && profile.kudosSentToday) {
          useCommunityStore.getState().noteKudos(profile.handle, getDateKey());
        }
      })
      .catch((cause) => live && setError(errorText(cause)));
    // The page opens at its top, with the keyboard on Back; it goes back to whatever opened it when it closes.
    const opener = document.activeElement as HTMLElement | null;
    page.current?.scrollIntoView?.({ block: "start" });
    backButton.current?.focus({ preventScroll: true });
    return () => {
      live = false;
      opener?.focus?.({ preventScroll: true });
    };
  }, [handle]);
  useBackClose(Boolean(handle), close);

  if (!handle) {
    return null;
  }

  // Escape goes back, as the button does.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.stopPropagation();
      close();
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
      ref={page}
      className="mx-auto flex w-full max-w-3xl scroll-mt-4 flex-col gap-6"
      role="region"
      aria-label={reader ? `${nameOf(reader)}'s page` : "Reader"}
      onKeyDown={onKeyDown}
    >
      <div>
        <button ref={backButton} type="button" onClick={close} className="tactile-button flex items-center gap-1.5 px-3 py-1.5 text-sm">
          <ArrowLeft size={16} aria-hidden /> Back
        </button>
      </div>

      {!answer && !error && <p className="text-sm text-on-surface-variant">Opening {at(handle)}…</p>}
      {lockedOut && (
        <section className="paper-surface flex flex-col gap-4 rounded-2xl p-6">
          <div className="flex items-center gap-4">
            <PipAvatar seed={lockedOut.pipSeed} avatar={lockedOut.avatar} size={80} label={`${nameOf(lockedOut)}'s Pip`} />
            <div className="min-w-0">
              <h1 className="truncate font-headline text-2xl font-bold text-on-surface">{nameOf(lockedOut)}</h1>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-on-surface-variant">
                <span className="min-w-0 truncate">{at(lockedOut.handle)}</span>
                {lockedOut.followsYou && <span className="shrink-0 rounded-full bg-surface-container-high px-2 py-0.5 text-[11px]">{COPY.followsYou}</span>}
              </p>
            </div>
          </div>
          <p className="flex items-center gap-2 text-sm text-on-surface-variant">
            <Lock size={14} aria-hidden /> Kept to followers.
          </p>
          <button
            type="button"
            disabled={!signedIn || !canJoin || busy !== null}
            className={`tactile-button flex items-center justify-center gap-2 self-start px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-60 ${lockedOut.requested ? "" : "tactile-button-primary"}`}
            title={lockedOut.requested ? "Asked. Tap to take it back" : "They accept each follower"}
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
            {busy === "follow" ? "…" : followLabel(lockedOut.requested ? "requested" : "none")}
          </button>
          {!signedIn ? (
            <p className="text-xs text-on-surface-variant">{COPY.signIn}</p>
          ) : !canJoin ? (
            <p className="text-xs text-on-surface-variant">{COPY.goPublic}</p>
          ) : null}
        </section>
      )}
      {error && (
        <div>
          <p className="font-headline text-lg font-bold text-on-surface">{at(handle)}</p>
          <p className="mt-2 text-sm text-on-surface-variant">{error}</p>
        </div>
      )}

      {reader && (
        <>
          <header className="flex flex-col">
            {/* Their camp across the top, with their Pip standing up into it. */}
            {reader.camp && <CampBanner camp={reader.camp} name={at(reader.handle)} />}
            <div className={`flex gap-4 px-3 ${reader.camp ? "mt-3 items-start" : "items-center"}`}>
              <div className={`shrink-0 rounded-2xl bg-surface p-1 shadow-md ${reader.camp ? "relative z-[1] -mt-16" : ""}`}>
                <PipAvatar seed={reader.pipSeed} avatar={reader.avatar} size={96} play label={`${nameOf(reader)}'s Pip`} />
              </div>
              <div className="min-w-0 pt-1">
                <h1 className="truncate font-headline text-3xl font-bold text-on-surface">{nameOf(reader)}</h1>
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
                <FollowCounts followers={reader.followerCount} following={reader.followingCount} own={isYou} />
                {reader.reading && (
                  <p className="mt-1 truncate text-sm text-on-surface-variant">
                    Reading <span className="font-semibold text-on-surface">{reader.reading.title}</span> · {reader.reading.percent}%
                  </p>
                )}
              </div>
            </div>
          </header>

          {isYou && (
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="reader-privacy inline-flex items-center gap-1.5 rounded-full bg-surface-container-high px-3 py-1.5 text-xs font-semibold text-on-surface"
                title="Who can see your profile"
              >
                {reader.visibility === "public" ? <Globe size={13} aria-hidden /> : <Lock size={13} aria-hidden />}
                {VISIBILITY_LABELS[reader.visibility]}
              </span>
              <button type="button" className="tactile-button flex items-center gap-1.5 px-3 py-1.5 text-xs" onClick={() => useCommunityStore.getState().askView("community")}>
                <Pencil size={12} aria-hidden /> Edit profile
              </button>
            </div>
          )}

          {!isYou && (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <button
                type="button"
                disabled={locked || busy !== null}
                aria-label={reader.isFollowing ? `Unfollow ${at(reader.handle)}` : `Follow ${at(reader.handle)}`}
                className={`tactile-button group col-span-2 flex items-center sm:col-span-1 justify-center gap-2 px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-60 ${
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
                    <span className="group-hover:hidden group-focus-visible:hidden">{followLabel("following")}</span>
                    <span className="hidden group-hover:inline group-focus-visible:inline">Unfollow</span>
                  </>
                ) : (
                  "Follow"
                )}
              </button>
              <button
                type="button"
                disabled={locked || busy !== null || Boolean(reader.kudosSentToday) || kudosNoted}
                className="tactile-button flex items-center justify-center gap-2 px-3 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                title={COPY.kudosRule}
                onClick={() =>
                  void act(
                    "kudos",
                    async () => {
                      const result = await socialService.sendKudos(reader.handle);
                      useCommunityStore.getState().noteKudos(reader.handle, getDateKey());
                      return { kudosSentToday: true, kudosThisWeek: result.kudosThisWeek };
                    },
                    kudosSentText(reader.handle)
                  )
                }
              >
                <Leaf size={16} className="text-primary" aria-hidden />
                {reader.kudosSentToday || kudosNoted ? "Kudos sent" : busy === "kudos" ? "…" : "Send kudos"}
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

            {!signedIn ? (
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
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Streak" value={streakText(reader.streak)} />
            <Stat label="This week" value={minutesText(reader.weekMinutes)} />
            <Stat label="Finished" value={reader.booksFinished} />
            {/* This month's from a 1.5.15 server; this week's from an older one, which keeps no more. */}
            {typeof reader.kudosThisMonth === "number" ? (
              <Stat label="Kudos" value={reader.kudosThisMonth} note="this month" info={COPY.kudosExplained} />
            ) : (
              <Stat label="Kudos" value={reader.kudosThisWeek} note="this week" info={COPY.kudosExplained} />
            )}
          </div>

          {reader.badges && reader.badges.length > 0 && <BadgeRow ids={reader.badges} />}

          {recommended.length > 0 && (
            <Section title="Recommends">
              <PostList posts={recommended} showToast={showToast} onRemoved={removePost} />
            </Section>
          )}

          {/* The library only where it is shared, and only to a reader they accepted (or themself). */}
          {reader.sharesLibrary && (
            <Section title="Library">
              {reader.isYou || reader.isFollowing ? (
                <ReaderLibrary handle={reader.handle} />
              ) : (
                <p className="text-xs text-on-surface-variant">Follow {at(reader.handle)} to see their library.</p>
              )}
            </Section>
          )}

          {reader.shelf.length > 0 && (
            <Section title="Shelf">
              <SharedShelf shelf={reader.shelf} />
            </Section>
          )}

          {postsFailed ? (
            <Section title="Posts">
              <p className="text-xs text-on-surface-variant">{postsFailed}</p>
            </Section>
          ) : (
            otherPosts.length > 0 && (
              <Section title="Posts">
                <PostList posts={otherPosts} showToast={showToast} onRemoved={removePost} />
              </Section>
            )
          )}

          {reader.arcade && reader.arcade.dash + reader.arcade.catch + reader.arcade.flap > 0 && (
            <Section title="Arcade bests">
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Pip Dash" value={reader.arcade.dash} />
                <Stat label="Leaf Catch" value={reader.arcade.catch} />
                <Stat label="Page Flap" value={reader.arcade.flap} />
              </div>
            </Section>
          )}
        </>
      )}
      {answer && !answer.isYou && signedIn && (
        <p className="flex gap-4 border-t border-outline-variant/25 pt-3 text-[11px] text-on-surface-variant">
          <button type="button" className="touch-hit hover:text-on-surface" onClick={() => reportReader({ target: "profile", id: answer.handle, what: at(answer.handle) })}>
            Report
          </button>
          <button type="button" className="touch-hit hover:text-error" onClick={() => void block(answer)}>
            Block
          </button>
        </p>
      )}
      {gifting && reader && <GiftDialog to={reader} onClose={() => setGifting(false)} showToast={showToast} />}
    </div>
  );
};
