import { useCallback, useEffect, useState } from "react";
import { Copy, LogOut, Plus } from "lucide-react";
import { friendsService, type BookPost, type Club, type FriendsBook } from "../../services/friendsService";
import { socialService } from "../../services/socialService";
import { FEATURES } from "../../constants/features";
import { useAccountStore } from "../../store/accountStore";
import { useLibraryStore } from "../../store/libraryStore";
import { askConfirm } from "../ConfirmDialog";
import { PipSprite } from "../PipSprite";
import { SectionHeader } from "../ui/SectionHeader";
import { useCommunityStore } from "./communityStore";
import { COPY, PROFILE_PLACE } from "./copy";
import { ErrorLine } from "./ErrorLine";
import { Inbox } from "./Inbox";
import { PipAvatar } from "./PipAvatar";
import { PostList } from "./Posts";
import { ReaderSearch } from "./ReaderSearch";
import { composePost, usePostStore } from "./postStore";
import { at, errorText, minutesText, nameOf } from "./format";
import { passOn } from "./passOn";
import "./friends.css";

type Toast = (message: string) => void;

// ---- the feed ----------------------------------------------------------------

/** Finished books from you and the readers you follow, newest first. */
const FeedCard = ({ showToast }: { showToast: Toast }) => {
  const changed = usePostStore((state) => state.changed);
  const [posts, setPosts] = useState<BookPost[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Counts up to ask again after a failure.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    friendsService
      .feed()
      .then((feed) => {
        if (live) {
          setPosts(feed.posts);
          setMore(feed.more);
          setError(null);
        }
      })
      .catch((cause) => live && setError(errorText(cause)));
    return () => {
      live = false;
    };
  }, [changed, attempt]);

  const older = () => {
    const last = posts?.[posts.length - 1];
    if (!last) {
      return;
    }
    setBusy(true);
    friendsService
      .feed(last.createdAt)
      .then((feed) => {
        setPosts((current) => [...(current ?? []), ...feed.posts]);
        setMore(feed.more);
      })
      .catch((cause) => showToast(errorText(cause)))
      .finally(() => setBusy(false));
  };

  return (
    <section className="paper-surface rounded-xl p-4 sm:p-6" aria-labelledby="feed-title">
      <SectionHeader
        eyebrow="Finished lately"
        title="Feed"
        id="feed-title"
        actions={
          <button type="button" className="tactile-button tactile-button-primary flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold" onClick={() => composePost()}>
            <Plus size={13} aria-hidden /> I finished a book
          </button>
        }
      />
      {error ? (
        <ErrorLine message={error} onRetry={() => (setError(null), setAttempt((count) => count + 1))} />
      ) : posts === null ? (
        <p className="mt-4 text-sm text-on-surface-variant">Reading the feed…</p>
      ) : posts.length === 0 ? (
        <div className="mt-2 flex items-center gap-4 py-3">
          <PipSprite move="read" size={48} still />
          <p className="text-sm text-on-surface-variant">Nothing yet. When you or a reader you follow finishes a book, it lands here.</p>
        </div>
      ) : (
        <div className="mt-4">
          <PostList posts={posts} showToast={showToast} onRemoved={(id) => setPosts((current) => (current ?? []).filter((post) => post.id !== id))} />
          {more && (
            <button type="button" className="tactile-button mt-4 px-4 py-2 text-xs disabled:opacity-60" onClick={older} disabled={busy}>
              {busy ? "…" : "Older"}
            </button>
          )}
        </div>
      )}
    </section>
  );
};

// ---- your books, among the readers you follow --------------------------------

/**
 * This library's books that the readers you follow have too: who is reading
 * one now, and how far along (so two friends on one book see each other's
 * place), and how many finished it.
 */
const FriendsBooksCard = () => {
  const books = useLibraryStore((state) => state.books);
  const openReader = useCommunityStore((state) => state.openReader);
  const [found, setFound] = useState<FriendsBook[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Asked again when the library changes size, not on every page turn.
  const size = books.length;
  // Counts up to ask again after a failure.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    friendsService
      .friendsBooks()
      .then((answer) => live && (setFound(answer), setError(null)))
      .catch((cause) => live && setError(errorText(cause)));
    return () => {
      live = false;
    };
  }, [size, attempt]);

  const mine = new Map(books.map((book) => [book.id, book]));
  const together = (found ?? []).filter((book) => book.readers.length > 0);
  const finished = (found ?? []).filter((book) => book.finished > 0).sort((a, b) => b.finished - a.finished);

  return (
    <section className="paper-surface rounded-xl p-4 sm:p-6" aria-labelledby="together-title">
      <SectionHeader eyebrow="Your books, their places" title="Reading with friends" id="together-title" />
      {error ? (
        <ErrorLine message={error} onRetry={() => (setError(null), setAttempt((count) => count + 1))} />
      ) : found === null ? (
        <p className="mt-4 text-sm text-on-surface-variant">Looking…</p>
      ) : together.length === 0 && finished.length === 0 ? (
        <p className="mt-4 text-sm text-on-surface-variant">
          None of your books are in a library a reader you follow shares. They share theirs under {PROFILE_PLACE}.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-5">
          {together.map((book) => {
            const own = Math.round(Math.min(1, Math.max(0, mine.get(book.bookId)?.progress ?? 0)) * 100);
            return (
              <div key={book.bookId}>
                <p className="truncate text-sm font-semibold text-on-surface">{book.title}</p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  <li className="flex items-center gap-2 text-xs text-on-surface-variant">
                    <span className="w-24 shrink-0 truncate font-semibold text-on-surface">You</span>
                    <span className="friend-bar" aria-hidden="true">
                      <span style={{ width: `${own}%` }} />
                    </span>
                    <span className="w-9 shrink-0 text-right tabular-nums">{own}%</span>
                  </li>
                  {book.readers.map((reader) => (
                    <li key={reader.handle} className="flex items-center gap-2 text-xs text-on-surface-variant">
                      <button type="button" className="flex w-24 shrink-0 items-center gap-1.5 truncate text-left hover:text-primary" onClick={() => openReader(reader.handle)}>
                        <PipAvatar seed={reader.pipSeed} avatar={reader.avatar} size={18} />
                        <span className="truncate">{nameOf(reader)}</span>
                      </button>
                      <span className="friend-bar" aria-hidden="true">
                        <span style={{ width: `${reader.percent}%` }} />
                      </span>
                      <span className="w-9 shrink-0 text-right tabular-nums">{reader.percent}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {finished.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {finished.slice(0, 8).map((book) => (
                <li key={book.bookId} className="flex items-baseline gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-on-surface">{book.title}</span>
                  <span className="shrink-0 text-xs text-on-surface-variant">
                    {book.finished === 1 ? "1 reader you follow finished it" : `${book.finished} readers you follow finished it`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
};

// ---- book clubs --------------------------------------------------------------

const ClubCard = ({ club, showToast, onChanged }: { club: Club; showToast: Toast; onChanged: () => void }) => {
  const openReader = useCommunityStore((state) => state.openReader);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const run = (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    work()
      .then(() => {
        if (done) {
          showToast(done);
        }
        onChanged();
      })
      .catch((cause) => showToast(errorText(cause)))
      .finally(() => setBusy(false));
  };

  const copyCode = () => {
    passOn(`Join my Leaflet book club “${club.name}”: Social → Friends → Join a club, code ${club.code}`, showToast, `The code is ${club.code}.`);
  };

  const leave = async () => {
    const ok = await askConfirm({
      title: `Leave “${club.name}”?`,
      body: club.members.length <= 1 ? "You are its last member, so the club goes too." : "You can join again with its code.",
      confirmLabel: "Leave",
      danger: true
    });
    if (ok) {
      run(() => friendsService.leaveClub(club.id), `Left ${club.name}.`);
    }
  };

  const changeGoal = () => {
    const next = club.goalMinutes === 0 ? 120 : club.goalMinutes >= 600 ? 0 : club.goalMinutes + 60;
    run(() => friendsService.updateClub(club.id, { goalMinutes: next }));
  };

  const met = club.goalMinutes > 0 ? club.members.filter((member) => member.weekMinutes >= club.goalMinutes).length : 0;

  return (
    <article className="rounded-xl border border-outline-variant/30 bg-surface-container/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-headline text-lg font-bold text-on-surface">{club.name}</h3>
          <p className="text-xs text-on-surface-variant">
            {club.members.length} {club.members.length === 1 ? "member" : "members"}
            {club.goalMinutes > 0 && ` · ${minutesText(club.goalMinutes)} a week each · ${met} there`}
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button type="button" className="tactile-button flex items-center gap-1 px-2.5 py-1.5 text-[11px]" onClick={copyCode} title={`Copies an invitation with the code ${club.code}`}>
            <Copy size={12} aria-hidden /> Invite
          </button>
          {club.isOwner && (
            <button
              type="button"
              className="tactile-button px-2.5 py-1.5 text-[11px] disabled:opacity-60"
              disabled={busy}
              onClick={changeGoal}
              title="The minutes a week each member aims for: an hour more each press, then none"
            >
              Goal: {club.goalMinutes > 0 ? minutesText(club.goalMinutes) : "none"}
            </button>
          )}
          <button type="button" className="tactile-button flex items-center gap-1 px-2.5 py-1.5 text-[11px] disabled:opacity-60" disabled={busy} onClick={() => void leave()} aria-label={`Leave ${club.name}`}>
            <LogOut size={12} aria-hidden />
          </button>
        </div>
      </div>

      <ol className="mt-3 flex flex-col gap-1">
        {club.members.map((member, index) => (
          <li key={member.handle} className="flex items-center gap-2 text-sm">
            <span className="w-5 shrink-0 text-right text-xs tabular-nums text-on-surface-variant">{index + 1}</span>
            <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-primary" onClick={() => openReader(member.handle)}>
              <PipAvatar seed={member.pipSeed} avatar={member.avatar} size={22} />
              <span className={`truncate ${member.isYou ? "font-semibold text-on-surface" : "text-on-surface"}`}>{member.isYou ? "You" : nameOf(member)}</span>
            </button>
            <span className="shrink-0 text-xs tabular-nums text-on-surface-variant">{minutesText(member.weekMinutes)}</span>
          </li>
        ))}
      </ol>

      <div className="mt-3 border-t border-outline-variant/25 pt-3">
        {club.books.length > 0 && (
          <ul className="mb-2 flex flex-col gap-0.5">
            {club.books.map((book) => (
              <li key={book.title} className="truncate text-sm text-on-surface">
                {book.title}
                {book.author && <span className="text-xs text-on-surface-variant"> · {book.author}</span>}
              </li>
            ))}
          </ul>
        )}
        {adding ? (
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const name = title.trim();
              if (!name) {
                return;
              }
              run(() => friendsService.addClubBook(club.id, name, null).then(() => (setTitle(""), setAdding(false))));
            }}
          >
            <input autoFocus className="inset-field min-w-0 flex-1 px-2 py-1.5 text-sm text-on-surface" placeholder="A book for the club" maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} />
            <button type="submit" className="tactile-button tactile-button-primary px-3 py-1.5 text-xs font-semibold disabled:opacity-60" disabled={busy}>
              Add
            </button>
          </form>
        ) : (
          <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => setAdding(true)}>
            Add a book
          </button>
        )}
      </div>
    </article>
  );
};

/** Book clubs: a few readers, a shared list of books, a weekly goal and a board of their own. */
const ClubsCard = ({ showToast }: { showToast: Toast }) => {
  const [clubs, setClubs] = useState<Club[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<"none" | "new" | "join">("none");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    friendsService
      .clubs()
      .then((answer) => (setClubs(answer), setError(null)))
      .catch((cause) => setError(errorText(cause)));
  }, []);
  useEffect(load, [load]);

  const submit = () => {
    const value = text.trim();
    if (!value) {
      return;
    }
    setBusy(true);
    (form === "new" ? friendsService.createClub(value, 0) : friendsService.joinClub(value.toUpperCase()))
      .then((club) => {
        setText("");
        setForm("none");
        showToast(form === "new" ? `${club.name} is made. Invite readers with its code.` : `You joined ${club.name}.`);
        load();
      })
      .catch((cause) => showToast(errorText(cause)))
      .finally(() => setBusy(false));
  };

  return (
    <section className="paper-surface rounded-xl p-4 sm:p-6" aria-labelledby="clubs-title">
      <SectionHeader
        eyebrow="Read the same books"
        title="Book clubs"
        id="clubs-title"
        actions={
          <span className="flex gap-2">
            <button type="button" className="tactile-button px-3 py-1.5 text-xs" aria-expanded={form === "join"} onClick={() => (setText(""), setForm(form === "join" ? "none" : "join"))}>
              Join a club
            </button>
            <button type="button" className="tactile-button tactile-button-primary px-3 py-1.5 text-xs font-semibold" aria-expanded={form === "new"} onClick={() => (setText(""), setForm(form === "new" ? "none" : "new"))}>
              New club
            </button>
          </span>
        }
      />
      {form !== "none" && (
        <form
          className="mt-4 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <input
            autoFocus
            className="inset-field min-w-0 flex-1 px-3 py-2 text-sm text-on-surface"
            placeholder={form === "new" ? "The club's name" : "The code you were sent"}
            maxLength={form === "new" ? 60 : 12}
            autoCapitalize={form === "new" ? "sentences" : "characters"}
            autoCorrect={form === "new" ? undefined : "off"}
            spellCheck={form === "new"}
            enterKeyHint="go"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <button type="submit" className="tactile-button tactile-button-primary px-4 py-2 text-xs font-semibold disabled:opacity-60" disabled={busy}>
            {form === "new" ? "Make it" : "Join"}
          </button>
        </form>
      )}
      {error ? (
        <ErrorLine message={error} onRetry={() => (setError(null), load())} />
      ) : clubs === null ? (
        <p className="mt-4 text-sm text-on-surface-variant">Looking…</p>
      ) : clubs.length === 0 ? (
        <p className="mt-4 text-sm text-on-surface-variant">None yet. Make one and send its code to the readers you want in it.</p>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {clubs.map((club) => (
            <ClubCard key={club.id} club={club} showToast={showToast} onChanged={load} />
          ))}
        </div>
      )}
    </section>
  );
};

// ---- the tab ------------------------------------------------------------------

/**
 * A private profile, before any of this: one press shares it with followers
 * only (nobody sees it until they ask and are let in), where it used to say
 * where in the app to go and do so. A reader with no handle yet is sent to
 * pick one, which is where the rest of the profile is.
 */
const ShareFirst = ({ handle, showToast }: { handle: string | null; showToast: Toast }) => {
  const loadMe = useCommunityStore((state) => state.loadMe);
  const [busy, setBusy] = useState(false);
  const share = () => {
    setBusy(true);
    socialService
      .saveProfile({ handle, visibility: "followers" })
      .then(() => {
        showToast("Shared with followers. Nobody sees it until you let them in.");
        return loadMe();
      })
      .catch((cause) => showToast(errorText(cause)))
      .finally(() => setBusy(false));
  };
  return (
    <section className="paper-surface flex flex-wrap items-center gap-5 rounded-xl p-6">
      <div className="min-w-0 flex-1">
        <SectionHeader eyebrow="Friends" title="Share your profile first" />
        <p className="mt-2 max-w-prose text-sm leading-6 text-on-surface-variant">
          {handle
            ? `Your profile (${at(handle)}) is private, so nobody can follow you or be followed back.`
            : `Pick a handle under ${PROFILE_PLACE}, so friends can find you.`}
        </p>
      </div>
      {handle && (
        <button
          type="button"
          className="tactile-button tactile-button-primary px-4 py-2 text-xs"
          disabled={busy}
          onClick={share}
          title="Share with followers only: a reader asks, and you let them in. Change it any time under Board, You."
        >
          {busy ? "…" : "Share with friends"}
        </button>
      )}
    </section>
  );
};

/**
 * The Friends tab of the Social page: what the readers you follow finished,
 * where they are in the books you share, and your book clubs. Needs an
 * account and a shared profile, like following does.
 */
export const FriendsPanel = ({ showToast, onNavigate }: { showToast: Toast; onNavigate: (tab: "settings") => void }) => {
  const signedIn = useAccountStore((state) => state.status.signedIn);
  const apiBase = useLibraryStore((state) => state.sync.apiBase);
  const me = useCommunityStore((state) => state.me);
  const loadMe = useCommunityStore((state) => state.loadMe);
  const live = FEATURES.community && Boolean(apiBase);

  useEffect(() => {
    if (live && signedIn && !me) {
      void loadMe();
    }
  }, [live, signedIn, me, loadMe]);

  if (!live) {
    return (
      <section className="paper-surface rounded-xl p-6">
        <SectionHeader eyebrow="Friends" title={FEATURES.community ? "Not connected" : "Coming soon"} />
        <p className="mt-3 max-w-prose text-sm leading-6 text-on-surface-variant">{FEATURES.community ? COPY.notConnected : COPY.comingSoon}</p>
      </section>
    );
  }
  if (!signedIn) {
    return (
      <section className="paper-surface flex flex-wrap items-center gap-5 rounded-xl p-6">
        <PipSprite move="welcome" size={64} still />
        <div className="min-w-0 flex-1">
          <SectionHeader eyebrow="Friends" title={COPY.signInTitle} />
          <p className="mt-2 max-w-prose text-sm leading-6 text-on-surface-variant">{COPY.signIn}</p>
        </div>
        <button type="button" className="tactile-button tactile-button-primary px-4 py-2 text-xs" onClick={() => onNavigate("settings")}>
          Sign in
        </button>
      </section>
    );
  }
  if (me && (me.visibility === "private" || !me.handle)) {
    return <ShareFirst handle={me.handle} showToast={showToast} />;
  }

  // Finding a reader to follow, and the requests to follow you, first: this is where they are looked for. (They are
  // under Board as well, where they were before there was a Friends tab, and the owner found no way to send one.)
  return (
    <>
      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <ReaderSearch showToast={showToast} />
        <Inbox showToast={showToast} />
      </div>
      <FeedCard showToast={showToast} />
      <FriendsBooksCard />
      <ClubsCard showToast={showToast} />
    </>
  );
};
