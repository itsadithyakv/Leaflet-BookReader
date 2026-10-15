import { useCallback, useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";
import { GamePicker } from "./GamePicker";
import { GAMES, type GameId, type GameInfo } from "./games";
import { GameScreen, type Winnings } from "./GameScreen";
import { WagerBar } from "./WagerBar";
import { dayNumber } from "../../../pip/diary/seed";
import type { SavedWord } from "../../../readers/words/rows";
import { getDateKey } from "../../../services/habitService";
import { wordService } from "../../../services/wordService";
import { PURSE_EVERY, PURSE_MOST, paysMostAt } from "../../../pip/base/rules";
import { useBaseStore } from "../../../store/baseStore";
import { TipLayer } from "./base/Tips";
import { dueCount } from "./quiz/boxes";
import { MyWords } from "./quiz/MyWords";
import { WordQuiz } from "./quiz/WordQuiz";
import { useBackLayer } from "../../../platform/back";

const BEST_KEY = "leaflet.pip.arcadeBest";
/** Best scores kept in the browser too, for the dev server (no Rust there). */
const readLocalBest = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
};

/** The arcade's pages that are not games on the canvas: the word quiz, and the words it is played with. */
export type ArcadePage = "quiz" | "words";

export type ArcadeOverlayProps = {
  /** The game to open on (the machine that was selected), or the list of them all. */
  initial?: GameId | ArcadePage | null;
  skin: string;
  outfit: readonly string[];
  /** Best scores from Rust (per device). */
  best: Record<string, number>;
  /** How Pip is at home, 0 to 100, once it is known: the camp is told. */
  mood?: number;
  /** Mood games have given today, and the cap. */
  moodToday: number;
  moodCap: number;
  /** Records a finished game; resolves with the mood it added. */
  onFinished: (game: GameId, score: number) => Promise<number>;
  onClose: () => void;
};

/** What a game pays the camp: said on its card's tooltip, not on the screen. */
const acornTerms = (game: GameId) =>
  `Pays the camp up to ${PURSE_MOST} acorns a run (at ${paysMostAt(game)} points), for runs your reading has earned: one for every ${PURSE_EVERY} minutes read.`;

/**
 * The Attic Arcade: pick a game, play it in a crisp pixel canvas.
 *
 * The loop runs on requestAnimationFrame only while a game is on screen and
 * not paused; it stops when the overlay closes, when the window loses focus
 * (the game pauses), and when the tab is hidden. Keys are captured while the
 * overlay is open, so Space and the arrows never page a book underneath.
 *
 * Games never earn seeds (those come only from reading in focus). A finished
 * game cheers Pip up a little, up to a daily cap, and keeps a best score.
 *
 * The word quiz (quiz/) is the fourth game: questions, not a canvas, made
 * from the words the reader looked up. It earns nothing at all, mood
 * included: it is not recorded as a game played. "My words" lists them.
 *
 * The Hollow (base/) is Pip's camp, built with acorns, never seeds. It is not
 * in here: it is the place Pip's tab opens on (HollowPlace). The three canvas
 * games pay it a little, for runs the reader's reading has earned, and can be
 * wagered on (WagerBar).
 */
export const ArcadeOverlay = ({ initial = null, skin, outfit, best, mood, moodToday, moodCap, onFinished, onClose }: ArcadeOverlayProps) => {
  const [chosen, setChosen] = useState<GameInfo | null>(() => GAMES.find((game) => game.id === initial) ?? null);
  const [page, setPage] = useState<ArcadePage | null>(initial === "quiz" || initial === "words" ? initial : null);
  // Android's Back: out of the arcade; from the quiz or the words, back to the games first. (A game's own Back is
  // GameScreen's: it pauses, then leaves the game. Keyed on the game rather than always open: a game opened with the
  // arcade mounts with it, and a child's layer, pushed first, would go under its parent's.)
  useBackLayer(!chosen && page === null, onClose);
  useBackLayer(!chosen && page !== null, () => setPage(null));
  // The camp is read as the arcade opens: the games pay into it.
  useEffect(() => {
    void useBaseStore.getState().open();
  }, []);
  // How Pip is at home is what she brings to the camp: it is told so.
  useEffect(() => {
    useBaseStore.getState().setMood(mood);
  }, [mood]);
  // The reader's words: fetched as the arcade opens, and again when one is removed or a round ends.
  const [words, setWords] = useState<SavedWord[] | null>(null);
  const loadWords = useCallback(() => {
    wordService.list().then(setWords, () => setWords([]));
  }, []);
  useEffect(loadWords, [loadWords]);
  const [localBest, setLocalBest] = useState(readLocalBest);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const bestOf = (id: string) => Math.max(best[id] ?? 0, localBest[id] ?? 0);

  // Focus into the overlay, and back where it came from on close.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => before?.focus?.();
  }, []);

  const finished = useCallback(
    async (game: GameId, score: number): Promise<Winnings> => {
      setLocalBest((current) => {
        if ((current[game] ?? 0) >= score) return current;
        const next = { ...current, [game]: score };
        try {
          localStorage.setItem(BEST_KEY, JSON.stringify(next));
        } catch {
          // Rust keeps the real record.
        }
        return next;
      });
      const camp = useBaseStore.getState().played(game, score);
      const forCamp = { paid: camp?.paid ?? 0, wager: camp?.wager ?? null };
      try {
        return { mood: await onFinished(game, score), ...forCamp };
      } catch {
        return { mood: 0, ...forCamp };
      }
    },
    [onFinished]
  );

  return (
    <div className="pip-arcade-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className="pip-arcade modal-surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pip-arcade-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !chosen) {
            event.stopPropagation();
            // From the quiz or the words, back to the games; from the games, out.
            if (page) setPage(null);
            else onClose();
          }
        }}
      >
        <div className="pip-arcade-page">
        <div className="pip-arcade-head flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Attic Arcade</p>
            <h2 id="pip-arcade-title" className="page-title text-2xl text-on-surface">
              {chosen ? chosen.name : page === "quiz" ? "Word Quiz" : page === "words" ? "My words" : "Pick a game"}
            </h2>
          </div>
          <button
            type="button"
            className="tactile-button px-3 py-1.5 text-xs"
            onClick={
              chosen
                ? () => setChosen(null)
                : page
                  ? () => {
                      setPage(null);
                      // The list under it has changed size: focus stays in the dialog.
                      dialogRef.current?.focus();
                    }
                  : onClose
            }
          >
            {chosen || page ? "All games" : "Close"}
          </button>
        </div>

        {chosen ? (
          <GameScreen
            key={chosen.id}
            game={chosen}
            skin={skin}
            outfit={outfit}
            best={bestOf(chosen.id)}
            onFinished={finished}
            onExit={() => setChosen(null)}
            between={<WagerBar game={chosen.id} />}
          />
        ) : page === "quiz" ? (
          <WordQuiz words={words} onChanged={loadWords} onMyWords={() => setPage("words")} skin={skin} outfit={outfit} />
        ) : page === "words" ? (
          <MyWords words={words} onChanged={loadWords} onOpened={onClose} />
        ) : (
          <GamePicker
            skin={skin}
            outfit={outfit}
            bestOf={bestOf}
            termsOf={acornTerms}
            words={words === null ? null : words.length === 0 ? "No words yet" : `${words.length} ${words.length === 1 ? "word" : "words"}, ${dueCount(words, dayNumber(getDateKey()))} due`}
            onGame={setChosen}
            onQuiz={() => setPage("quiz")}
          />
        )}
        {!chosen && !page && (
          <button type="button" className="tactile-button mt-3 px-3 py-1.5 text-xs" onClick={() => setPage("words")}>
            My words{words && words.length > 0 ? ` (${words.length})` : ""}
          </button>
        )}

        {
          <p className="mt-4 flex">
            <span
              className="pip-base-chip"
              title={`Games don't earn seeds: those come only from reading in focus. Playing cheers Pip up a little${
                moodToday >= moodCap ? " (that's all the cheering games and play can do today)." : ` (games and play together, up to +${moodCap} mood a day).`
              }${page ? " The word quiz earns neither." : ""}`}
            >
              <Info size={13} aria-hidden /> Seeds and mood
            </span>
          </p>
        }
        </div>
        <TipLayer rootRef={dialogRef} />
      </div>
    </div>
  );
};

