import { useCallback, useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import type { BookPost } from "../../services/friendsService";
import { discussService } from "../../services/discussService";
import { PipSprite } from "../PipSprite";
import { SectionHeader } from "../ui/SectionHeader";
import { ErrorLine } from "../community/ErrorLine";
import { errorText } from "../community/format";
import { PostList, Stars } from "../community/Posts";
import { composePost, usePostStore } from "../community/postStore";
import { useDiscussStore } from "./discussStore";

type Toast = (message: string) => void;
type Sort = "new" | "top";

/**
 * What readers anywhere posted for everyone to read: reviews, quotes and
 * finished books, the newest or the best liked of the last month. A place to
 * find the next book. Only what its writer chose to show everyone is here.
 */
export const DiscoverFeed = ({ showToast }: { showToast: Toast }) => {
  const changed = usePostStore((state) => state.changed);
  const [sort, setSort] = useState<Sort>("new");
  const [posts, setPosts] = useState<BookPost[] | null>(null);
  const [more, setMore] = useState(false);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Counts up to ask again after a failure.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setPosts(null);
    discussService
      .discover(sort)
      .then((answer) => {
        if (live) {
          setPosts(answer.posts);
          setMore(answer.more);
          setNext(answer.next ?? null);
          setError(null);
        }
      })
      .catch((cause) => live && setError(errorText(cause)));
    return () => {
      live = false;
    };
  }, [sort, changed, attempt]);

  const older = () => {
    if (!posts || posts.length === 0) {
      return;
    }
    setBusy(true);
    discussService
      .discover(sort, sort === "new" ? { cursor: next } : { skip: posts.length })
      .then((answer) => {
        setNext(answer.next ?? null);
        // A post that moved up the list while it was being read is not shown twice.
        setPosts((current) => {
          const have = new Set((current ?? []).map((post) => post.id));
          return [...(current ?? []), ...answer.posts.filter((post) => !have.has(post.id))];
        });
        setMore(answer.more);
      })
      .catch((cause) => showToast(errorText(cause)))
      .finally(() => setBusy(false));
  };

  return (
    <section className="paper-surface rounded-xl p-4 sm:p-6" aria-labelledby="discover-title">
      <SectionHeader
        eyebrow="From readers everywhere"
        title="Discover"
        id="discover-title"
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <span className="flex" role="group" aria-label="Order">
              {(["new", "top"] as Sort[]).map((entry, index) => (
                <button
                  key={entry}
                  type="button"
                  aria-pressed={sort === entry}
                  className={`tactile-button px-3 py-1.5 text-xs ${sort === entry ? "tactile-button-primary" : ""} ${index === 0 ? "rounded-r-none" : "rounded-l-none"}`}
                  title={entry === "new" ? "The newest first" : "The best liked of the last month"}
                  onClick={() => setSort(entry)}
                >
                  {entry === "new" ? "New" : "Top"}
                </button>
              ))}
            </span>
            <button type="button" className="tactile-button tactile-button-primary flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold" onClick={() => composePost(null, { kind: "review" })}>
              <Plus size={13} aria-hidden /> Write a review
            </button>
          </span>
        }
      />
      {error ? (
        <ErrorLine message={error} onRetry={() => (setError(null), setAttempt((count) => count + 1))} />
      ) : posts === null ? (
        <p className="mt-4 text-sm text-on-surface-variant">Looking…</p>
      ) : posts.length === 0 ? (
        <div className="mt-2 flex items-center gap-4 py-3">
          <PipSprite move="read" size={48} still />
          <p className="text-sm text-on-surface-variant">Nothing here yet. A review or a quote posted for everyone shows up here.</p>
        </div>
      ) : (
        <div className="mt-4">
          <PostList posts={posts} showToast={showToast} onRemoved={(id) => setPosts((current) => (current ?? []).filter((post) => post.id !== id))} />
          {more && (
            <button type="button" className="tactile-button mt-5 px-4 py-2 text-xs disabled:opacity-60" onClick={older} disabled={busy}>
              {busy ? "…" : "More"}
            </button>
          )}
        </div>
      )}
    </section>
  );
};

/**
 * What has been said of one book, opened from a post's title: how its
 * reviews average, the posts themselves, and its community if there is one
 * (or a way to start it). A drawer from the right, like a reader's card.
 */
export const BookPostsDrawer = ({ showToast, onOpenCommunity }: { showToast: Toast; onOpenCommunity: (id: string) => void }) => {
  const book = useDiscussStore((state) => state.book);
  const close = useDiscussStore((state) => state.closeBook);
  const ensureRules = useDiscussStore((state) => state.ensureRules);
  const [posts, setPosts] = useState<BookPost[] | null>(null);
  const [more, setMore] = useState(false);
  const [summary, setSummary] = useState<{ reviews: number; average: number | null } | null>(null);
  const [community, setCommunity] = useState<{ id: string; memberCount: number; isMember: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // Counts up to ask again after a failure.
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(() => {
    if (!book) {
      return () => undefined;
    }
    let live = true;
    setPosts(null);
    setMore(false);
    setSummary(null);
    setCommunity(null);
    setError(null);
    discussService
      .bookPosts(book)
      .then((answer) => {
        if (live) {
          setPosts(answer.posts);
          setMore(answer.more);
          setSummary(answer.summary);
        }
      })
      .catch((cause) => live && setError(errorText(cause)));
    void discussService.findCommunity({ kind: "book", key: book.key ?? null, title: book.title, author: book.author }).then((found) => live && setCommunity(found));
    return () => {
      live = false;
    };
    // `attempt` is here to ask again: nothing in the request reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, attempt]);
  useEffect(load, [load]);

  // The page before the oldest post shown, for the book that is open now.
  const older = () => {
    const last = posts?.[posts.length - 1];
    if (!book || !last) {
      return;
    }
    const asked = book;
    setLoadingOlder(true);
    discussService
      .bookPosts(book, last.createdAt)
      .then((answer) => {
        if (useDiscussStore.getState().book !== asked) {
          return;
        }
        setPosts((current) => {
          const have = new Set((current ?? []).map((post) => post.id));
          return [...(current ?? []), ...answer.posts.filter((post) => !have.has(post.id))];
        });
        setMore(answer.more);
      })
      .catch((cause) => showToast(errorText(cause)))
      .finally(() => setLoadingOlder(false));
  };

  useEffect(() => {
    if (!book) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !useDiscussStore.getState().rulesAsked && !useDiscussStore.getState().reporting) {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [book, close]);

  if (!book) {
    return null;
  }

  const openCommunity = async () => {
    if (community?.isMember) {
      close();
      onOpenCommunity(community.id);
      return;
    }
    if (!(await ensureRules())) {
      return;
    }
    setBusy(true);
    discussService
      .openCommunity({ kind: "book", key: book.key ?? null, title: book.title, author: book.author })
      .then((opened) => {
        close();
        onOpenCommunity(opened.id);
      })
      .catch((cause) => showToast(errorText(cause)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="fixed inset-0 z-[72] flex justify-end" role="dialog" aria-modal="true" aria-label={`What readers said of ${book.title}`}>
      <button type="button" tabIndex={-1} className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" aria-label="Close" onClick={close} />
      <aside className="paper-surface relative flex h-full w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-none p-6 shadow-2xl sm:rounded-l-2xl">
        <button type="button" onClick={close} className="absolute right-4 top-4 rounded-full p-1.5 text-on-surface-variant hover:bg-surface-container-high" aria-label="Close">
          <X size={18} />
        </button>
        <div className="pr-8">
          <p className="font-headline text-2xl font-bold text-on-surface [overflow-wrap:anywhere]">{book.title}</p>
          {book.author && <p className="text-sm text-on-surface-variant">{book.author}</p>}
          {summary && summary.average !== null && (
            <p className="mt-2 flex items-center gap-2 text-sm text-on-surface">
              <Stars rating={Math.round(summary.average)} size={15} />
              <span className="tabular-nums">
                {summary.average.toFixed(1)} · {summary.reviews} {summary.reviews === 1 ? "review" : "reviews"}
              </span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="tactile-button tactile-button-primary px-3 py-1.5 text-xs font-semibold" onClick={() => composePost({ title: book.title, author: book.author }, { kind: "review" })}>
            Review it
          </button>
          <button type="button" className="tactile-button px-3 py-1.5 text-xs disabled:opacity-60" disabled={busy} onClick={() => void openCommunity()}>
            {busy
              ? "…"
              : community
                ? community.isMember
                  ? "Open its community"
                  : `Join its community (${community.memberCount})`
                : "Start its community"}
          </button>
        </div>
        {error ? (
          <ErrorLine message={error} className="" onRetry={() => setAttempt((count) => count + 1)} />
        ) : posts === null ? (
          <p className="text-sm text-on-surface-variant">Looking…</p>
        ) : posts.length === 0 ? (
          <p className="text-sm text-on-surface-variant">Nobody has posted about it yet.</p>
        ) : (
          <>
            <PostList posts={posts} showToast={showToast} onRemoved={(id) => setPosts((current) => (current ?? []).filter((post) => post.id !== id))} />
            {more && (
              <button type="button" className="tactile-button self-start px-4 py-2 text-xs disabled:opacity-60" onClick={older} disabled={loadingOlder}>
                {loadingOlder ? "…" : "Older"}
              </button>
            )}
          </>
        )}
      </aside>
    </div>
  );
};
