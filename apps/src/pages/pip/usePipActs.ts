import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { pickBeat } from "../../pip/moments";
import { ownedPremiumMoves } from "../../store/pipWardrobeStore";
import type { PipReaction } from "../../store/pipStore";
import type { PipOverview } from "../../services/pipService";
import type { SceneAct } from "../../components/pip/HouseScene";
import { MOOD_LOW, pickOne } from "./common";

/** How long a line stays up after Pip says it. */
const LINE_MS = 4200;

export type Act = SceneAct & { reactionId?: number };

type PipActsOptions = {
  reaction: PipReaction | null;
  suspended: boolean;
  finishReaction: (id: number) => void;
  overview: PipOverview | null;
  mood: number;
  signature: string;
  /** Effects timed to Pip's current act (crumbs at each bite): a new act cancels them. */
  actTimers: MutableRefObject<Set<number>>;
  setHeldMood: Dispatch<SetStateAction<number | null>>;
};

/**
 * Pip's lines and moves in the house: what Pip is doing and saying, the
 * celebrations queued for the roaming Pip (played here while the tab is
 * open), a poke, and what fills a free moment.
 */
export const usePipActs = ({ reaction, suspended, finishReaction, overview, mood, signature, actTimers, setHeldMood }: PipActsOptions) => {
  const [act, setAct] = useState<Act | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const actKey = useRef(1);

  useEffect(() => {
    if (!line) return;
    const timer = window.setTimeout(() => setLine(null), LINE_MS);
    return () => window.clearTimeout(timer);
  }, [line]);

  const actRef = useRef<Act | null>(null);
  actRef.current = act;
  const play = useCallback(
    (move: string, loops = 2, text: string | null = null, reactionId?: number) => {
      // A celebration cut short (by a poke, a treat) still counts as done, or
      // the queue behind it would wait until the tab closes.
      const previous = actRef.current;
      if (previous?.reactionId !== undefined && previous.reactionId !== reactionId) {
        finishReaction(previous.reactionId);
      }
      // Crumbs from a snack Pip is no longer eating would fall from nowhere,
      // and hearts that will not fly now should not keep the meter waiting.
      if (actTimers.current.size > 0) {
        actTimers.current.forEach((timer) => window.clearTimeout(timer));
        actTimers.current.clear();
        setHeldMood(null);
      }
      setAct({ move, loops, key: actKey.current++, reactionId });
      if (text) setLine(text);
    },
    [finishReaction]
  );
  /** Runs `run` in `ms`, unless Pip starts something else first. */
  const duringAct = (ms: number, run: () => void) => {
    const timer = window.setTimeout(() => {
      actTimers.current.delete(timer);
      run();
    }, ms);
    actTimers.current.add(timer);
  };

  // Leaving the tab mid-celebration finishes it here rather than replaying it
  // when the roaming Pip comes back out.
  useEffect(
    () => () => {
      const reactionId = actRef.current?.reactionId;
      if (reactionId !== undefined) finishReaction(reactionId);
    },
    [finishReaction]
  );

  // Celebrations (goal met, a streak milestone...) play in the house while the
  // tab is open, since the roaming Pip is not out to do them.
  useEffect(() => {
    if (!reaction || suspended || act?.reactionId === reaction.id) return;
    play(reaction.move, reaction.loops, reaction.line, reaction.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reaction, suspended]);

  const onActDone = () => {
    if (act?.reactionId !== undefined) finishReaction(act.reactionId);
    setAct(null);
  };

  // A free moment: the signature move, or one of Pip's hobbies (the free ones
  // plus the moves the reader bought). Not while moping.
  const hobbies = useMemo(() => ["jog", "rope", "tree", "read", ...ownedPremiumMoves(overview)], [overview]);
  const pastimeRef = useRef<() => string | null>(() => null);
  pastimeRef.current = () => (mood < MOOD_LOW ? null : Math.random() < 0.5 ? signature : pickOne(hobbies));
  const pastime = useCallback(() => pastimeRef.current(), []);

  const poke = useCallback(() => {
    const beat = pickBeat("poke", `${Date.now()}`);
    play(beat.move, 1, beat.line);
  }, [play]);

  return { act, line, play, duringAct, onActDone, pastime, poke };
};
