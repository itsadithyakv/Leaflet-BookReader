import type { ReactNode } from "react";

/**
 * The small uppercase label above a heading, and above a field or a stat.
 * One style, so every card and form on a page lines up.
 */
export const EYEBROW = "text-[11px] font-semibold uppercase tracking-[0.18em] text-on-surface-variant";

type SectionHeaderProps = {
  eyebrow: string;
  title: ReactNode;
  /** Used for the section's `aria-labelledby`. */
  id?: string;
  /** Anything that sits to the right: tabs, a countdown, a button. */
  actions?: ReactNode;
  className?: string;
  /** False where the eyebrow only explains the heading: a phone, short of room, leaves it out. */
  eyebrowOnPhone?: boolean;
};

/** A card's heading: eyebrow, title and, optionally, controls on the right. */
export const SectionHeader = ({ eyebrow, title, id, actions, className = "", eyebrowOnPhone = true }: SectionHeaderProps) => (
  <div className={`flex flex-wrap items-end justify-between gap-3 ${className}`}>
    <div className="min-w-0">
      <p className={`${EYEBROW} ${eyebrowOnPhone ? "" : "phone-hidden"}`}>{eyebrow}</p>
      <h2 id={id} className={`page-title text-2xl ${eyebrowOnPhone ? "mt-2" : "phone-flush mt-2"}`}>
        {title}
      </h2>
    </div>
    {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
  </div>
);
