import { FOCUS_DOUBLE_TIP } from "./focusDeal";
import "./focus.css";

/** The "2×" on a Focus key: the deal, with its words in the tooltip. */
export const FocusDouble = ({ className = "" }: { className?: string }) => (
  <span className={`focus-double ${className}`.trim()} title={FOCUS_DOUBLE_TIP} aria-label={FOCUS_DOUBLE_TIP} role="img">
    2×
  </span>
);
