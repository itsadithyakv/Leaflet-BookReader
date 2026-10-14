import { useEffect, useMemo, useRef, useState } from "react";
import { EyeOff, Flag, Globe2, Quote, Star, Trash2, Users } from "lucide-react";
import { friendsService, type BookPost } from "../../services/friendsService";
import { discussService, type Audience, type NewPost } from "../../services/discussService";
import { useLibraryStore } from "../../store/libraryStore";
import { askConfirm } from "../ConfirmDialog";
import { useDiscussStore } from "../discuss/discussStore";
import { Reactions } from "../discuss/Reactions";
import { useCommunityStore } from "./communityStore";
import { BookChooser } from "./BookChooser";
import { PipAvatar } from "./PipAvatar";
import { usePostStore } from "./postStore";
import { at, errorText, nameOf, relativeTime } from "./format";
import "./friends.css";

/** The server's limits, counted here so nothing typed is cut off there. */
const LINE_MAX = 280;
const REVIEW_MAX = 3000;
const QUOTE_MAX = 500;
/** A review longer than this is folded, with "More". */
const FOLD_AT = 420;

export const Stars = ({ rating, size = 13 }: { rating: number; size?: number }) => (
  <span className="rating-stars" role="img" aria-label={`${rating} out of 5`}>
    {[1, 2, 3, 4, 5].map((star) => (
      <Star key={star} size={size} className={star <= rating ? undefined : "is-off"} fill={star <= rating ? "currentColor" : "none"} aria-hidden />
    ))}
  </span>
);

const VERB: Record<NonNullable<BookPost["kind"]>, string> = { finished: "finished", review: "reviewed", quote: "quoted" };

type CardProps = {
  post: BookPost;
  showToast: (message: string) => void;
  onRemoved?: (id: string) => void;
};

/**
 * One post: who, which book (which opens what else was said of it), and
 * what they said: a finished book's stars and line, a review, or a quote.
 * A post its writer marked as a spoiler is covered until asked for. Under
 * it, like and dislike, and for anyone else's post a way to report it.
 */
export const PostCard = ({ post, showToast, onRemoved }: CardProps) => {
  const openReader = useCommunityStore((state) => state.openReader);
  const openBook = useDiscussStore((state) => state.openBook);
  const report = useDiscussStore((state) => state.report);
  const kind = post.kind ?? "finished";
  const [uncovered, setUncovered] = useState(false);
  const [whole, setWhole] = useState(false);
  const covered = Boolean(post.spoiler) && !uncovered && !post.isYou;
  const body = post.body ?? "";
  const folded = !whole && body.length > FOLD_AT;

  const remove = async () => {
    const ok = await askConfirm({ title: "Remove this post?", body: `“${post.title}” leaves the feeds it is in.`, confirmLabel: "Remove", danger: true });
    if (!ok) {
      return;
    }
    try {
      await friendsService.deletePost(post.id);
      onRemoved?.(post.id);
      usePostStore.getState().noteChanged();
    } catch (cause) {
      showToast(errorText(cause));
    }
  };

  return (
    <li className="flex gap-3">
      <button type="button" className="shrink-0 self-start" onClick={() => openReader(post.person.handle)} aria-label={`Open ${at(post.person.handle)}`}>
        <PipAvatar seed={post.person.pipSeed} avatar={post.person.avatar} size={36} />
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-on-surface [overflow-wrap:anywhere]">
          <span className="font-semibold">{post.isYou ? "You" : nameOf(post.person)}</span> {VERB[kind]}{" "}
          <button
            type="button"
            className="font-semibold hover:underline"
            title="What readers said of this book"
            onClick={() => openBook({ title: post.title, author: post.author, key: post.bookKey ?? null })}
          >
            {post.title}
          </button>
          {post.author && <span className="text-on-surface-variant"> by {post.author}</span>}
        </p>
        {post.rating !== null && post.rating !== undefined && (
          <p className="mt-0.5">
            <Stars rating={post.rating} />
          </p>
        )}

        {covered ? (
          <button type="button" className="mt-1.5 flex items-center gap-1.5 rounded-lg bg-surface-container-high px-3 py-2 text-xs text-on-surface-variant hover:text-on-surface" onClick={() => setUncovered(true)}>
            <EyeOff size={13} aria-hidden /> Spoilers. Show anyway
          </button>
        ) : (
          <>
            {kind === "finished" && post.line && <p className="mt-1 text-sm leading-5 text-on-surface-variant [overflow-wrap:anywhere]">{post.line}</p>}
            {kind === "review" && body && (
              <p className="mt-1 whitespace-pre-line text-sm leading-6 text-on-surface [overflow-wrap:anywhere]">
                {folded ? `${body.slice(0, FOLD_AT).trimEnd()}…` : body}
                {folded && (
                  <button type="button" className="ml-1 text-xs font-semibold text-primary hover:underline" onClick={() => setWhole(true)}>
                    More
                  </button>
                )}
              </p>
            )}
            {kind === "quote" && post.quote && (
              <blockquote className="post-quote mt-1.5">
                <Quote size={14} className="post-quote-mark" aria-hidden />
                <p className="whitespace-pre-line [overflow-wrap:anywhere]">{post.quote}</p>
              </blockquote>
            )}
            {kind === "quote" && post.note && <p className="mt-1.5 text-sm leading-5 text-on-surface-variant [overflow-wrap:anywhere]">{post.note}</p>}
          </>
        )}

        {post.hidden && <p className="mt-1.5 text-[11px] text-error">Hidden from other readers while reports on it are looked at.</p>}

        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-on-surface-variant">
          {post.likes !== undefined && (
            <Reactions target="post" id={post.id} likes={post.likes ?? 0} dislikes={post.dislikes ?? 0} mine={post.myReaction ?? 0} own={post.isYou} showToast={showToast} />
          )}
          <span>{relativeTime(post.createdAt)}</span>
          {post.isYou && post.audience && (
            <span className="flex items-center gap-1" title={post.audience === "everyone" ? "Anyone on Leaflet can read this" : "Only the readers who follow you can read this"}>
              {post.audience === "everyone" ? <Globe2 size={11} aria-hidden /> : <Users size={11} aria-hidden />}
              {post.audience === "everyone" ? "Everyone" : "Followers"}
            </span>
          )}
          {post.isYou ? (
            <button type="button" className="flex items-center gap-1 hover:text-error" onClick={() => void remove()} aria-label={`Remove your post about ${post.title}`}>
              <Trash2 size={11} aria-hidden /> Remove
            </button>
          ) : (
            <button
              type="button"
              className="flex items-center gap-1 hover:text-on-surface"
              onClick={() => report({ target: "post", id: post.id, what: "this post" })}
              aria-label={`Report this post by ${at(post.person.handle)}`}
            >
              <Flag size={11} aria-hidden /> Report
            </button>
          )}
        </p>
      </div>
    </li>
  );
};

/** Posts as a list. */
export const PostList = ({ posts, showToast, onRemoved }: { posts: BookPost[]; showToast: (message: string) => void; onRemoved?: (id: string) => void }) => (
  <ul className="flex flex-col gap-4">
    {posts.map((post) => (
      <PostCard key={post.id} post={post} showToast={showToast} onRemoved={onRemoved} />
    ))}
  </ul>
);

type Kind = "finished" | "review" | "quote";


/**
 * Saying something about a book: that it is finished (stars and a line), a
 * review, or a quote. To the readers who follow you unless "Everyone" is
 * chosen, which asks for the guidelines the first time. Opened on a book
 * (its menu, a highlight) or on none, where one of the library's books is
 * picked. Mounted once (`postStore`).
 */
export const PostDialog = ({ showToast }: { showToast: (message: string) => void }) => {
  const open = usePostStore((state) => state.open);
  const close = usePostStore((state) => state.close);
  const books = useLibraryStore((state) => state.books);
  const ensureRules = useDiscussStore((state) => state.ensureRules);
  const choices = useMemo(
    () =>
      books
        // Begun or finished: a book not opened has nothing to be said of it yet.
        .filter((book) => (book.progress ?? 0) > 0 || Boolean(book.finishedAt))
        // The one read most lately first: it is most likely the one to say something about, and it is chosen to begin with.
        .sort((a, b) => (b.lastOpened ?? b.finishedAt ?? "").localeCompare(a.lastOpened ?? a.finishedAt ?? "") || a.title.localeCompare(b.title))
        .map((book) => ({ title: book.title, author: book.author ?? null })),
    [books]
  );
  const [kind, setKind] = useState<Kind>("finished");
  const [picked, setPicked] = useState(0);
  const [rating, setRating] = useState<number | null>(null);
  const [words, setWords] = useState("");
  const [quote, setQuote] = useState("");
  const [audience, setAudience] = useState<Audience>("followers");
  const [spoiler, setSpoiler] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setKind(open.kind ?? "finished");
    setPicked(0);
    setRating(null);
    setWords("");
    setQuote((open.quote ?? "").slice(0, QUOTE_MAX));
    setAudience("followers");
    setSpoiler(false);
    setError(null);
    field.current?.focus();
    // Capture phase, so the reader's own Escape (close the book) never sees it.
    const onKey = (event: KeyboardEvent) => {
      // Not while the guidelines are up over it: that Escape is theirs.
      // Nor while the book field is open: its Escape puts the field away (`BookChooser`).
      const chooser = (document.activeElement as HTMLElement | null)?.dataset?.chooser === "open";
      if (event.key === "Escape" && !useDiscussStore.getState().rulesAsked && !chooser) {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, close]);

  if (!open) {
    return null;
  }
  const book = open.book ?? choices[picked] ?? null;
  // One form, not three tabs (the owner, 2026-10-14: "review, quote etc does not make a whole lot of sense, it can
  // get confusing"). What is posted follows from what is written: a quote when it was opened on one (a highlight),
  // a review when more than a line is written, and otherwise the book with its stars and a line.
  const quoting = kind === "quote";
  const posting: Kind = quoting ? "quote" : words.trim().length > LINE_MAX ? "review" : "finished";
  const wordsMax = quoting ? LINE_MAX : REVIEW_MAX;
  // A review needs its stars; nothing else does.
  const needsStars = posting === "review" && rating === null;
  const ready = Boolean(book) && (posting === "finished" || (posting === "review" && !needsStars) || (posting === "quote" && quote.trim().length > 0));

  const send = async () => {
    if (!book || !ready) {
      return;
    }
    setError(null);
    // For everyone to read: the guidelines first, once.
    if (audience === "everyone" && !(await ensureRules())) {
      return;
    }
    const about = { title: book.title, author: book.author, audience };
    const post: NewPost =
      posting === "review"
        ? { kind: posting, ...about, rating: rating as number, body: words.trim(), spoiler }
        : posting === "quote"
          ? { kind: posting, ...about, quote: quote.trim(), note: words.trim() || null, spoiler }
          : { kind: posting, ...about, rating, line: words.trim() || null };
    setBusy(true);
    discussService
      .post(post)
      .then(() => {
        usePostStore.getState().noteChanged();
        close();
        showToast(audience === "everyone" ? "Posted for everyone to read." : "Posted to the readers who follow you.");
      })
      .catch((cause) => setError(errorText(cause)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 px-4 py-6" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <div className="modal-surface dialog-fit flex max-h-full w-full max-w-lg flex-col overflow-y-auto p-6" role="dialog" aria-modal="true" aria-labelledby="post-dialog-title">
        <h2 id="post-dialog-title" className="page-title text-2xl">
          {quoting ? "Share a quote" : "Share a book"}
        </h2>

        {open.book ? (
          <p className="mt-3 text-sm text-on-surface [overflow-wrap:anywhere]">
            <span className="font-semibold">{open.book.title}</span>
            {open.book.author && <span className="text-on-surface-variant"> by {open.book.author}</span>}
          </p>
        ) : choices.length === 0 ? (
          <p className="mt-3 text-sm text-on-surface-variant">Start a book and it can be talked about here.</p>
        ) : (
          <BookChooser choices={choices} picked={picked} onPick={setPicked} />
        )}

        {!quoting && (
          <div className="rating-pick mt-4 flex items-center gap-1" role="radiogroup" aria-label="Your rating">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                role="radio"
                aria-checked={rating === star}
                aria-label={`${star} out of 5`}
                className="rating-stars"
                // The same star again takes the rating away.
                onClick={() => setRating(rating === star ? null : star)}
              >
                <Star size={24} className={rating !== null && star <= rating ? undefined : "is-off"} fill={rating !== null && star <= rating ? "currentColor" : "none"} aria-hidden />
              </button>
            ))}
          </div>
        )}

        {quoting && (
          <>
            <textarea
              className="inset-field mt-4 w-full resize-none px-3 py-2 font-serif text-sm text-on-surface"
              rows={4}
              maxLength={QUOTE_MAX}
              placeholder="The lines you want to quote"
              aria-label="The quote"
              value={quote}
              onChange={(event) => setQuote(event.target.value)}
            />
            {quote.length > QUOTE_MAX - 60 && <p className="mt-1 text-right text-[11px] tabular-nums text-on-surface-variant">{QUOTE_MAX - quote.length}</p>}
          </>
        )}

        <textarea
          ref={field}
          className="inset-field mt-3 w-full resize-none px-3 py-2 text-sm text-on-surface"
          rows={quoting ? 3 : 5}
          maxLength={wordsMax}
          placeholder={quoting ? "Why this one (optional)" : "What did you think? (optional)"}
          aria-label={quoting ? "Why this one" : "What you thought of it"}
          value={words}
          onChange={(event) => setWords(event.target.value)}
        />
        {words.length > wordsMax - 60 && <p className="mt-1 text-right text-[11px] tabular-nums text-on-surface-variant">{wordsMax - words.length}</p>}
        {needsStars && <p className="mt-1 text-[11px] text-on-surface-variant">Give it stars to post more than a line.</p>}

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-on-surface">
          <label className="flex items-center gap-1.5" title="Followers: the readers who follow you. Everyone: any reader, on Discover and on the book's page.">
            For
            <select className="inset-field px-2 py-1 text-xs text-on-surface" value={audience} onChange={(event) => setAudience(event.target.value as Audience)}>
              <option value="followers">My followers</option>
              <option value="everyone">Everyone</option>
            </select>
          </label>
          {posting !== "finished" && (
            <label className="flex cursor-pointer items-center gap-1.5" title="It is covered until a reader asks to see it">
              <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--color-primary))]" checked={spoiler} onChange={(event) => setSpoiler(event.target.checked)} />
              Gives the book away
            </label>
          )}
        </div>

        {error && <p className="mt-3 rounded-lg bg-error-container/40 px-3 py-2 text-xs text-on-surface">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="tactile-button px-4 py-2 text-xs" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="tactile-button tactile-button-primary px-4 py-2 text-xs font-semibold disabled:opacity-60" onClick={() => void send()} disabled={busy || !ready}>
            {busy ? "Posting…" : "Post"}
          </button>
        </div>
      </div>
    </div>
  );
};
