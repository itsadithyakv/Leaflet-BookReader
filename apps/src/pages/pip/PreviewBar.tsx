import type { ShopEntry } from "../../components/pip/PipShop";
import { shortfall } from "../../components/pip/shopParts";
import { plural } from "./common";

type PreviewBarProps = {
  /** What is being tried on. */
  entry: ShopEntry;
  /** Seeds to spend now. */
  spendable: number;
  onBuy: () => void;
  /** Ends the preview, back to the shop or not. */
  endPreview: (back: boolean) => void;
};

/** Over the house while a look from the shop is tried on Pip: buy it, go back to the shop, or be done. */
export const PreviewBar = ({ entry, spendable, onBuy, endPreview }: PreviewBarProps) => (
  <div className="pip-preview-bar" role="status">
    <span className="text-sm">
      Trying on <strong>{entry.name}</strong>
    </span>
    {!entry.owned && spendable < entry.price && (
      <span className="text-xs text-on-surface-variant">
        {plural(entry.price - spendable, "more seed")} · ~{shortfall(entry.price, spendable)?.minutes} min of reading
      </span>
    )}
    {!entry.owned && spendable >= entry.price && !entry.locked && (
      <button type="button" className="pip-key pip-key-primary pip-key-small" onClick={() => onBuy()}>
        Buy for {entry.price}
      </button>
    )}
    <button type="button" className="pip-key pip-key-small" onClick={() => endPreview(true)}>
      Back to the shop
    </button>
    <button type="button" className="pip-key pip-key-small" onClick={() => endPreview(false)}>
      Done
    </button>
  </div>
);
