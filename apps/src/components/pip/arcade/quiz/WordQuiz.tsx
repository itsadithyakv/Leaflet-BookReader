import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { PipSprite } from "../../../PipSprite";
import { UiIcon } from "../../../UiIcon";
import { dayNumber } from "../../../../pip/diary/seed";
import { peopleSwitchOn } from "../../../../readers/people/peoplePrefs";
import type { SavedWord } from "../../../../readers/words/rows";
import { wordsSwitchOn } from "../../../../readers/words/wordPrefs";
import { getDateKey } from "../../../../services/habitService";
import { peopleService } from "../../../../services/peopleService";
import { wordService } from "../../../../services/wordService";
import { useLibraryStore } from "../../../../store/libraryStore";
import { answered, dueCount } from "./boxes";
import { buildWhoRound, knownPeople, type KnownPerson } from "./whoQuiz";
import { MIN_WORDS, buildRound, type Question } from "./round";
import "./quiz.css";

type WordQuizProps = {
  /** The reader's words, or null while they are being fetched. */
  words: SavedWord[] | null;
  /** A word's box changed: the list is asked for again. */
  onChanged: () => void;
  onMyWords: () => void;
  skin: string;
  outfit: readonly string[];
};

type Mode = "words" | "who";
type Round = { mode: Mode; questions: Question[]; at: number; picked: number | null; right: number };

/** What Pip says. Lower case, short, and the drama is hers. */
const ASKS: Record<Question["way"], string[]> = {
  meaning: ["what does this one mean?", "this one. go.", "you looked this up once."],
  word: ["which word was that?", "i know this one. do you?", "it has a word. which?"],
  who: ["who is this?", "you wrote this down. who is it?", "remind me who this is."]
};
const RIGHT = ["yes. that's the one.", "right. up a box it goes.", "knew you'd know.", "correct. i'm keeping score. (i'm not.)"];
const RIGHT_WHO = ["yes. that's them.", "right. you do pay attention.", "exactly who i thought."];
const WRONG = ["not that one. back in the first box.", "close. we'll see it again.", "i'd have said that too. we're both wrong."];
const WRONG_WHO = ["not them. easy mistake.", "no. i mixed them up too.", "wrong one. they'd be offended."];
const RIGHT_MOVES = ["cheer", "kudos", "goal"];
const WRONG_MOVES = ["nervous", "melt"];

const pick = <T,>(items: T[], seed: number) => items[Math.abs(seed) % items.length];

/**
 * The word quiz, a game in the Attic Arcade. Pip holds up a word the reader
 * once looked up and the reader picks its meaning from four (or the other way
 * round); in "Who is this?" she names someone from a character sheet and the
 * reader picks the note about them.
 *
 * Rounds of ten at most. A right answer moves the word up a box, a wrong one
 * back to the first (boxes.ts), and that is saved as it happens, so a round
 * left half way loses nothing. It earns nothing: no seeds, no mood.
 *
 * Keys: 1 to 4 pick an answer, Enter goes on.
 */
export const WordQuiz = ({ words, onChanged, onMyWords, skin, outfit }: WordQuizProps) => {
  const library = useLibraryStore((state) => state.books);
  const [people, setPeople] = useState<KnownPerson[]>([]);
  const [round, setRound] = useState<Round | null>(null);
  const [done, setDone] = useState<{ mode: Mode; right: number; of: number } | null>(null);
  // Counts rounds, so each is dealt differently and Pip's reactions replay.
  const plays = useRef(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const today = dayNumber(getDateKey());

  // The character sheets, for "Who is this?": only with the tracker on, and
  // only the books that have been opened. Each as far as that book was read.
  useEffect(() => {
    if (!peopleSwitchOn()) {
      return;
    }
    let current = true;
    const opened = useLibraryStore.getState().books.filter((book) => book.lastOpened || book.progress > 0);
    void Promise.all(
      opened.map((book) =>
        peopleService.list(book.id).then(
          (entries) => ({ bookId: book.id, title: book.title, progress: book.progress, entries }),
          () => null
        )
      )
    ).then((sheets) => {
      if (current) {
        setPeople(knownPeople(sheets.filter((sheet): sheet is NonNullable<typeof sheet> => sheet !== null && sheet.entries.length > 0)));
      }
    });
    return () => {
      current = false;
    };
  }, []);

  const whoOffered = useMemo(() => buildWhoRound(people, 1).length > 0, [people]);
  const enough = (words?.length ?? 0) >= MIN_WORDS;

  const start = (mode: Mode) => {
    plays.current += 1;
    const seed = (Date.now() ^ (plays.current * 7919)) >>> 0;
    const questions = mode === "words" ? buildRound(words ?? [], today, seed) : buildWhoRound(people, seed);
    if (questions.length === 0) {
      return;
    }
    setDone(null);
    setRound({ mode, questions, at: 0, picked: null, right: 0 });
  };

  const question = round ? round.questions[round.at] : null;

  const answer = (index: number) => {
    if (!round || !question || round.picked !== null) {
      return;
    }
    const right = index === question.answer;
    setRound({ ...round, picked: index, right: round.right + (right ? 1 : 0) });
    if (round.mode === "words") {
      const word = words?.find((entry) => entry.id === question.id);
      if (word) {
        // Saved as it happens. A save that fails costs one answer's memory, not the game.
        void wordService.review([answered(word, right, today)]).catch(() => undefined);
      }
    }
  };

  const next = () => {
    if (!round || round.picked === null) {
      return;
    }
    if (round.at + 1 < round.questions.length) {
      setRound({ ...round, at: round.at + 1, picked: null });
      return;
    }
    setDone({ mode: round.mode, right: round.right, of: round.questions.length });
    setRound(null);
    if (round.mode === "words") {
      onChanged();
      useLibraryStore.getState().requestBackup();
    }
  };

  // After an answer the way on is under the reader's finger; before one, the keys are the answers.
  useEffect(() => {
    if (round?.picked !== null && round) {
      nextRef.current?.focus();
    } else if (round) {
      rootRef.current?.focus();
    }
  }, [round]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!round || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const number = Number(event.key);
    if (round.picked === null && Number.isInteger(number) && number >= 1 && number <= (question?.options.length ?? 0)) {
      event.preventDefault();
      answer(number - 1);
    } else if (round.picked !== null && event.key === "Enter" && event.target === event.currentTarget) {
      event.preventDefault();
      next();
    }
  };

  if (words === null) {
    return <p className="pip-quiz-note">Fetching your words…</p>;
  }

  // ---- a question --------------------------------------------------------------------------
  if (round && question) {
    const answeredNow = round.picked !== null;
    const wasRight = round.picked === question.answer;
    const seed = plays.current * 31 + round.at;
    const who = question.way === "who";
    const says = !answeredNow ? pick(ASKS[question.way], seed) : wasRight ? pick(who ? RIGHT_WHO : RIGHT, seed) : pick(who ? WRONG_WHO : WRONG, seed);
    const move = !answeredNow ? "pointup" : wasRight ? pick(RIGHT_MOVES, seed) : pick(WRONG_MOVES, seed);
    const book = who ? question.context : library.find((entry) => entry.id === words.find((word) => word.id === question.id)?.bookId)?.title;
    return (
      <div ref={rootRef} className="pip-quiz" tabIndex={-1} onKeyDown={onKeyDown}>
        <p className="pip-quiz-count">
          {round.mode === "who" ? "Who is this?" : "Words"}: {round.at + 1} of {round.questions.length}
          <span className="pip-quiz-marks" aria-hidden="true">
            {round.questions.map((entry, index) => (
              <span key={entry.id + index} data-at={index === round.at || undefined} data-done={index < round.at || (index === round.at && answeredNow) || undefined} />
            ))}
          </span>
        </p>
        <div className="pip-quiz-stage">
          <PipSprite move={move} size={96} skin={skin} outfit={outfit} playKey={`${plays.current}-${round.at}-${answeredNow}`} />
          <div className="pip-quiz-card">
            <p className="pip-quiz-says">{says}</p>
            <p className="pip-quiz-prompt" data-long={question.way === "word" || undefined}>
              {question.prompt}
            </p>
            {book && <p className="pip-quiz-from">from {book}</p>}
          </div>
        </div>
        <ol className="pip-quiz-options" aria-label={question.way === "meaning" ? `What does “${question.prompt}” mean?` : question.way === "word" ? "Which word means this?" : `Who is ${question.prompt}?`}>
          {question.options.map((option, index) => (
            <li key={option}>
              <button
                type="button"
                className="pip-quiz-option"
                data-state={answeredNow ? (index === question.answer ? "right" : index === round.picked ? "wrong" : "other") : undefined}
                aria-disabled={answeredNow || undefined}
                onClick={() => answer(index)}
              >
                <kbd aria-hidden="true">{index + 1}</kbd>
                <span>{option}</span>
                {answeredNow && index === question.answer && <UiIcon name="check" size={16} />}
              </button>
            </li>
          ))}
        </ol>
        <div className="pip-quiz-foot">
          <p role="status" className="pip-quiz-result">
            {answeredNow ? (wasRight ? "Right." : `Not quite. It is: ${question.options[question.answer]}`) : "Press 1 to 4, or select an answer."}
          </p>
          {answeredNow && (
            <button ref={nextRef} type="button" className="pip-key pip-key-primary" onClick={next}>
              {round.at + 1 < round.questions.length ? "Next" : "Finish"}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ---- between rounds ------------------------------------------------------------------------
  const due = dueCount(words, today);
  const closing = done
    ? done.right === done.of
      ? "all of them. i'm a little afraid of you."
      : done.right * 2 >= done.of
        ? "good round. they're settling in."
        : "a rough one. they'll come round again."
    : null;
  return (
    <div className="pip-quiz">
      <div className="pip-quiz-stage">
        <PipSprite move={done ? (done.right === done.of ? "champ" : done.right * 2 >= done.of ? "kudos" : "tea") : "idea"} size={96} skin={skin} outfit={outfit} playKey={plays.current} />
        <div className="pip-quiz-card">
          {done ? (
            <>
              <p className="pip-quiz-says">{closing}</p>
              <p className="pip-quiz-prompt" role="status">
                {done.right} of {done.of} right
              </p>
              {done.mode === "words" && <p className="pip-quiz-from">Right answers moved up a box and rest longer. The others come back first.</p>}
            </>
          ) : enough ? (
            <>
              <p className="pip-quiz-says">i kept the words you looked up. shall we?</p>
              <p className="pip-quiz-from">
                {words.length} words kept, {due} due today. A round is {Math.min(10, words.length)} questions.
              </p>
            </>
          ) : (
            <>
              <p className="pip-quiz-says">{words.length === 0 ? "no words yet. i need four to make a game." : `${words.length} so far. i need four to make a game.`}</p>
              <p className="pip-quiz-from">
                To get words: select a word while reading and press Look up. A word that gets an answer is kept here with its meaning
                {wordsSwitchOn() ? "." : ". (Keeping words is switched off in Settings, under Reading.)"}
              </p>
            </>
          )}
        </div>
      </div>
      <div className="pip-quiz-menu">
        <button type="button" className="pip-key pip-key-primary" onClick={() => start("words")} disabled={!enough}>
          <UiIcon name="dictionary" size={15} />
          {done?.mode === "words" ? "Another round of words" : "Play: words"}
        </button>
        {whoOffered && (
          <button type="button" className="pip-key" onClick={() => start("who")}>
            <UiIcon name="who" size={15} />
            {done?.mode === "who" ? "Who is this? again" : "Play: who is this?"}
          </button>
        )}
        <button type="button" className="pip-key pip-key-quiet" onClick={onMyWords}>
          <UiIcon name="list" size={15} />
          My words ({words.length})
        </button>
      </div>
      <p className="pip-quiz-note">
        {whoOffered
          ? "“Who is this?” is made from your character sheets, and only from what you had read and written by where each book is now: it cannot spoil."
          : "The quiz earns nothing: no seeds, no mood. It is only for the words."}
      </p>
    </div>
  );
};
