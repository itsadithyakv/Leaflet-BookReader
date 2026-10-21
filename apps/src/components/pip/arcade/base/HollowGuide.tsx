import type { ReactNode } from "react";
import { ChevronLeft, Lock, ScrollText, X } from "lucide-react";
import { CHAPTER_HOURS, CHAPTER_OF } from "../../../../pip/base/chapters";
import { FRIEND_PRIZE, RAID_EVERY, STRETCH_MINUTES, TROPHY_MINUTES, oakDrops, type BaseState } from "../../../../pip/base/rules";
import { Sprite } from "./Sprite";
import { FrontPicture } from "./NightCard";
import { campOpened } from "./hollowRules";

/** The guide's pages, in the order a reader meets the things they are about. */
export type GuidePage = "acorns" | "chapters" | "buildings" | "prowlers" | "raids" | "heroes" | "friends" | "happened";

type Page = { id: GuidePage; name: string; picture: ReactNode; lines: string[]; locked?: string };

/**
 * The guide behind the (i) (1.5.10): how the Hollow works, a page a thing, each one picture and three short lines
 * at most; and "What happened", the camp's journal. It is where the explaining is, so that nothing on the camp's
 * own screen has to stand there explaining. A page about something a chapter has not brought yet says which.
 */
export const pagesOf = (base: BaseState, minutes: number): Page[] => {
  const drops = Math.max(1, Math.round(oakDrops(base)));
  const prowlers = campOpened(base, minutes, "prowlers");
  const raids = campOpened(base, minutes, "raids");
  return [
    {
      id: "acorns",
      name: "Acorns",
      picture: <Sprite name="oak" variant={Math.max(1, base.levels.oak)} box={64} />,
      lines: [
        `Reading earns them: the oak drops ${drops} for every 10 minutes you read. Tap it to collect.`,
        `A sitting of ${STRETCH_MINUTES} minutes or more, and each day's goal met, sends a parcel of them up the path.`,
        "They build everything here, and nothing is lost if you stay away."
      ]
    },
    {
      id: "chapters",
      name: "Chapters",
      picture: <Sprite name="burrow" variant={Math.max(1, base.levels.burrow)} box={64} />,
      lines: [
        `Your camp grows with the hours you read: chapter 2 at ${CHAPTER_HOURS[1]} h, chapter 5 at ${CHAPTER_HOURS[4]} h, chapter 10 at ${CHAPTER_HOURS[9]} h.`,
        "Each chapter brings one new thing and a chest of acorns. After the tenth, a volume every 15 h.",
        "Its goals are optional, and pay acorns."
      ]
    },
    {
      id: "buildings",
      name: "Buildings",
      picture: <Sprite name="tower" variant={Math.max(1, base.levels.tower)} box={64} />,
      lines: [
        "Tap a building to see what its next level does, and upgrade it there.",
        "Nothing goes higher than the burrow, and the burrow grows with your chapters.",
        "Hold anything a moment to move it. Edit lays out the fence."
      ]
    },
    {
      id: "prowlers",
      name: "Prowlers",
      picture: <FrontPicture box={72} locked={!prowlers} />,
      locked: prowlers ? undefined : `Chapter ${CHAPTER_OF.prowlers}`,
      lines: [
        "Prowlers come down the trail from the Dark Wood, most of them at night.",
        "A wall across it and towers behind it keep them out. Traps go on the trail.",
        "Each kind has one thing that beats it: at dusk, tap tonight's faces to see."
      ]
    },
    {
      id: "raids",
      name: "Raids",
      picture: <Sprite name="nest" variant={0} box={64} className={raids ? "" : "is-locked"} />,
      locked: raids ? undefined : `Chapter ${CHAPTER_OF.raids}`,
      lines: [
        `Every ${RAID_EVERY} minutes you read rests the scouts for a raid on the magpies' strongholds.`,
        "Fight it yourself, or Send them when they would win. Three stars pay a bonus.",
        "A raid lost costs nothing but the scouts' rest."
      ]
    },
    {
      id: "heroes",
      name: "Heroes",
      picture: <Sprite name="hero" variant={0} box={64} />,
      lines: [
        `Finish a book with ${Math.round(TROPHY_MINUTES / 6) / 10} h of reading behind it, and its trophy stands in the camp.`,
        "A trophy of the right kind brings a hero to live here. One leads each raid.",
        "Blades won from the magpie lords are carried by heroes."
      ]
    },
    {
      id: "friends",
      name: "Friends",
      picture: <Sprite name="burrow" variant={3} box={64} />,
      lines: [
        `Raid a friend's camp once a day, just for fun: ${FRIEND_PRIZE} acorns a star.`,
        "If you let friends raid yours, nothing is taken: fence that falls goes back with one tap.",
        "Your camp is on your profile, and the menu makes a postcard of it."
      ]
    }
  ];
};

type HollowGuideProps = {
  base: BaseState;
  minutes: number;
  page: GuidePage | null;
  onPage: (page: GuidePage | null) => void;
  onClose: () => void;
  /** "What happened": the journal, the camp's tallies, the clubs, the tales. */
  happened: ReactNode;
};

export const HollowGuide = ({ base, minutes, page, onPage, onClose, happened }: HollowGuideProps) => {
  const pages = pagesOf(base, minutes);
  const open = page === "happened" ? null : (pages.find((entry) => entry.id === page) ?? null);
  return (
    <div className="pip-base-enter pip-base-sheet pip-guide" role="dialog" aria-label="The guide">
      <button type="button" className="pip-base-round pip-base-sheet-close" aria-label="Back to the camp" title="Back to the camp" onClick={onClose}>
        <X size={16} aria-hidden />
      </button>
      <div className="pip-guide-tabs" role="tablist" aria-label="Pages">
        {pages.map((entry) => (
          <button key={entry.id} type="button" role="tab" aria-selected={page === entry.id} className={`pip-guide-tab ${page === entry.id ? "is-chosen" : ""}`} onClick={() => onPage(entry.id)}>
            {entry.name}
            {entry.locked && <Lock size={10} aria-hidden />}
          </button>
        ))}
        <button type="button" role="tab" aria-selected={page === "happened"} className={`pip-guide-tab is-journal ${page === "happened" ? "is-chosen" : ""}`} onClick={() => onPage("happened")}>
          <ScrollText size={12} aria-hidden />
          What happened
        </button>
      </div>
      {page === "happened" ? (
        <div className="pip-guide-journal">{happened}</div>
      ) : open ? (
        <article className="pip-guide-page" aria-label={open.name}>
          <span className="pip-guide-pic" aria-hidden="true">
            {open.picture}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="pip-guide-title">
              {open.name}
              {open.locked && <span className="pip-guide-locked">{open.locked}</span>}
            </h3>
            <ul className="pip-guide-lines">
              {open.lines.slice(0, 3).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </article>
      ) : (
        <div className="pip-guide-index">
          {pages.map((entry) => (
            <button key={entry.id} type="button" className="pip-guide-card" onClick={() => onPage(entry.id)}>
              <span className="pip-guide-card-pic" aria-hidden="true">
                {entry.picture}
              </span>
              <span className="pip-guide-card-name">{entry.name}</span>
              {entry.locked && <span className="pip-guide-locked">{entry.locked}</span>}
            </button>
          ))}
          <button type="button" className="pip-guide-card is-journal" onClick={() => onPage("happened")}>
            <span className="pip-guide-card-pic" aria-hidden="true">
              <ScrollText size={30} />
            </span>
            <span className="pip-guide-card-name">What happened</span>
          </button>
        </div>
      )}
      {page !== null && (
        <button type="button" className="pip-guide-back tactile-button flex items-center gap-1 px-2.5 py-1 text-xs" onClick={() => onPage(null)}>
          <ChevronLeft size={13} aria-hidden /> All pages
        </button>
      )}
    </div>
  );
};
