/**
 * What adding files to the library did, in the reader's words: through the
 * import dialog, or by dropping them on the window.
 *
 * `asked` is how many files were handed over, `imported` what came back for
 * them (one entry a file, so the same book can be there twice), `known` the
 * books the library already had, and `failed` the files that were not added,
 * each with its reason as the backend words it. The message used to count
 * every file that came back as "added", so dropping a book already in the
 * library, or the same file twice, said "2 books added" when nothing had been;
 * a file that failed was only counted ("one file couldn't be read"), and the
 * dialog said nothing at all.
 */
export type ImportFailure = { name: string; reason: string };

/** How many books already in the library, and how many failures, are named before the rest are counted. */
const NAMED = 2;

const quoted = (text: string) => `“${text}”`;

/** "“A”", "“A” and “B”", "“A”, “B” and 3 others". */
const listed = (names: string[]) => {
  const shown = names.slice(0, NAMED).map(quoted);
  const rest = names.length - shown.length;
  if (rest > 0) {
    return `${shown.join(", ")} and ${rest} other${rest === 1 ? "" : "s"}`;
  }
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}` : shown[0];
};

/** A reason as a sentence: the backend's all end in a full stop, a system's may not. */
const sentence = (reason: string) => {
  const text = reason.trim();
  return /[.!?…]$/.test(text) ? text : `${text}.`;
};

export const describeImport = (
  asked: number,
  imported: ReadonlyArray<{ id: string; title?: string | null }>,
  known: ReadonlySet<string>,
  failed?: ReadonlyArray<ImportFailure>
): string => {
  const ids = new Set(imported.map((book) => book.id));
  const added = [...ids].filter((id) => !known.has(id)).length;
  // The books the library had already, each once, by title where there is one.
  const had = [...ids].filter((id) => known.has(id));
  const hadTitles = had
    .map((id) => imported.find((book) => book.id === id)?.title?.trim() ?? "")
    .filter((title) => title.length > 0);
  const already = had.length;
  const named = hadTitles.length === already && already > 0;

  const parts: string[] = [];
  if (added > 0) {
    parts.push(`${added} book${added === 1 ? "" : "s"} added.`);
    if (already > 0) {
      parts.push(`${named ? listed(hadTitles) : already} ${already === 1 ? "was" : "were"} already in your library.`);
    }
  } else if (already > 0) {
    parts.push(
      named
        ? `${listed(hadTitles)} ${already === 1 ? "is" : "are"} already in your library.`
        : already === 1
          ? "That book is already in your library."
          : "Those books are already in your library."
    );
  } else {
    parts.push("Nothing was added.");
  }

  if (failed) {
    // Each file that did not come in, by name, with why.
    for (const failure of failed.slice(0, NAMED)) {
      parts.push(`${quoted(failure.name)} was not added: ${sentence(failure.reason)}`);
    }
    const rest = failed.length - Math.min(failed.length, NAMED);
    if (rest > 0) {
      parts.push(
        `${rest === 1 ? "One more file was" : `${rest} more files were`} not added; Settings → About → Copy diagnostics has the details.`
      );
    }
    return parts.join(" ");
  }

  const unread = Math.max(0, asked - imported.length);
  if (unread > 0) {
    parts.push(
      `${unread === 1 ? "One file" : `${unread} files`} couldn't be read; Settings → About → Copy diagnostics has the details.`
    );
  }
  return parts.join(" ");
};

/**
 * How long a message stays up, in milliseconds: long enough to read. A toast
 * was 2.6 seconds whatever it said, which is right for "1 book added." and a
 * third of what a file's name and the reason it was not added need. About 55
 * ms a character past the first 45, to at most 14 seconds.
 */
export const toastMs = (message: string): number => Math.round(Math.min(14000, 2600 + Math.max(0, message.length - 45) * 55));
