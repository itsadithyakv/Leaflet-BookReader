import { useCallback, useEffect, useRef, useState } from "react";
import { Clock, Copy, Lock, UserCheck, UserPlus } from "lucide-react";
import {
  socialService,
  type FollowState,
  type PeopleSort,
  type PersonCard
} from "../../services/socialService";
import { FEATURES } from "../../constants/features";
import { useAccountStore } from "../../store/accountStore";
import { useLibraryStore } from "../../store/libraryStore";
import { isTouchInput } from "../../platform/device";
import { askConfirm } from "../ConfirmDialog";
import { SignInPrompt } from "../account/SignInPrompt";
import { UiIcon } from "../UiIcon";
import { SectionHeader } from "../ui/SectionHeader";
import { SegmentedTabs } from "../ui/SegmentedTabs";
import { useCommunityStore, type PeopleView } from "./communityStore";
import { COPY, SORT_LABELS, followLabel, reasonText } from "./copy";
import { at, errorText, gentleError, nameOf } from "./format";
import { joinPages, movedCount, stateAfter, stateOf, tapWants, weekLine } from "./people";
import { passOn, passOnLabel } from "./passOn";
import { PipAvatar } from "./PipAvatar";

type Toast = (message: string) => void;

const DEBOUNCE_MS = 300;
const SORTS: PeopleSort[] = ["active", "most", "new"];

/** A list as it stands on the page: the readers shown, where it goes on from, and whether this server has it at all. */
type Listing = { people: PersonCard[]; next: string | null; count: number | null; unsupported: boolean };
const EMPTY: Listing = { people: [], next: null, count: null, unsupported: false };

/**
 * What the tab last showed, kept while the app runs: opening a reader's page
 * puts the tabs away, and coming back should not start again from nothing.
 * Whose it was (`owner`, the handle): another reader signed in starts afresh,
 * since each card says how the reader stood with it.
 */
const kept: { owner: string | null; sort: PeopleSort; lists: Partial<Record<string, Listing>> } = { owner: null, sort: "active", lists: {} };

/** Forgets what the tab kept. */
export const forgetPeople = () => {
  kept.owner = null;
  kept.sort = "active";
  kept.lists = {};
};
const keyOf = (view: PeopleView, sort: PeopleSort) => (view === "everyone" ? `everyone:${sort}` : view);

// ---- one reader -----------------------------------------------------------------

type CardProps = {
  card: PersonCard;
  state: FollowState;
  busy: boolean;
  /** Whether this reader may follow anyone (signed in, a shared profile). */
  canFollow: boolean;
  onFollow: (card: PersonCard) => void;
  onOpen: (handle: string) => void;
  isYou: boolean;
};

/** A reader as a card: their Pip, name and handle, this week, why (for a suggestion), and the follow button. */
const PersonRow = ({ card, state, busy, canFollow, onFollow, onOpen, isYou }: CardProps) => {
  const line = weekLine(card);
  const label = followLabel(state);
  return (
    <li className="people-card paper-surface flex min-w-0 list-none items-center gap-3 rounded-xl p-3">
      <button
        type="button"
        onClick={() => onOpen(card.handle)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        aria-label={`Open ${nameOf(card)}'s page`}
      >
        <PipAvatar seed={card.pipSeed} avatar={card.avatar} size={44} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-on-surface">{nameOf(card)}</span>
            {card.followsYou && !isYou && (
              <span className="people-follows-you shrink-0 rounded-full bg-surface-container-high px-1.5 py-px text-[10px] font-semibold text-on-surface-variant">
                {COPY.followsYou}
              </span>
            )}
          </span>
          <span className="block truncate text-xs text-on-surface-variant">{at(card.handle)}</span>
          {/* One more line: why they are suggested, that they are locked, or their week. */}
          {card.locked ? (
            <span className="mt-0.5 flex items-center gap-1 text-[11px] text-on-surface-variant">
              <Lock size={11} aria-hidden /> Followers only
            </span>
          ) : card.reason ? (
            <span className="mt-0.5 block truncate text-[11px] text-primary">{reasonText(card.reason)}</span>
          ) : (
            line && <span className="mt-0.5 block truncate text-[11px] text-on-surface-variant">{line}</span>
          )}
        </span>
      </button>
      {!isYou && canFollow && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onFollow(card)}
          aria-pressed={state !== "none"}
          aria-label={state === "none" ? `Follow ${at(card.handle)}` : state === "requested" ? `Take back the request to follow ${at(card.handle)}` : `Unfollow ${at(card.handle)}`}
          title={state === "requested" ? "Asked. Tap to take it back" : state === "following" ? "Unfollow" : card.locked ? "They accept each follower" : undefined}
          className={`tactile-button group flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-60 ${state === "none" ? "tactile-button-primary" : ""}`}
        >
          {state === "following" ? <UserCheck size={14} aria-hidden /> : state === "requested" ? <Clock size={14} aria-hidden /> : <UserPlus size={14} aria-hidden />}
          {busy ? "…" : label}
        </button>
      )}
    </li>
  );
};

const Skeleton = ({ rows = 6 }: { rows?: number }) => (
  <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-hidden>
    {Array.from({ length: rows }, (_, index) => (
      <li key={index} className="paper-surface flex list-none items-center gap-3 rounded-xl p-3">
        <span className="h-11 w-11 shrink-0 rounded-full bg-surface-container-high" />
        <span className="flex-1">
          <span className="block h-3 w-1/2 rounded bg-surface-container-high" />
          <span className="mt-2 block h-2.5 w-2/3 rounded bg-surface-container-high/70" />
        </span>
      </li>
    ))}
  </ul>
);

// ---- the tab --------------------------------------------------------------------

/**
 * The People tab (1.5.15; it replaced "Find readers" on the Board and "Add
 * friends" under Friends): one place to find readers and see who you follow.
 *
 * A search by name or handle at the top. Empty, it shows suggestions (readers
 * of your books, readers your follows follow) and every public reader in one
 * of three orders, twenty at a time; Followers and Following are the other two
 * views, with their counts. A reader kept to followers is found only by search,
 * as a locked card; a private one nowhere.
 *
 * Against a server from before 1.5.15 the search still works (by the start of
 * the handle), Following is the whole list at once, and the rest is one quiet
 * line saying it comes with the next server update.
 */
export const PeoplePanel = ({ showToast, onNavigate }: { showToast: Toast; onNavigate: (tab: "settings") => void }) => {
  const signedIn = useAccountStore((state) => state.status.signedIn);
  const apiBase = useLibraryStore((state) => state.sync.apiBase);
  const live = FEATURES.community && Boolean(apiBase);
  const me = useCommunityStore((state) => state.me);
  const loadMe = useCommunityStore((state) => state.loadMe);
  const openReader = useCommunityStore((state) => state.openReader);
  const view = useCommunityStore((state) => state.peopleView);
  const setView = useCommunityStore((state) => state.setPeopleView);
  const askView = useCommunityStore((state) => state.askView);
  const shared = Boolean(me?.handle) && me?.visibility !== "private" && me !== null;
  const canFollow = signedIn && shared;
  const owner = signedIn ? me?.handle ?? "" : null;
  if (kept.owner !== owner) {
    forgetPeople();
    kept.owner = owner;
  }

  const [sort, setSortState] = useState<PeopleSort>(kept.sort);
  const [lists, setLists] = useState<Partial<Record<string, Listing>>>(kept.lists);
  const [loading, setLoading] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<PersonCard[] | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PersonCard[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [changed, setChanged] = useState<Record<string, FollowState>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const asked = useRef(new Set<string>());

  useEffect(() => {
    kept.sort = sort;
    kept.lists = lists;
  }, [sort, lists]);

  useEffect(() => {
    if (live && signedIn && !me) {
      void loadMe();
    }
  }, [live, signedIn, me, loadMe]);

  const put = (key: string, listing: Listing) => setLists((current) => ({ ...current, [key]: listing }));

  /** Reads the first page of a list, or the next one after what is shown. */
  const load = useCallback(
    async (which: PeopleView, order: PeopleSort, more: boolean) => {
      const key = keyOf(which, order);
      const shown = more ? kept.lists[key] : undefined;
      setLoading(key);
      setFailed(null);
      try {
        if (which === "everyone") {
          const page = await socialService.people(order, shown?.next ?? null);
          put(key, page ? { people: joinPages(shown?.people ?? [], page.people), next: page.next, count: null, unsupported: false } : { ...EMPTY, unsupported: true });
        } else {
          const page = await socialService.followList(which, shown?.next ?? null);
          if (page) {
            put(key, { people: joinPages(shown?.people ?? [], page.people), next: page.next, count: page.count ?? null, unsupported: false });
          } else if (which === "following") {
            // An older server lists whom the reader follows all at once, with no more about them.
            const all = await socialService.following();
            // Their minutes are not in that answer: NaN, which the card leaves out (`weekLine`).
            const people = all.following.map((person) => ({ ...person, weekMinutes: Number.NaN, streak: 0, followState: "following" as const }));
            put(key, { people, next: null, count: people.length, unsupported: false });
            // Its count of followers too, though not who they are.
            setLists((current) => ({ ...current, followers: { ...EMPTY, unsupported: true, count: all.followerCount } }));
          } else {
            put(key, { ...EMPTY, unsupported: true });
          }
        }
      } catch (cause) {
        setFailed(errorText(cause));
      } finally {
        setLoading((current) => (current === key ? null : current));
      }
    },
    []
  );

  // What is on screen is read when it is first shown; the other list's count with it, for the switch.
  useEffect(() => {
    if (!live) return;
    const wanted: Array<[PeopleView, PeopleSort]> = [[view, sort]];
    if (signedIn) {
      wanted.push(["followers", sort], ["following", sort]);
    }
    for (const [which, order] of wanted) {
      const key = keyOf(which, order);
      if (!kept.lists[key] && !asked.current.has(key)) {
        asked.current.add(key);
        void load(which, order, false);
      }
    }
  }, [live, signedIn, view, sort, load]);

  useEffect(() => {
    if (!live || !canFollow) {
      setSuggested(null);
      return;
    }
    let alive = true;
    socialService
      .suggested()
      .then((found) => alive && setSuggested(found))
      .catch(() => alive && setSuggested(null));
    return () => {
      alive = false;
    };
  }, [live, canFollow]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      setSearchError(null);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      socialService
        .search(q)
        .then((found) => {
          if (alive) {
            setResults(found);
            setSearchError(null);
          }
        })
        .catch((cause) => alive && setSearchError(errorText(cause)));
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const follow = async (card: PersonCard) => {
    const before = stateOf(card, changed);
    const want = tapWants(before);
    if (before === "following" && isTouchInput()) {
      const ok = await askConfirm({ title: `Stop following ${at(card.handle)}?`, confirmLabel: "Unfollow", cancelLabel: "Keep following" });
      if (!ok) return;
    }
    setBusy(card.handle);
    try {
      const result = await socialService.setFollowing(card.handle, want);
      const after = want ? stateAfter(result) : "none";
      setChanged((current) => ({ ...current, [card.handle]: after }));
      setLists((current) => {
        const following = current.following;
        return following ? { ...current, following: { ...following, count: movedCount(following.count, before, after) } } : current;
      });
      if (after === "following" && want) showToast(`You follow ${at(card.handle)}.`);
      if (after === "requested") showToast(`Asked ${at(card.handle)}. They answer in their inbox.`);
      void useCommunityStore.getState().loadBoard("following");
    } catch (cause) {
      showToast(gentleError(errorText(cause)));
    } finally {
      setBusy(null);
    }
  };

  const mine = shared ? me?.handle ?? null : null;
  const copyHandle = () => mine && passOn(`Follow me on Leaflet: ${at(mine)}`, showToast, `You are ${at(mine)}.`);

  const listLabel = (which: "followers" | "following", word: string) => {
    const count = lists[which]?.count;
    return typeof count === "number" ? `${word} ${count}` : word;
  };
  const viewTabs = [
    { id: "everyone" as const, label: "Everyone" },
    ...(signedIn
      ? [
          { id: "followers" as const, label: listLabel("followers", "Followers") },
          { id: "following" as const, label: listLabel("following", "Following") }
        ]
      : [])
  ];

  if (!live) {
    return (
      <section className="paper-surface rounded-xl p-6">
        <SectionHeader eyebrow="People" title={FEATURES.community ? "Not connected" : "Coming soon"} />
        <p className="mt-3 max-w-prose text-sm leading-6 text-on-surface-variant">{FEATURES.community ? COPY.notConnected : COPY.comingSoon}</p>
      </section>
    );
  }

  const row = (card: PersonCard) => (
    <PersonRow
      key={card.handle}
      card={card}
      state={stateOf(card, changed)}
      busy={busy === card.handle}
      canFollow={canFollow}
      onFollow={(one) => void follow(one)}
      onOpen={openReader}
      isYou={Boolean(card.isYou) || card.handle === me?.handle}
    />
  );
  const grid = "grid gap-2 sm:grid-cols-2 xl:grid-cols-3";
  const searching = query.trim().length > 0;
  const key = keyOf(view, sort);
  const listing = lists[key];
  const shownView = signedIn ? view : "everyone";

  return (
    <div className="people-tab flex flex-col gap-5">
      {!signedIn && <SignInPrompt line="Sign in to follow readers." onSettings={() => onNavigate("settings")} />}
      {signedIn && me && !shared && (
        <section className="paper-surface flex flex-wrap items-center gap-3 rounded-xl p-4">
          <Lock size={16} className="text-on-surface-variant" aria-hidden />
          <p className="min-w-0 flex-1 text-sm font-semibold text-on-surface">{me.handle ? "Your profile is private." : "Pick a handle to follow readers."}</p>
          <button type="button" className="tactile-button tactile-button-primary px-4 py-2 text-xs font-semibold" onClick={() => askView("community")}>
            {me.handle ? "Share it" : "Pick one"}
          </button>
        </section>
      )}

      <section className="paper-surface rounded-xl p-3 sm:p-5" aria-label="Find readers">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <UiIcon name="search" size={17} className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-on-surface-variant" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name or @handle"
              aria-label="Find a reader by name or handle"
              autoComplete="off"
              spellCheck={false}
              maxLength={60}
              className="inset-field w-full py-2.5 pl-10 pr-3 text-sm text-on-surface"
            />
          </div>
          {mine && (
            <button
              type="button"
              className="tactile-button inline-flex shrink-0 items-center gap-1.5 px-3 py-2 text-xs"
              onClick={copyHandle}
              aria-label={`Send your handle, ${at(mine)}`}
              title={`Copy your handle (${at(mine)}), to send to a friend so they can follow you`}
            >
              <Copy size={13} aria-hidden /> <span className="phone-hidden">{passOnLabel(at(mine))}</span>
            </button>
          )}
        </div>
        {!searching && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            {viewTabs.length > 1 ? (
              <SegmentedTabs label="Readers" idPrefix="people-view" tabs={viewTabs} value={shownView} onChange={setView} />
            ) : (
              <span />
            )}
            {shownView === "everyone" && !listing?.unsupported && (
              <SegmentedTabs
                label="Sort readers"
                idPrefix="people-sort"
                tabs={SORTS.map((id) => ({ id, label: SORT_LABELS[id] }))}
                value={sort}
                onChange={setSortState}
                className="people-sort"
              />
            )}
          </div>
        )}
      </section>

      {searching ? (
        <section aria-label="Readers found" className="flex flex-col gap-3">
          {searchError && <p className="text-xs text-on-surface-variant">{gentleError(searchError)}</p>}
          {results === null && !searchError && <Skeleton rows={3} />}
          {results && results.length === 0 && !searchError && <p className="px-1 text-sm text-on-surface-variant">Nobody found by that name or handle.</p>}
          {results && results.length > 0 && <ul className={grid}>{results.map(row)}</ul>}
        </section>
      ) : (
        <>
          {shownView === "everyone" && suggested && suggested.length > 0 && (
            <section aria-labelledby="people-suggested" className="flex flex-col gap-3">
              <h2 id="people-suggested" className="px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-on-surface-variant">
                Suggested for you
              </h2>
              <ul className={grid}>{suggested.map(row)}</ul>
            </section>
          )}

          <section aria-label={shownView === "everyone" ? SORT_LABELS[sort] : shownView === "followers" ? "Your followers" : "Readers you follow"} className="flex flex-col gap-3">
            {shownView === "everyone" && suggested && suggested.length > 0 && !listing?.unsupported && (
              <h2 className="px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-on-surface-variant">{SORT_LABELS[sort]}</h2>
            )}
            {listing?.unsupported ? (
              <p className="px-1 text-xs text-on-surface-variant">{COPY.peopleLater}</p>
            ) : !listing ? (
              failed ? (
                <p className="flex flex-wrap items-center gap-2 px-1 text-xs text-on-surface-variant">
                  {failed}
                  <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void load(shownView, sort, false)}>
                    Try again
                  </button>
                </p>
              ) : (
                <Skeleton />
              )
            ) : listing.people.length === 0 ? (
              <p className="px-1 text-sm text-on-surface-variant">
                {shownView === "followers" ? "Nobody follows you yet." : shownView === "following" ? "You don't follow anyone yet." : sort === "most" ? "Nobody has read this week yet." : "Nobody here yet."}
              </p>
            ) : (
              <>
                <ul className={grid}>{listing.people.map(row)}</ul>
                {listing.next && (
                  <button
                    type="button"
                    className="tactile-button self-center px-5 py-2 text-xs disabled:opacity-60"
                    disabled={loading === key}
                    onClick={() => void load(shownView, sort, true)}
                  >
                    {loading === key ? "…" : "Show more"}
                  </button>
                )}
                {failed && <p className="px-1 text-xs text-on-surface-variant">{failed}</p>}
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
};
