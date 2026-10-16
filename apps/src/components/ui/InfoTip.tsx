import { UiIcon } from "../UiIcon";

/**
 * An (i) that holds the words a card leaves off the page (docs/android.md):
 * a pointer reads them on hover, a finger by a tap or a hold (TouchTips).
 */
export const InfoTip = ({ text, className = "" }: { text: string; className?: string }) => (
  <span
    role="img"
    tabIndex={0}
    aria-label={text}
    title={text}
    className={`inline-flex shrink-0 cursor-help items-center text-on-surface-variant hover:text-primary focus-visible:text-primary ${className}`}
  >
    <UiIcon name="info" size={14} />
  </span>
);
