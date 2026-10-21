import { useEffect, useRef, useState, type ReactNode } from "react";
import { Camera, Check, Move, Nut, X } from "lucide-react";
import { useBackLayer } from "../../../../platform/back";
import { playSound } from "../../../../pip/sound";
import { CHAPTERS_MOST, chapterBrings, hoursWords, UNLOCK_NAMES, type ChapterNews, type GoalAt, type GoalState, type Unlock } from "../../../../pip/base/chapters";
import { Sprite } from "./Sprite";
import { FoeFace } from "./NightCard";
import { COUNTER, ROLE_DOES, ROLE_NAMES, rolesNewAt } from "../../../../pip/base/front";
import { WORKS } from "../../../../pip/base/guards";
import type { ChapterCardView } from "./hollowRules";
import "./ladder.css";

/** A thing a chapter opens, as a picture: the camp's own sprites (a camera and arrows where there is none). */
export const unlockPicture = (thing: Unlock | "clearing0", box: number): ReactNode => {
  switch (thing) {
    case "hut":
      return <Sprite name="hut" variant={1} box={box} />;
    case "raids":
      return <Sprite name="nest" variant={0} box={box} />;
    case "lookout":
      return <Sprite name="tower" variant={1} box={box} />;
    case "prowlers":
      return <Sprite name="foe" variant={4} box={box} />;
    case "postcard":
      return <Camera size={Math.round(box * 0.6)} aria-hidden />;
    case "fence":
      return <Sprite name="fencepiece" variant={1} box={box} />;
    case "arrange":
      return <Move size={Math.round(box * 0.6)} aria-hidden />;
    case "yard0":
      return <Sprite name="workshop" variant={1} box={box} />;
    case "decor":
      return <Sprite name="decor" variant={0} box={box} />;
    case "guards":
      return <Sprite name="guardian" variant={3} box={box} />;
    case "meadow":
      return <Sprite name="land" variant={4} box={box} />;
    case "animals":
      return <Sprite name="animal" variant={0} box={box} />;
    case "works":
      return <Sprite name="work" variant={10} box={box} />;
    case "yard1":
      return <Sprite name="hive" variant={1} box={box} />;
    case "king":
      return <Sprite name="king" box={box} />;
    case "banners":
      return <Sprite name="banner" variant={1} box={box} />;
    case "clearing":
      return <Sprite name="burrow" variant={5} box={box} />;
    case "volumes":
      return <Sprite name="trophy" variant={0} box={box} />;
    default:
      return <Sprite name="burrow" variant={1} box={box} />;
  }
};

/** What a chapter opens, in the order a reader should hear of it: prowlers first (they arrive whether wanted or not). */
export const thingsOf = (chapter: number): Unlock[] => {
  const things = chapterBrings(chapter).things;
  return [...things].sort((a, b) => (a === "prowlers" ? -1 : b === "prowlers" ? 1 : 0));
};

/** Everything a chapter opens, each its picture and its name. */
export const ChapterThings = ({ chapter, dim = false }: { chapter: number; dim?: boolean }) => {
  const things = thingsOf(chapter);
  if (things.length === 0 && rolesNewAt(chapter).length === 0) return null;
  return (
    <span className={`pip-chapter-things ${dim ? "is-dim" : ""}`} role="list" aria-label={`Chapter ${chapter} brings`}>
      {things.map((thing) => (
        <span key={thing} className="pip-chapter-thing" role="listitem">
          <span className="pip-chapter-thing-pic" aria-hidden="true">
            {unlockPicture(thing, 24)}
          </span>
          {UNLOCK_NAMES[thing]}
        </span>
      ))}
      {/* (1.5.11) Who starts coming down the trail with this chapter, and what beats them. */}
      {rolesNewAt(chapter)
        .filter((role) => COUNTER[role] !== null)
        .map((role) => (
          <span key={role} className="pip-chapter-thing pip-chapter-pair" role="listitem" title={`${ROLE_DOES[role]}. The ${WORKS[COUNTER[role]!].name.toLowerCase()} beats them.`}>
            <span className="pip-chapter-thing-pic" aria-hidden="true">
              <FoeFace kind={role} box={22} />
            </span>
            {ROLE_NAMES[role].many[0].toUpperCase() + ROLE_NAMES[role].many.slice(1)}
            <span className="pip-chapter-pair-arrow" aria-hidden="true">
              ›
            </span>
            <span className="pip-chapter-thing-pic" aria-hidden="true">
              <Sprite name="work" variant={COUNTER[role]!} box={22} />
            </span>
            {WORKS[COUNTER[role]!].name}
          </span>
        ))}
    </span>
  );
};

type ChapterCardProps = {
  view: ChapterCardView;
  /** The chapter just reached (or the camp brought onto chapters): the card is its celebration, once. */
  news: ChapterNews | null;
  onGo: (at: GoalAt) => void;
  /** The chest is opened: its acorns fly from it to the count (they are in the larder already). */
  onChest: (from: Element, acorns: number) => void;
  onClose: () => void;
};

const firstThing = (chapter: number): Unlock | "clearing0" => thingsOf(chapter).find((thing) => thing !== "prowlers") ?? thingsOf(chapter)[0] ?? "clearing0";

/**
 * The chapter's card (1.5.10): a tap on the chapter bar, and once on reaching a chapter its celebration. The big
 * pixel title, the one new thing with its picture, the acorn chest, the chapter's goals (each a way to where it is
 * done), and the next chapter's thing as a silhouette with the reading still to do.
 */
export const ChapterCard = ({ view, news, onGo, onChest, onClose }: ChapterCardProps) => {
  useBackLayer(true, onClose);
  const chapter = news?.chapter ?? view.chapter;
  const brings = news?.brings ?? view.current;
  const [opened, setOpened] = useState(false);
  const chestRef = useRef<HTMLButtonElement | null>(null);
  const celebrating = news !== null;
  useEffect(() => {
    if (celebrating) playSound("fanfare", { volume: 0.7 });
  }, [celebrating]);
  const openChest = () => {
    if (opened || !news || !chestRef.current) return;
    setOpened(true);
    playSound("pop", { volume: 0.6 });
    onChest(chestRef.current, news.chest);
  };
  const volume = chapter > CHAPTERS_MOST;
  const goals = [...view.older, ...view.goals];
  const nextThing = firstThing(view.next.chapter);
  return (
    <div className="pip-chapter-shade" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`pip-chapter-card ${celebrating ? "is-news" : ""}`} role="dialog" aria-label={brings.title} aria-modal="false">
        <button type="button" className="pip-ladder-close pip-chapter-close" aria-label="Close" onClick={onClose}>
          <X size={14} aria-hidden />
        </button>
        <p className="pip-chapter-over">{news?.kind === "welcome" ? "Your camp, in chapters" : celebrating ? (volume ? "A new volume!" : "A new chapter!") : `${hoursWords(view.read)} read`}</p>
        <h3 className="pip-chapter-title">
          {volume ? (
            brings.title
          ) : (
            <>
              <span className="pip-chapter-title-n">Chapter {chapter}</span>
              <span className="pip-chapter-title-dot" aria-hidden="true">
                ·
              </span>
              <span className="pip-chapter-title-name">{brings.name}</span>
            </>
          )}
        </h3>
        {news?.kind === "welcome" && <p className="pip-chapter-note">Your camp is now counted in chapters: {volume ? brings.title : `Chapter ${chapter}`}, {hoursWords(view.read)} read.</p>}
        <div className="pip-chapter-body">
        <div className="pip-chapter-main">
        <div className="pip-chapter-new">
          <span className="pip-chapter-new-pic" aria-hidden="true">
            {unlockPicture(firstThing(chapter), 56)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="pip-chapter-new-says">{brings.says}</span>
            <ChapterThings chapter={chapter} />
          </span>
        </div>
        {news && news.chest > 0 && (
          <button
            ref={chestRef}
            type="button"
            className={`pip-chapter-chest ${opened ? "is-open" : ""}`}
            aria-label={opened ? `${news.chest} acorns, in the larder` : `Open the chest: ${news.chest} acorns`}
            onClick={openChest}
            disabled={opened}
          >
            <span className="pip-chapter-chest-pic" aria-hidden="true">
              <Sprite name="hoard" variant={0} box={34} />
            </span>
            <span className="pip-chapter-chest-text">{opened ? "In the larder" : "Open the chest"}</span>
            <span className="pip-chapter-chest-n">
              <Nut size={13} aria-hidden />+{news.chest}
            </span>
          </button>
        )}
        </div>
        <div className="pip-chapter-side">
        {goals.length > 0 && (
          <>
            <p className="pip-sheet-label">Goals</p>
            <span className="pip-ladder-steps" role="list">
              {goals.map((entry) => (
                <GoalRow key={entry.goal.id} entry={entry} onGo={(at) => onGo(at)} />
              ))}
            </span>
          </>
        )}
        <div className="pip-chapter-next">
          <span className="pip-chapter-next-pic" aria-hidden="true">
            {unlockPicture(nextThing, 34)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="pip-chapter-next-when">Read {hoursWords(view.toGo)} more</span>
            <span className="pip-chapter-next-what">{view.next.title}</span>
          </span>
        </div>
        </div>
        </div>
      </section>
    </div>
  );
};

const GoalRow = ({ entry, onGo }: { entry: GoalState; onGo: (at: GoalAt) => void }) => {
  const done = entry.done || entry.ticked;
  return (
    <span role="listitem" className={`pip-ladder-step ${done ? "is-done" : "is-now"}`}>
      <span className="pip-ladder-mark" aria-hidden="true">
        {done ? <Check size={12} strokeWidth={3} /> : null}
      </span>
      {done ? (
        <span className="pip-ladder-text">{entry.goal.text}</span>
      ) : (
        <button type="button" className="pip-ladder-text pip-ladder-go" title="Show me where" onClick={() => onGo(entry.goal.at)}>
          {entry.goal.text}
        </button>
      )}
      {entry.goal.reward > 0 && (
        <span className="pip-ladder-step-reward">
          <Nut size={11} aria-hidden />+{entry.goal.reward}
          <span className="sr-only"> acorns</span>
        </span>
      )}
    </span>
  );
};
