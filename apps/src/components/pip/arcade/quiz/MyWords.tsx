import { useState } from "react";
import { UiIcon } from "../../../UiIcon";
import { openInBook } from "../../../highlights/highlightsStore";
import { dayNumber } from "../../../../pip/diary/seed";
import { MAX_BOX, type SavedWord } from "../../../../readers/words/rows";
import { wordsSwitchOn } from "../../../../readers/words/wordPrefs";
import { getDateKey } from "../../../../services/habitService";
import { wordService } from "../../../../services/wordService";
import { useLibraryStore } from "../../../../store/libraryStore";
import { isDue } from "./boxes";
import "./quiz.css";

type MyWordsProps = {
  /** The reader's words, the most recently looked up first; null while they are being fetched. */
  words: SavedWord[] | null;
  /** A word was removed: the list is asked for again. */
  onChanged: () => void;
  /** A word's place was opened in its book: the arcade steps aside. */
  onOpened: () => void;
};

/** How well a word is known, as the quiz's boxes have it. */
const standing = (word: SavedWord, today: number) =>
  word.due === null ? "Not asked yet" : word.box >= MAX_BOX ? "Known" : isDue(word, today) ? `Box ${word.box + 1} of ${MAX_BOX + 1}, due` : `Box ${word.box + 1} of ${MAX_BOX + 1}`;

/**
 * "My words": every word the reader looked up that got an answer, the newest
 * first, with the meaning that was shown, the book and a way back to the
 * place. A word can be removed (it then leaves the quiz and the backup).
 */
export const MyWords = ({ words, onChanged, onOpened }: MyWordsProps) => {
  const library = useLibraryStore((state) => state.books);
  const [asking, setAsking] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const today = dayNumber(getDateKey());

  const remove = async (word: SavedWord) => {
    setFailed(null);
    try {
      await wordService.remove([word.id]);
      useLibraryStore.getState().requestBackup();
      setAsking(null);
      onChanged();
    } catch {
      setFailed(`“${word.word}” couldn't be removed. Try again.`);
    }
  };

  if (words === null) {
    return <p className="pip-quiz-note">Fetching your words…</p>;
  }
  if (words.length === 0) {
    return (
      <div className="pip-quiz">
        <p className="pip-words-empty">
          No words yet. Select a word while reading and press Look up: a word that gets an answer is kept here, with its meaning and its place in the book
          {wordsSwitchOn() ? "." : ". (Keeping words is switched off in Settings, under Reading.)"}
        </p>
      </div>
    );
  }
  return (
    <div className="pip-quiz">
      {failed && (
        <p className="pip-quiz-note" role="alert">
          {failed}
        </p>
      )}
      <ul className="pip-words" aria-label={`My words: ${words.length}`}>
        {words.map((word) => {
          const book = library.find((entry) => entry.id === word.bookId);
          const where = [book?.title ?? "A book no longer in the library", word.at.chapter, `${Math.round(word.at.p * 100)}%`].filter(Boolean).join(" · ");
          return (
            <li key={word.id} className="pip-word">
              <div className="pip-word-head">
                <strong className="pip-word-name">{word.word}</strong>
                {word.part && <span className="pip-word-part">{word.part}</span>}
                {word.count > 1 && <span className="pip-word-part">looked up {word.count} times</span>}
                <span className="pip-word-box">{standing(word, today)}</span>
              </div>
              <p className="pip-word-meaning">{word.meaning}</p>
              <p className="pip-word-where">{where}</p>
              <div className="pip-word-keys">
                {asking === word.id ? (
                  <>
                    <span className="pip-word-ask">Remove “{word.word}” from your words?</span>
                    <button type="button" className="pip-key pip-key-small" onClick={() => void remove(word)}>
                      Remove
                    </button>
                    <button type="button" className="pip-key pip-key-small pip-key-quiet" onClick={() => setAsking(null)}>
                      Keep
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="pip-key pip-key-small"
                      disabled={!book}
                      onClick={() => {
                        openInBook(word.bookId, word.at.cfi);
                        onOpened();
                      }}
                      aria-label={`Open ${book?.title ?? "the book"} where “${word.word}” was looked up`}
                    >
                      <UiIcon name="library" size={13} />
                      Open in book
                    </button>
                    <button type="button" className="pip-key pip-key-small pip-key-quiet" onClick={() => setAsking(word.id)} aria-label={`Remove “${word.word}”`}>
                      <UiIcon name="trash" size={13} />
                      Remove
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="pip-quiz-note">Kept on this device and in your backup. Removing a word takes it out of both, and out of the quiz.</p>
    </div>
  );
};
