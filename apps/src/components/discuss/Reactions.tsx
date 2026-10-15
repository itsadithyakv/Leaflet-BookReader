import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { discussService, type Reaction } from "../../services/discussService";
import { errorText } from "../community/format";

type Props = {
  target: "post" | "thread" | "reply";
  id: string;
  likes: number;
  dislikes: number;
  mine: Reaction;
  /** A reader does not vote on their own words. */
  own: boolean;
  showToast: (message: string) => void;
  /** Told the counts as the server has them, so a list can keep them. */
  onChange?: (counts: { likes: number; dislikes: number; myReaction: Reaction }) => void;
};

/**
 * Like and dislike, with how many of each. Pressing the one that is on
 * takes it back. The count shown is the server's own once it answers; until
 * then it moves at once, and goes back if the server says no.
 */
export const Reactions = ({ target, id, likes, dislikes, mine, own, showToast, onChange }: Props) => {
  const [shown, setShown] = useState({ likes, dislikes, myReaction: mine });
  const [busy, setBusy] = useState(false);

  const press = (value: 1 | -1) => {
    const next: Reaction = shown.myReaction === value ? 0 : value;
    const before = shown;
    // What the counts become if the server agrees.
    const guess = {
      likes: shown.likes + (next === 1 ? 1 : 0) - (shown.myReaction === 1 ? 1 : 0),
      dislikes: shown.dislikes + (next === -1 ? 1 : 0) - (shown.myReaction === -1 ? 1 : 0),
      myReaction: next
    };
    setShown(guess);
    setBusy(true);
    discussService
      .react(target, id, next)
      .then((counts) => {
        setShown(counts);
        onChange?.(counts);
      })
      .catch((cause) => {
        setShown(before);
        showToast(errorText(cause));
      })
      .finally(() => setBusy(false));
  };

  const button = (value: 1 | -1, count: number, label: string) => {
    const on = shown.myReaction === value;
    const Icon = value === 1 ? ThumbsUp : ThumbsDown;
    return (
      <button
        type="button"
        className={`touch-hit flex items-center gap-1 rounded-full px-2 py-1 text-[11px] tabular-nums transition-colors disabled:cursor-default ${
          on ? "bg-primary/15 font-semibold text-primary" : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface disabled:hover:bg-transparent disabled:hover:text-on-surface-variant"
        }`}
        aria-pressed={on}
        aria-label={`${label}: ${count}`}
        title={own ? "Yours" : label}
        disabled={own || busy}
        onClick={() => press(value)}
      >
        <Icon size={13} aria-hidden fill={on ? "currentColor" : "none"} />
        {count}
      </button>
    );
  };

  return (
    <span className="flex items-center gap-0.5">
      {button(1, shown.likes, "Like")}
      {button(-1, shown.dislikes, "Dislike")}
    </span>
  );
};
