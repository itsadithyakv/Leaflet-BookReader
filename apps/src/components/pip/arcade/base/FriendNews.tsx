import { Star, Swords, X } from "lucide-react";
import type { RaidNews } from "../../../../pip/base/rules";
import { Sprite } from "./Sprite";

const stars = (count: number) => (
  <span className="pip-base-stars" aria-label={`${count} of 3 stars`}>
    {[0, 1, 2].map((index) => (
      <Star key={index} size={12} aria-hidden fill={index < count ? "currentColor" : "none"} className={index < count ? "is-won" : ""} />
    ))}
  </span>
);

type FriendNewsProps = {
  news: RaidNews[];
  /** Fence pieces knocked down that can go back where they stood. */
  canPutBack: boolean;
  onPutBack: () => void;
  /** Raids (and the friend's camp among the targets), where there is a hut to raid from. */
  onRaidBack: (() => void) | null;
  onClose: () => void;
};

/**
 * Friends' raids on this camp, once, on opening the Hollow (1.5.10): who came and how it went, in a line each.
 * "Maya raided your camp ★★☆ · 2 fence pieces fell [Put them back] [Raid back]", or "Tom's scouts bounced off your
 * fence! +8". Nothing is taken: fence that fell goes back in one tap, and nobody is put to sleep.
 */
export const FriendNews = ({ news, canPutBack, onPutBack, onRaidBack, onClose }: FriendNewsProps) => {
  const fell = news.reduce((sum, entry) => sum + (entry.stars > 0 ? entry.down : 0), 0);
  const raided = news.some((entry) => entry.stars > 0);
  return (
    <section className="pip-news-card" role="status" aria-label="Friends' raids">
      <button type="button" className="pip-ladder-close pip-news-close" aria-label="Close" onClick={onClose}>
        <X size={14} aria-hidden />
      </button>
      <ul className="pip-news-lines">
        {news.slice(0, 3).map((entry, index) => (
          <li key={`${entry.by}-${entry.day}-${index}`}>
            <Sprite name={entry.stars > 0 ? "scout" : "fencepiece"} variant={1} box={20} />
            {entry.stars > 0 ? (
              <span className="min-w-0 flex-1">
                <strong>{entry.by}</strong> raided your camp {stars(entry.stars)}
                {entry.down > 0 ? ` · ${entry.down} fence ${entry.down === 1 ? "piece" : "pieces"} fell` : ""}
              </span>
            ) : (
              <span className="min-w-0 flex-1">
                <strong>{entry.by}</strong>'s scouts bounced off your camp!
                {entry.prize > 0 && (
                  <span className="pip-base-acorns pip-news-prize">
                    <Sprite name="acorn" box={13} />+{entry.prize}
                    <span className="sr-only"> acorns</span>
                  </span>
                )}
              </span>
            )}
          </li>
        ))}
        {news.length > 3 && <li className="pip-news-more">and {news.length - 3} more</li>}
      </ul>
      <span className="pip-news-keys">
        {fell > 0 && canPutBack && (
          <button type="button" className="tactile-button tactile-button-primary px-3 py-1 text-xs font-semibold" onClick={onPutBack}>
            Put {fell === 1 ? "it" : "them"} back
          </button>
        )}
        {raided && onRaidBack && (
          <button type="button" className="tactile-button flex items-center gap-1.5 px-3 py-1 text-xs" onClick={onRaidBack}>
            <Swords size={12} aria-hidden /> Raid back
          </button>
        )}
        {!(fell > 0 && canPutBack) && !(raided && onRaidBack) && (
          <button type="button" className="tactile-button px-3 py-1 text-xs" onClick={onClose}>
            Lovely
          </button>
        )}
      </span>
    </section>
  );
};
