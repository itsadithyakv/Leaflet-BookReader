import { Fragment } from "react";
import type { Book } from "@shared/models/book";
import { isFinished } from "../../constants/books";
import { useCoverSrc } from "../../hooks/useCoverSrc";
import { seriesNumberLabel, type SeriesGroup, type SeriesMember } from "../../library/series";
import { BookMenu } from "../BookMenu";
import { EYEBROW } from "../ui/SectionHeader";

const status = (book: Book) => {
  if (isFinished(book.progress)) {
    return { label: "Finished", tone: "text-tertiary" };
  }
  if ((book.progress ?? 0) > 0) {
    return { label: `${Math.round(book.progress * 100)}%`, tone: "text-primary" };
  }
  return { label: "Not started", tone: "text-on-surface-variant" };
};

/** Beside a book the series can be read without: its kind, and that it may be skipped. */
const OPTIONAL_CHIP = "hidden rounded-full border border-outline-variant/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant sm:inline";
const optionalHint = (kind: string) => `${kind}: beside the main series, and can be skipped`;

const MemberRow = ({ member, isNext, onOpen }: { member: SeriesMember; isNext: boolean; onOpen: (book: Book) => void }) => {
  const { book, index } = member;
  const { src, onError } = useCoverSrc(book, { thumb: true });
  const state = status(book);
  return (
    <li
      className={`ledger-row flex cursor-pointer items-center gap-4 p-3 ${isNext ? "ring-1 ring-primary/40" : ""}`}
      onClick={() => onOpen(book)}
    >
      <span className="w-10 shrink-0 text-center font-serif text-2xl text-on-surface-variant tabular-nums">
        {index != null ? Number(index.toFixed(2)) : "–"}
      </span>
      <div className="book-cover-frame h-16 w-11 shrink-0 overflow-hidden bg-surface-container-high">
        {src && <img src={src} alt="" className="h-full w-full object-cover" onError={onError} />}
      </div>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          className="book-title block max-w-full truncate text-left text-base text-on-surface hover:underline"
          onClick={(event) => {
            event.stopPropagation();
            onOpen(book);
          }}
        >
          {book.title}
        </button>
        <p className="truncate text-xs text-on-surface-variant">{book.author ?? "Unknown author"}</p>
      </div>
      {member.extra && (
        <span className={OPTIONAL_CHIP} title={optionalHint(member.extra)}>
          {member.extra} · optional
        </span>
      )}
      {isNext && <span className="hidden rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary sm:inline">Next</span>}
      <span className={`w-20 shrink-0 text-right text-[11px] font-bold uppercase tracking-tight ${state.tone}`}>{state.label}</span>
      <div onClick={(event) => event.stopPropagation()}>
        <BookMenu book={book} />
      </div>
    </li>
  );
};

type Props = {
  group: SeriesGroup;
  onOpen: (book: Book) => void;
};

/** One series in order: the books there are, the ones that are not, and what is next. */
export const SeriesDetail = ({ group, onOpen }: Props) => {
  const total = group.total ?? group.ownedCount + group.missing.length;
  const percent = total > 0 ? Math.round((group.finishedCount / total) * 100) : 0;
  const nextMember = group.members.find((member) => member.book.id === group.next?.id) ?? null;

  // Books and the gaps between them, in one list by number.
  type Row = { kind: "book"; member: SeriesMember } | { kind: "missing"; index: number; title: string | null; extra?: string };
  const numberOf = (row: Row) => (row.kind === "book" ? row.member.index : row.index);
  const rows: Row[] = [
    ...group.members.map((member) => ({ kind: "book" as const, member })),
    ...group.missing.map((entry) => ({ kind: "missing" as const, ...entry })),
    ...group.missingExtras.map((entry) => ({ kind: "missing" as const, index: entry.index, title: entry.title, extra: entry.kind }))
  ].sort((a, b) => (numberOf(a) ?? Number.POSITIVE_INFINITY) - (numberOf(b) ?? Number.POSITIVE_INFINITY));

  // A series in parts (two eras, a trilogy and its prequels) says where each
  // begins: above the first row that is in it.
  const partOf = (row: Row) => {
    const number = numberOf(row);
    return number === null ? null : group.parts.find((part) => number >= part.from && number < part.to + 1) ?? null;
  };
  const opensPart = (row: Row, at: number) => {
    const part = partOf(row);
    return part && (at === 0 || partOf(rows[at - 1]) !== part) ? part : null;
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="paper-surface flex flex-wrap items-center gap-6 rounded-xl p-5">
        <div className="min-w-0 flex-1">
          <p className={EYEBROW}>Series{group.author ? ` · ${group.author}` : ""}</p>
          <p className="mt-2 text-sm text-on-surface-variant">
            {group.finishedCount} of {total} read
            {group.total !== null && group.ownedCount < group.total && ` · ${group.ownedCount} of ${group.total} in your library`}
          </p>
          <div className="mt-3 h-1.5 w-full max-w-md rounded-full bg-surface-container-highest">
            <div className="h-1.5 rounded-full bg-tertiary" style={{ width: `${percent}%` }} />
          </div>
        </div>
        {group.next ? (
          <button
            type="button"
            className="tactile-button tactile-button-primary px-5 py-2.5 text-sm font-semibold"
            onClick={() => onOpen(group.next as Book)}
          >
            {(group.next.progress ?? 0) > 0 ? "Continue" : "Start"}
            {nextMember?.index != null ? ` ${seriesNumberLabel(nextMember.index)}` : ""}: {group.next.title}
          </button>
        ) : (
          <p className="text-sm font-semibold text-tertiary">Every book here is finished.</p>
        )}
      </div>

      <ol className="flex flex-col gap-3">
        {rows.map((row, at) => {
          const part = opensPart(row, at);
          return (
            <Fragment key={row.kind === "book" ? row.member.book.id : `missing-${row.index}`}>
              {part && (
                <li className={`flex items-baseline justify-between gap-4 px-1 ${at === 0 ? "" : "mt-4"}`}>
                  <h3 className={EYEBROW}>{part.name}</h3>
                  <span className="text-xs text-on-surface-variant tabular-nums">
                    {part.from === part.to ? `Book ${part.from}` : `Books ${part.from}–${part.to}`}
                  </span>
                </li>
              )}
              {row.kind === "book" ? (
                <MemberRow member={row.member} isNext={row.member.book.id === group.next?.id} onOpen={onOpen} />
              ) : (
                <li
                  className={`flex items-center gap-4 rounded-xl border border-dashed border-outline-variant/50 p-3 text-on-surface-variant ${row.extra ? "opacity-70" : ""}`}
                >
                  <span className="w-10 shrink-0 text-center font-serif text-2xl tabular-nums opacity-60">{row.index}</span>
                  <div className="h-16 w-11 shrink-0 rounded border border-dashed border-outline-variant/50" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{row.title ?? `Book ${row.index}`}</p>
                    <p className="text-xs opacity-75">Not in your library</p>
                  </div>
                  {row.extra && (
                    <span className={OPTIONAL_CHIP} title={optionalHint(row.extra)}>
                      {row.extra} · optional
                    </span>
                  )}
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
      <p className="text-xs text-on-surface-variant">
        A book in the wrong series, or out of order? Its ⋯ menu → Series sets it right.
      </p>
    </div>
  );
};
