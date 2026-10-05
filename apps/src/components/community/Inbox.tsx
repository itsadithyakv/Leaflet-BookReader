import { useEffect, useState } from "react";
import { PipSprite } from "../PipSprite";
import { useCommunityStore, type InboxItem } from "./communityStore";
import { PipAvatar } from "./PipAvatar";
import { at, errorText, relativeTime } from "./format";
import { duelDeclinedText, duelOnText, kudosReceivedText } from "./copy";
import { SectionHeader } from "../ui/SectionHeader";

const describe = (item: InboxItem): string => {
  const who = at(item.actor.handle);
  switch (item.type) {
    case "follow":
      return `${who} started following you.`;
    case "kudos":
      return kudosReceivedText(item.actor.handle);
    case "duel_invite":
      return `${who} challenged you to a duel this week.`;
    case "duel_accepted":
      return `${who} accepted your duel. Game on.`;
    case "duel_result":
      return item.duel?.result === "won"
        ? `You won your duel with ${who}.`
        : item.duel?.result === "lost"
          ? `${who} won your duel this time.`
          : `Your duel with ${who} ended in a tie.`;
    case "passed":
      return `${who} just passed you on the Following board.`;
  }
};

const InviteActions = ({ item, showToast }: { item: InboxItem; showToast: (message: string) => void }) => {
  const respond = useCommunityStore((state) => state.respondToDuel);
  // The duels list is fresher than the event, which was captured at the time.
  const live = useCommunityStore((state) => (item.type === "duel_invite" ? state.duels.find((duel) => duel.id === item.duel?.id) : undefined));
  const [busy, setBusy] = useState(false);
  if (item.type !== "duel_invite" || !item.duel) {
    return null;
  }
  const status = live?.status ?? item.duel.status;
  if (status !== "pending" || item.duel.weekOver) {
    const label = status === "accepted" ? "Accepted" : status === "declined" ? "Declined" : status === "finished" ? "Finished" : "Expired";
    return <span className="shrink-0 text-[11px] text-on-surface-variant">{label}</span>;
  }
  const answer = (accept: boolean) => {
    setBusy(true);
    respond(item.duel!.id, accept)
      .then(() => showToast(accept ? duelOnText(item.actor.handle) : duelDeclinedText))
      .catch((cause) => showToast(errorText(cause)))
      .finally(() => setBusy(false));
  };
  return (
    <span className="flex shrink-0 gap-2">
      <button type="button" disabled={busy} className="tactile-button px-3 py-1.5 text-xs disabled:opacity-60" onClick={() => answer(false)}>
        Decline
      </button>
      <button type="button" disabled={busy} className="tactile-button tactile-button-primary px-3 py-1.5 text-xs disabled:opacity-60" onClick={() => answer(true)}>
        Accept
      </button>
    </span>
  );
};

/**
 * What happened while you were reading: followers, kudos, duel news, and who
 * passed you. Opening the Social page marks it read (after a moment, so the
 * unread dots are seen first).
 */
export const Inbox = ({ showToast }: { showToast: (message: string) => void }) => {
  const inbox = useCommunityStore((state) => state.inbox);
  const seenAt = useCommunityStore((state) => state.seenAt);
  const markSeen = useCommunityStore((state) => state.markSeen);
  const openReader = useCommunityStore((state) => state.openReader);
  // What was unread when the page opened keeps its dot for this visit.
  const [unreadSince] = useState(seenAt);

  useEffect(() => {
    const timer = window.setTimeout(markSeen, 2500);
    return () => window.clearTimeout(timer);
  }, [inbox, markSeen]);

  return (
    <section className="paper-surface rounded-xl p-4 sm:p-6" aria-labelledby="inbox-title">
      <SectionHeader eyebrow="News" title="Inbox" id="inbox-title" />
      {inbox.length === 0 ? (
        <div className="mt-2 flex items-center gap-4 py-3">
          <PipSprite move="sleep" size={48} still />
          <p className="text-sm text-on-surface-variant">All quiet. Kudos, new followers and duel invites land here.</p>
        </div>
      ) : (
        <ul className="mt-4 flex max-h-96 flex-col gap-1 overflow-y-auto pr-1">
          {inbox.map((item) => (
            // Wraps: in a narrow window the two answers to an invitation go under
            // its words, which otherwise had six pixels to themselves.
            <li key={item.id} className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 rounded-lg px-2 py-2 hover:bg-surface-container-high/50">
              <span className="relative">
                <button type="button" onClick={() => openReader(item.actor.handle)} aria-label={`Open ${at(item.actor.handle)}`}>
                  <PipAvatar seed={item.actor.pipSeed} avatar={item.actor.avatar} size={34} />
                </button>
                {item.createdAt > unreadSince && (
                  <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-surface" aria-label="New" />
                )}
              </span>
              <span className="min-w-0 flex-1 basis-32">
                <span className="block text-sm text-on-surface [overflow-wrap:anywhere]">{describe(item)}</span>
                <span className="block text-[11px] text-on-surface-variant">{relativeTime(item.createdAt)}</span>
              </span>
              <InviteActions item={item} showToast={showToast} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
