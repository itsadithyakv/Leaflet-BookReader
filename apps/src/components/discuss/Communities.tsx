import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, EyeOff, Flag, MessageSquare, Pin, Trash2, UserMinus } from "lucide-react";
import { discussService, type BookCommunity, type CommunityChange, type Reply, type Spoiler, type Thread } from "../../services/discussService";
import { isFinished } from "../../constants/books";
import { useLibrarySeries } from "../../library/useSeries";
import { useLibraryStore } from "../../store/libraryStore";
import { askConfirm } from "../ConfirmDialog";
import { SectionHeader } from "../ui/SectionHeader";
import { useCommunityStore } from "../community/communityStore";
import { ErrorLine } from "../community/ErrorLine";
import { at, errorText, nameOf, relativeTime } from "../community/format";
import { PipAvatar } from "../community/PipAvatar";
import { useDiscussStore } from "./discussStore";
import { pushBackLayer } from "../../platform/back";
import { Reactions } from "./Reactions";
import { bookPlace, bookSpoilerChoices, isPast, seriesPlace, seriesSpoilerChoices, spoilerText, type BookPlace, type SeriesPlace } from "./spoilers";

type Toast = (message: string) => void;

const THREAD_TITLE_MAX = 120;
const THREAD_BODY_MAX = 5000;
const REPLY_MAX = 3000;

const members = (count: number) => `${count} ${count === 1 ? "member" : "members"}`;

/** Where this reader is in the book or series a community is about, from their own library. */
const usePlace = (community: Pick<BookCommunity, "kind" | "key"> | null): { place: BookPlace | SeriesPlace; books: number } => {
  const books = useLibraryStore((state) => state.books);
  const keys = useDiscussStore((state) => state.keys);
  const loadKeys = useDiscussStore((state) => state.loadKeys);
  const series = useLibrarySeries();
  useEffect(() => {
    if (!keys) {
      void loadKeys();
    }
  }, [keys, loadKeys]);
  return useMemo(() => {
    if (!community) {
      return { place: null, books: 0 };
    }
    if (community.kind === "series") {
      const group = series.groups.find((entry) => entry.key === community.key);
      return {
        place: seriesPlace((group?.members ?? []).filter((member) => !member.extra).map((member) => ({ index: member.index, finished: isFinished(member.book.progress) || Boolean(member.book.finishedAt) }))),
        books: group?.total ?? group?.ownedCount ?? 0
      };
    }
    return { place: bookPlace(books.filter((book) => keys?.[book.id] === community.key)), books: 0 };
  }, [community, books, keys, series.groups]);
};

// ---- a thread ------------------------------------------------------------------

const ReplyRow = ({
  reply,
  showToast,
  onRemoved,
  onRemoveMember
}: {
  reply: Reply;
  showToast: Toast;
  onRemoved: (id: string) => void;
  /** Given when the reader may take this reply's writer out of the community. */
  onRemoveMember?: (handle: string) => void;
}) => {
  const openReader = useCommunityStore((state) => state.openReader);
  const report = useDiscussStore((state) => state.report);
  const remove = async () => {
    if (!(await askConfirm({ title: "Remove this reply?", confirmLabel: "Remove", danger: true }))) {
      return;
    }
    discussService
      .deleteReply(reply.id)
      .then(() => onRemoved(reply.id))
      .catch((cause) => showToast(errorText(cause)));
  };
  return (
    <li className="flex gap-3">
      {reply.author ? (
        <button type="button" className="shrink-0 self-start" onClick={() => openReader(reply.author!.handle)} aria-label={`Open ${at(reply.author.handle)}`}>
          <PipAvatar seed={reply.author.pipSeed} avatar={reply.author.avatar} size={30} />
        </button>
      ) : (
        <span className="h-[30px] w-[30px] shrink-0 rounded-full bg-surface-container-high" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs text-on-surface-variant">
          <span className="font-semibold text-on-surface">{reply.isYou ? "You" : reply.author ? nameOf(reply.author) : "A reader who left"}</span> · {relativeTime(reply.createdAt)}
        </p>
        <p className="mt-0.5 whitespace-pre-line text-sm leading-6 text-on-surface [overflow-wrap:anywhere]">{reply.body}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-on-surface-variant">
          <Reactions target="reply" id={reply.id} likes={reply.likes} dislikes={reply.dislikes} mine={reply.myReaction} own={reply.isYou} showToast={showToast} />
          {reply.canRemove && (
            <button type="button" className="touch-hit flex items-center gap-1 hover:text-error" onClick={() => void remove()}>
              <Trash2 size={11} aria-hidden /> Remove
            </button>
          )}
          {onRemoveMember && reply.author && !reply.isYou && (
            <button type="button" className="touch-hit flex items-center gap-1 hover:text-error" onClick={() => onRemoveMember(reply.author!.handle)}>
              <UserMinus size={11} aria-hidden /> Remove from community
            </button>
          )}
          {!reply.isYou && (
            <button type="button" className="touch-hit flex items-center gap-1 hover:text-on-surface" onClick={() => report({ target: "reply", id: reply.id, what: "this reply" })}>
              <Flag size={11} aria-hidden /> Report
            </button>
          )}
        </p>
      </div>
    </li>
  );
};

const ThreadView = ({ id, showToast }: { id: string; showToast: Toast }) => {
  const go = useDiscussStore((state) => state.go);
  const report = useDiscussStore((state) => state.report);
  const ensureRules = useDiscussStore((state) => state.ensureRules);
  const openReader = useCommunityStore((state) => state.openReader);
  const isAdmin = useCommunityStore((state) => Boolean(state.me?.isAdmin));
  const [thread, setThread] = useState<Thread | null>(null);
  const [community, setCommunity] = useState<BookCommunity | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [words, setWords] = useState("");
  const [busy, setBusy] = useState(false);
  // Counts up to ask again after a failure.
  const [attempt, setAttempt] = useState(0);
  // The readers taken out of the community from this page: nothing left to press beside them.
  const [removed, setRemoved] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    setThread(null);
    setError(null);
    discussService
      .thread(id)
      .then((answer) => {
        if (live) {
          setThread(answer.thread);
          setCommunity(answer.community);
          setReplies(answer.replies);
          setMore(answer.more);
        }
      })
      .catch((cause) => live && setError(errorText(cause)));
    return () => {
      live = false;
    };
  }, [id, attempt]);

  const back = () => go(community ? { at: "community", id: community.id } : { at: "list" });

  const later = () => {
    const last = replies[replies.length - 1];
    if (!last) {
      return;
    }
    setBusy(true);
    discussService
      .thread(id, last.createdAt)
      .then((answer) => {
        const have = new Set(replies.map((reply) => reply.id));
        setReplies((current) => [...current, ...answer.replies.filter((reply) => !have.has(reply.id))]);
        setMore(answer.more);
      })
      .catch((cause) => showToast(errorText(cause)))
      .finally(() => setBusy(false));
  };

  const send = async () => {
    const body = words.trim();
    if (!body || !(await ensureRules())) {
      return;
    }
    setBusy(true);
    discussService
      .reply(id, body)
      .then((reply) => {
        setReplies((current) => [...current, reply]);
        setWords("");
      })
      .catch((cause) => showToast(errorText(cause)))
      .finally(() => setBusy(false));
  };

  const remove = async () => {
    if (!thread || !(await askConfirm({ title: "Remove this thread?", body: "Its replies go with it.", confirmLabel: "Remove", danger: true }))) {
      return;
    }
    discussService
      .deleteThread(thread.id)
      .then(back)
      .catch((cause) => showToast(errorText(cause)));
  };

  // The keeper's (and the owner's) to do: out of the community, and not let back in.
  const mayRemoveMembers = Boolean(community && (community.isKeeper || isAdmin));
  const removeMember = async (handle: string) => {
    if (!community || !(await askConfirm({ title: `Remove ${at(handle)} from “${community.title}”?`, body: "They cannot join it again. What they wrote stays.", confirmLabel: "Remove", danger: true }))) {
      return;
    }
    discussService
      .removeMember(community.id, handle)
      .then(() => {
        setRemoved((current) => [...current, handle]);
        showToast(`${at(handle)} is removed from the community.`);
      })
      .catch((cause) => showToast(errorText(cause)));
  };
  const removable = (handle: string | undefined) => mayRemoveMembers && Boolean(handle) && !removed.includes(handle!);

  return (
    <section className="paper-surface rounded-xl p-4 sm:p-6">
      <button type="button" className="touch-hit flex items-center gap-1.5 py-1 text-xs font-semibold text-on-surface-variant hover:text-on-surface" onClick={back}>
        <ArrowLeft size={14} aria-hidden /> {community ? community.title : "Communities"}
      </button>
      {error ? (
        <ErrorLine message={error} onRetry={() => setAttempt((count) => count + 1)} />
      ) : !thread ? (
        <p className="mt-4 text-sm text-on-surface-variant">Opening…</p>
      ) : (
        <>
          <h2 className="page-title mt-3 text-2xl [overflow-wrap:anywhere]">{thread.title}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-on-surface-variant">
            {thread.author ? (
              <button type="button" className="flex items-center gap-1.5 hover:text-on-surface" onClick={() => openReader(thread.author!.handle)}>
                <PipAvatar seed={thread.author.pipSeed} avatar={thread.author.avatar} size={20} />
                {thread.isYou ? "You" : nameOf(thread.author)}
              </button>
            ) : (
              <span>A reader who left</span>
            )}
            <span>· {relativeTime(thread.createdAt)}</span>
            {spoilerText(thread.spoiler) && <span className="state-chip">{spoilerText(thread.spoiler)}</span>}
          </p>
          <p className="mt-4 whitespace-pre-line text-sm leading-6 text-on-surface [overflow-wrap:anywhere]">{thread.body}</p>
          <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-on-surface-variant">
            <Reactions target="thread" id={thread.id} likes={thread.likes} dislikes={thread.dislikes} mine={thread.myReaction} own={thread.isYou} showToast={showToast} />
            {thread.canRemove && (
              <button type="button" className="touch-hit flex items-center gap-1 hover:text-error" onClick={() => void remove()}>
                <Trash2 size={11} aria-hidden /> Remove
              </button>
            )}
            {thread.author && !thread.isYou && removable(thread.author.handle) && (
              <button type="button" className="touch-hit flex items-center gap-1 hover:text-error" onClick={() => void removeMember(thread.author!.handle)}>
                <UserMinus size={11} aria-hidden /> Remove from community
              </button>
            )}
            {!thread.isYou && (
              <button type="button" className="touch-hit flex items-center gap-1 hover:text-on-surface" onClick={() => report({ target: "thread", id: thread.id, what: "this thread" })}>
                <Flag size={11} aria-hidden /> Report
              </button>
            )}
          </p>

          <div className="mt-5 border-t border-outline-variant/30 pt-4">
            {replies.length > 0 && (
              <ul className="flex flex-col gap-4">
                {replies.map((reply) => (
                  <ReplyRow
                    key={reply.id}
                    reply={reply}
                    showToast={showToast}
                    onRemoved={(gone) => setReplies((current) => current.filter((entry) => entry.id !== gone))}
                    onRemoveMember={removable(reply.author?.handle) ? (handle) => void removeMember(handle) : undefined}
                  />
                ))}
              </ul>
            )}
            {more && (
              <button type="button" className="tactile-button mt-4 px-4 py-2 text-xs disabled:opacity-60" onClick={later} disabled={busy}>
                {busy ? "…" : "More replies"}
              </button>
            )}
            {community?.isMember ? (
              <form
                className="mt-4 flex flex-col gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
              >
                <textarea
                  className="inset-field w-full resize-none px-3 py-2 text-sm text-on-surface"
                  rows={3}
                  maxLength={REPLY_MAX}
                  placeholder="Reply"
                  aria-label="Your reply"
                  value={words}
                  onChange={(event) => setWords(event.target.value)}
                />
                <button type="submit" className="tactile-button tactile-button-primary self-end px-4 py-2 text-xs font-semibold disabled:opacity-60" disabled={busy || words.trim().length === 0}>
                  Reply
                </button>
              </form>
            ) : (
              <p className="mt-4 text-xs text-on-surface-variant">Join the community to reply.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
};

// ---- a community -----------------------------------------------------------------

const ThreadRow = ({
  thread,
  past,
  canPin,
  showToast,
  onChanged
}: {
  thread: Thread;
  past: boolean;
  /** The community's keeper, or the owner: the server takes a pin from either. */
  canPin: boolean;
  showToast: Toast;
  onChanged: () => void;
}) => {
  const go = useDiscussStore((state) => state.go);
  const [uncovered, setUncovered] = useState(false);
  const covered = past && !uncovered && !thread.isYou;
  const pin = () =>
    discussService
      .pinThread(thread.id, !thread.pinned)
      .then(onChanged)
      .catch((cause) => showToast(errorText(cause)));
  return (
    <li className="rounded-xl border border-outline-variant/25 bg-surface-container/40 p-3">
      {covered ? (
        <button type="button" className="flex w-full items-center gap-2 text-left text-sm text-on-surface-variant hover:text-on-surface" onClick={() => setUncovered(true)}>
          <EyeOff size={15} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Past where you are</span>
            <span className="block text-xs">{spoilerText(thread.spoiler)}. Show anyway</span>
          </span>
        </button>
      ) : (
        <>
          <button type="button" className="block w-full text-left" onClick={() => go({ at: "thread", id: thread.id, communityId: null })}>
            <span className="flex items-start gap-2">
              {thread.pinned && <Pin size={13} className="mt-1 shrink-0 text-primary" aria-label="Pinned" />}
              {/* A marked thread's title is kept back by the server too: opening it is the reader's choice. */}
              <span className={`min-w-0 flex-1 font-semibold [overflow-wrap:anywhere] hover:underline ${thread.title ? "text-on-surface" : "italic text-on-surface-variant"}`}>
                {thread.title ?? "A thread with spoilers"}
              </span>
            </span>
            {thread.excerpt && <span className="mt-1 line-clamp-2 block text-sm text-on-surface-variant [overflow-wrap:anywhere]">{thread.excerpt}</span>}
          </button>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-on-surface-variant">
            <span>{thread.isYou ? "You" : thread.author ? nameOf(thread.author) : "A reader who left"}</span>
            <span className="flex items-center gap-1 tabular-nums">
              <MessageSquare size={11} aria-hidden /> {thread.replyCount}
            </span>
            <Reactions target="thread" id={thread.id} likes={thread.likes} dislikes={thread.dislikes} mine={thread.myReaction} own={thread.isYou} showToast={showToast} />
            <span>{relativeTime(thread.lastActivityAt)}</span>
            {spoilerText(thread.spoiler) && <span className="state-chip">{spoilerText(thread.spoiler)}</span>}
            {canPin && (
              <button type="button" className="touch-hit hover:text-on-surface" onClick={() => void pin()}>
                {thread.pinned ? "Unpin" : "Pin"}
              </button>
            )}
          </p>
        </>
      )}
    </li>
  );
};

const cleanHandle = (typed: string) => typed.trim().replace(/^@+/, "").toLowerCase();

/**
 * What only the owner can put right in a community (the server answers "no
 * such route" to anyone else): what it is called, who keeps it, a removed
 * reader let back in, and whether it is in the directory. Each press sends
 * the one thing it names; the rest stays as it is.
 */
const OwnerTools = ({ community, showToast, onChanged }: { community: BookCommunity; showToast: Toast; onChanged: (community: BookCommunity) => void }) => {
  const [title, setTitle] = useState(community.title);
  const [author, setAuthor] = useState(community.author ?? "");
  const [keeper, setKeeper] = useState("");
  const [unban, setUnban] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTitle(community.title);
    setAuthor(community.author ?? "");
  }, [community.title, community.author]);

  const run = (change: CommunityChange, done: (now: BookCommunity) => string) => {
    setBusy(true);
    discussService
      .adminCommunity(community.id, change)
      .then((now) => {
        onChanged(now);
        showToast(done(now));
      })
      .catch((cause) => showToast(errorText(cause)))
      .finally(() => setBusy(false));
  };

  const newTitle = title.trim() !== community.title;
  const newAuthor = author.trim() !== (community.author ?? "");
  const rename = () => {
    if (!title.trim() || (!newTitle && !newAuthor)) {
      return;
    }
    run({ ...(newTitle ? { title: title.trim() } : {}), ...(newAuthor ? { author: author.trim() || null } : {}) }, () => "Saved.");
  };

  const makeKeeper = async () => {
    const handle = cleanHandle(keeper);
    if (!handle || !(await askConfirm({ title: `Make ${at(handle)} the keeper of “${community.title}”?`, body: "The keeper it has now stops being one.", confirmLabel: "Make keeper" }))) {
      return;
    }
    run({ keeper: handle }, () => (setKeeper(""), `${at(handle)} keeps this community now.`));
  };

  const letBack = () => {
    const handle = cleanHandle(unban);
    if (handle) {
      run({ unban: handle }, () => (setUnban(""), `${at(handle)} can join again.`));
    }
  };

  const list = async () => {
    if (!community.listed) {
      run({ relist: true }, (now) => (now.listed ? "Listed." : "Still not listed. It needs three established members."));
      return;
    }
    if (await askConfirm({ title: `Unlist “${community.title}”?`, body: "It leaves the directory. Its members keep it.", confirmLabel: "Unlist", danger: true })) {
      run({ relist: false }, () => "Unlisted.");
    }
  };

  const field = "inset-field min-w-0 px-3 py-1.5 text-xs text-on-surface";
  const button = "tactile-button shrink-0 px-3 py-1.5 text-xs disabled:opacity-60";
  return (
    <div className="mt-4 flex flex-col gap-2 rounded-xl border border-outline-variant/30 p-3" role="group" aria-label="Owner">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          rename();
        }}
      >
        <input className={`${field} flex-[2] basis-48`} placeholder="Title" aria-label="The community's title" maxLength={THREAD_TITLE_MAX} value={title} onChange={(event) => setTitle(event.target.value)} />
        <input className={`${field} flex-1 basis-32`} placeholder="Author" aria-label="The book's author" maxLength={80} value={author} onChange={(event) => setAuthor(event.target.value)} />
        <button type="submit" className={button} disabled={busy || !title.trim() || (!newTitle && !newAuthor)}>
          Save
        </button>
      </form>
      <div className="flex flex-wrap gap-2">
        <form
          className="flex min-w-0 flex-1 basis-52 gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void makeKeeper();
          }}
        >
          <input className={`${field} flex-1`} placeholder="@handle" aria-label="The member to make keeper" title="A member's handle. They take the keeper's place." maxLength={25} value={keeper} onChange={(event) => setKeeper(event.target.value)} />
          <button type="submit" className={button} disabled={busy || !cleanHandle(keeper)}>
            Make keeper
          </button>
        </form>
        <form
          className="flex min-w-0 flex-1 basis-52 gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            letBack();
          }}
        >
          <input className={`${field} flex-1`} placeholder="@handle" aria-label="The reader to unban" title="The handle of a reader removed from here. They can join again." maxLength={25} value={unban} onChange={(event) => setUnban(event.target.value)} />
          <button type="submit" className={button} disabled={busy || !cleanHandle(unban)}>
            Unban
          </button>
        </form>
        <button
          type="button"
          className={button}
          disabled={busy}
          title={community.listed ? "Takes it out of the directory" : "Puts it back in the directory. One that never had three established members stays out."}
          onClick={() => void list()}
        >
          {community.listed ? "Unlist" : "List"}
        </button>
      </div>
    </div>
  );
};

const CommunityView = ({ id, showToast }: { id: string; showToast: Toast }) => {
  const go = useDiscussStore((state) => state.go);
  const report = useDiscussStore((state) => state.report);
  const ensureRules = useDiscussStore((state) => state.ensureRules);
  const isAdmin = useCommunityStore((state) => Boolean(state.me?.isAdmin));
  const [owner, setOwner] = useState(false);
  const [community, setCommunity] = useState<BookCommunity | null>(null);
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [mark, setMark] = useState(0);
  const [busy, setBusy] = useState(false);
  const { place, books } = usePlace(community);

  const load = useCallback(() => {
    Promise.all([discussService.community(id), discussService.threads(id)])
      .then(([found, list]) => {
        setCommunity(found);
        setThreads(list.threads);
        setMore(list.more);
        setError(null);
      })
      .catch((cause) => setError(errorText(cause)));
  }, [id]);
  useEffect(load, [load]);

  const choices = community?.kind === "series" ? seriesSpoilerChoices(books) : bookSpoilerChoices(place as BookPlace);

  const older = () => {
    const last = threads?.[threads.length - 1];
    if (!last) {
      return;
    }
    setBusy(true);
    discussService
      .threads(id, last.lastActivityAt)
      .then((answer) => {
        const have = new Set((threads ?? []).map((thread) => thread.id));
        setThreads((current) => [...(current ?? []), ...answer.threads.filter((thread) => !have.has(thread.id))]);
        setMore(answer.more);
      })
      .catch((cause) => showToast(errorText(cause)))
      .finally(() => setBusy(false));
  };

  const join = async () => {
    if (!(await ensureRules())) {
      return;
    }
    setBusy(true);
    discussService
      .joinCommunity(id)
      .then((joined) => setCommunity(joined))
      .catch((cause) => showToast(errorText(cause)))
      .finally(() => setBusy(false));
  };

  const leave = async () => {
    if (!community || !(await askConfirm({ title: `Leave “${community.title}”?`, body: "What you wrote stays. You can join again.", confirmLabel: "Leave" }))) {
      return;
    }
    discussService
      .leaveCommunity(id)
      .then(() => go({ at: "list" }))
      .catch((cause) => showToast(errorText(cause)));
  };

  const start = async () => {
    const spoiler: Spoiler = choices[mark]?.spoiler ?? null;
    if (!title.trim() || !body.trim() || !(await ensureRules())) {
      return;
    }
    setBusy(true);
    discussService
      .startThread(id, { title: title.trim(), body: body.trim(), spoiler })
      .then((made) => {
        setTitle("");
        setBody("");
        setMark(0);
        setWriting(false);
        go({ at: "thread", id: made.id, communityId: id });
      })
      .catch((cause) => showToast(errorText(cause)))
      .finally(() => setBusy(false));
  };

  return (
    <section className="paper-surface rounded-xl p-4 sm:p-6">
      <button type="button" className="touch-hit flex items-center gap-1.5 py-1 text-xs font-semibold text-on-surface-variant hover:text-on-surface" onClick={() => go({ at: "list" })}>
        <ArrowLeft size={14} aria-hidden /> Communities
      </button>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="page-title text-3xl [overflow-wrap:anywhere]">{community?.title ?? "…"}</h2>
          {community && (
            <p className="mt-1 text-xs text-on-surface-variant">
              {community.author ? `${community.author} · ` : ""}
              {community.kind === "series" ? "A series · " : ""}
              {members(community.memberCount)}
              {!community.listed && (
                <span title="A community is listed for everyone to find once it has three members"> · not listed yet</span>
              )}
            </p>
          )}
        </div>
        {community && (
          <div className="flex flex-wrap gap-2">
            {community.isMember ? (
              <>
                <button type="button" className="tactile-button tactile-button-primary px-3 py-1.5 text-xs font-semibold" aria-expanded={writing} onClick={() => setWriting((value) => !value)}>
                  New thread
                </button>
                <button type="button" className="tactile-button px-3 py-1.5 text-xs" onClick={() => void leave()}>
                  Leave
                </button>
              </>
            ) : (
              <button type="button" className="tactile-button tactile-button-primary px-3 py-1.5 text-xs font-semibold disabled:opacity-60" disabled={busy} onClick={() => void join()}>
                Join
              </button>
            )}
            <button
              type="button"
              className="tactile-button flex items-center gap-1 px-3 py-1.5 text-xs"
              onClick={() => report({ target: "community", id, what: "this community" })}
              aria-label="Report this community"
            >
              <Flag size={12} aria-hidden />
            </button>
            {isAdmin && (
              <button type="button" className="tactile-button px-3 py-1.5 text-xs" aria-expanded={owner} title="Only you see this" onClick={() => setOwner((value) => !value)}>
                Owner
              </button>
            )}
          </div>
        )}
      </div>

      {owner && isAdmin && community && <OwnerTools community={community} showToast={showToast} onChanged={setCommunity} />}

      {writing && community?.isMember && (
        <form
          className="mt-4 flex flex-col gap-2 rounded-xl border border-outline-variant/30 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void start();
          }}
        >
          <input autoFocus className="inset-field px-3 py-2 text-sm text-on-surface" placeholder="A question, a theory, a favourite part" maxLength={THREAD_TITLE_MAX} aria-label="The thread's title" value={title} onChange={(event) => setTitle(event.target.value)} />
          <textarea className="inset-field resize-none px-3 py-2 text-sm text-on-surface" rows={6} maxLength={THREAD_BODY_MAX} placeholder="Say more" aria-label="The thread" value={body} onChange={(event) => setBody(event.target.value)} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 text-xs text-on-surface" title="How far into the book this goes. It stays covered for readers who are not there yet.">
              Spoilers
              <select className="inset-field px-2 py-1 text-xs text-on-surface" value={mark} onChange={(event) => setMark(Number(event.target.value))}>
                {choices.map((choice, index) => (
                  <option key={choice.label} value={index}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="tactile-button tactile-button-primary px-4 py-2 text-xs font-semibold disabled:opacity-60" disabled={busy || !title.trim() || !body.trim()}>
              Post
            </button>
          </div>
        </form>
      )}

      {error ? (
        <ErrorLine message={error} onRetry={() => (setError(null), load())} />
      ) : threads === null ? (
        <p className="mt-4 text-sm text-on-surface-variant">Opening…</p>
      ) : threads.length === 0 ? (
        <p className="mt-4 text-sm text-on-surface-variant">No threads yet. Start one.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2.5">
          {threads.map((thread) => (
            <ThreadRow key={thread.id} thread={thread} past={isPast(thread.spoiler, place)} canPin={Boolean(community?.isKeeper) || isAdmin} showToast={showToast} onChanged={load} />
          ))}
        </ul>
      )}
      {more && (
        <button type="button" className="tactile-button mt-4 px-4 py-2 text-xs disabled:opacity-60" onClick={older} disabled={busy}>
          {busy ? "…" : "Older"}
        </button>
      )}
    </section>
  );
};

// ---- the list --------------------------------------------------------------------

const CommunityTile = ({ community, onOpen }: { community: BookCommunity; onOpen: () => void }) => (
  <button type="button" className="flex min-w-0 flex-col gap-1 rounded-xl border border-outline-variant/30 bg-surface-container/40 p-4 text-left transition-transform hover:-translate-y-0.5" onClick={onOpen}>
    <span className="truncate font-headline text-lg font-bold text-on-surface">{community.title}</span>
    <span className="truncate text-xs text-on-surface-variant">{community.author ?? (community.kind === "series" ? "A series" : " ")}</span>
    <span className="mt-1 text-[11px] tabular-nums text-on-surface-variant">
      {members(community.memberCount)} · {community.threadCount} {community.threadCount === 1 ? "thread" : "threads"}
    </span>
  </button>
);

const CommunityList = ({ showToast }: { showToast: Toast }) => {
  const go = useDiscussStore((state) => state.go);
  const ensureRules = useDiscussStore((state) => state.ensureRules);
  const books = useLibraryStore((state) => state.books);
  const series = useLibrarySeries();
  const [mine, setMine] = useState<BookCommunity[] | null>(null);
  const [found, setFound] = useState<BookCommunity[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);
  // Why the directory could not be searched: a failure is not "no communities".
  const [findError, setFindError] = useState<string | null>(null);
  // Each counts up to ask again after a failure.
  const [attempt, setAttempt] = useState(0);
  const [findAttempt, setFindAttempt] = useState(0);

  useEffect(() => {
    discussService
      .communities({ mine: true })
      .then((list) => (setMine(list), setError(null)))
      .catch((cause) => setError(errorText(cause)));
  }, [attempt]);

  // The directory as it is typed for, a moment after the typing stops.
  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      discussService
        .communities({ q: query.trim() })
        .then((list) => live && (setFound(list), setFindError(null)))
        .catch((cause) => live && setFindError(errorText(cause)));
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query, findAttempt]);

  // What a community can be opened for: the series of the library, then its books begun or finished.
  const startable = useMemo(
    () => [
      ...series.groups.map((group) => ({ value: `series:${group.key}`, label: `${group.name} (series)`, of: { kind: "series" as const, key: group.key, title: group.name, author: group.author } })),
      ...books
        .filter((book) => (book.progress ?? 0) > 0 || Boolean(book.finishedAt))
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((book) => ({ value: `book:${book.id}`, label: book.title, of: { kind: "book" as const, key: null, title: book.title, author: book.author ?? null } }))
    ],
    [series.groups, books]
  );

  const open = async () => {
    const choice = startable.find((entry) => entry.value === picked);
    if (!choice || !(await ensureRules())) {
      return;
    }
    setBusy(true);
    discussService
      .openCommunity(choice.of)
      .then((community) => go({ at: "community", id: community.id }))
      .catch((cause) => showToast(errorText(cause)))
      .finally(() => setBusy(false));
  };

  const mineIds = new Set((mine ?? []).map((community) => community.id));

  return (
    <>
      <section className="paper-surface rounded-xl p-4 sm:p-6" aria-labelledby="my-communities-title">
        <SectionHeader eyebrow="One for each book or series" title="Your communities" id="my-communities-title" />
        {error ? (
          <ErrorLine message={error} onRetry={() => (setError(null), setAttempt((count) => count + 1))} />
        ) : mine === null ? (
          <p className="mt-4 text-sm text-on-surface-variant">Looking…</p>
        ) : mine.length === 0 ? (
          <p className="mt-4 text-sm text-on-surface-variant">None yet. Join one below, or open the one for a book you are reading.</p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {mine.map((community) => (
              <CommunityTile key={community.id} community={community} onOpen={() => go({ at: "community", id: community.id })} />
            ))}
          </div>
        )}
        {startable.length > 0 && (
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-outline-variant/30 pt-4">
            <select className="inset-field min-w-0 max-w-full flex-1 px-3 py-2 text-sm text-on-surface" aria-label="A book or series of yours" value={picked} onChange={(event) => setPicked(event.target.value)}>
              <option value="">A book or series of yours…</option>
              {startable.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="tactile-button tactile-button-primary px-4 py-2 text-xs font-semibold disabled:opacity-60"
              disabled={busy || !picked}
              title="Joins its community, or starts it if nobody has"
              onClick={() => void open()}
            >
              Open its community
            </button>
          </div>
        )}
      </section>

      <section className="paper-surface rounded-xl p-4 sm:p-6" aria-labelledby="find-communities-title">
        <SectionHeader eyebrow="Theories, questions, favourite parts" title="Find a community" id="find-communities-title" />
        <input className="inset-field mt-4 w-full px-3 py-2 text-sm text-on-surface" placeholder="A book or a series" aria-label="Find a community" value={query} onChange={(event) => setQuery(event.target.value)} />
        {findError ? (
          <ErrorLine message={findError} onRetry={() => (setFindError(null), setFound(null), setFindAttempt((count) => count + 1))} />
        ) : found === null ? (
          <p className="mt-4 text-sm text-on-surface-variant">Looking…</p>
        ) : found.filter((community) => !mineIds.has(community.id)).length === 0 ? (
          <p className="mt-4 text-sm text-on-surface-variant">{query.trim().length >= 2 ? "None by that name yet." : "No other communities yet."}</p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {found
              .filter((community) => !mineIds.has(community.id))
              .map((community) => (
                <CommunityTile key={community.id} community={community} onOpen={() => go({ at: "community", id: community.id })} />
              ))}
          </div>
        )}
      </section>
    </>
  );
};

/**
 * Book communities: one for each book or series, where readers talk it over
 * in threads. The list of the reader's own and the directory, one community
 * with its threads, or one thread with its replies.
 */
export const CommunitiesPanel = ({ showToast }: { showToast: Toast }) => {
  const view = useDiscussStore((state) => state.view);
  const go = useDiscussStore((state) => state.go);
  // Android's Back walks back up, thread to community to the list, before it leaves the tab.
  // One press a step: the layer is set again for each place it leads to.
  useEffect(() => {
    if (view.at === "list") return undefined;
    return pushBackLayer(() => go(view.at === "thread" && view.communityId ? { at: "community", id: view.communityId } : { at: "list" }));
  }, [view, go]);
  if (view.at === "thread") {
    return <ThreadView key={view.id} id={view.id} showToast={showToast} />;
  }
  if (view.at === "community") {
    return <CommunityView key={view.id} id={view.id} showToast={showToast} />;
  }
  return <CommunityList showToast={showToast} />;
};
