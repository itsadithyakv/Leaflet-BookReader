import type { MoodReport } from "../../pip/mood";
import { UiIcon } from "../../components/UiIcon";

type MoodPanelProps = {
  report: MoodReport;
  /** The hearts shown in the top bar, in halves. */
  hearts: number;
  /** Opens the ways to play with Pip. */
  onPlay: () => void;
  /** Opens Pip's snacks. */
  onSnacks: () => void;
};

const TONE_ICON = { down: "down", up: "up", plain: "moon" } as const;

/**
 * Pip's mood, explained: how she is, why (what is really acting on it now),
 * what changed it last, and what would lift it. Every line comes from
 * pip/mood.ts, which only puts Rust's numbers into words.
 */
export const MoodPanel = ({ report, hearts, onPlay, onSnacks }: MoodPanelProps) => (
  <div className="pip-mood">
    <p className="pip-mood-now">
      <span className="font-headline text-3xl font-bold text-on-surface">{report.word}</span>
      <span className="pip-hearts" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((index) => (
          <span key={index} className="pip-heart" data-fill={hearts >= index + 1 ? "full" : hearts > index ? "half" : "empty"}>
            <UiIcon name="heart" size={15} />
          </span>
        ))}
      </span>
      <span className="text-xs tabular-nums text-on-surface-variant">{report.level} / 100</span>
    </p>
    {/* A meter as well as hearts: the number is what the reasons below add up to. */}
    <div className="pip-mood-meter" role="img" aria-label={`Mood ${report.level} out of 100`}>
      <span style={{ width: `${report.level}%` }} />
    </div>

    <h3 className="pip-mood-heading">Why</h3>
    <ul className="pip-mood-list">
      {report.why.map((line) => (
        <li key={line.id} data-tone={line.tone}>
          <UiIcon name={TONE_ICON[line.tone]} size={14} />
          <span>{line.text}</span>
        </li>
      ))}
    </ul>

    <h3 className="pip-mood-heading">Last change</h3>
    <p className="pip-mood-text">{report.last ?? "Nothing has cheered her up on this computer since the mood began keeping notes."}</p>

    <h3 className="pip-mood-heading">What would lift it</h3>
    {report.lifts.length > 0 ? (
      <ul className="pip-mood-list">
        {report.lifts.map((lift) => (
          <li key={lift.id} data-tone="up">
            <UiIcon name="heart" size={14} />
            <span>{lift.text}</span>
          </li>
        ))}
      </ul>
    ) : (
      <p className="pip-mood-text">She is as happy as she gets.</p>
    )}
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" className="pip-key pip-key-small" onClick={onPlay}>
        <UiIcon name="hand" size={14} />
        Play with Pip
      </button>
      <button type="button" className="pip-key pip-key-small" onClick={onSnacks}>
        <UiIcon name="treat" size={14} />
        Snacks
      </button>
    </div>

    <p className="pip-mood-rule">{report.rule}</p>
  </div>
);
