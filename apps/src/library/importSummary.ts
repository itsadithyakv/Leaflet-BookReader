/**
 * What dropping files on the library did, in the reader's words.
 *
 * `asked` is how many files were handed over, `imported` what came back for
 * them (one entry a file, so the same book can be there twice), and `known`
 * the books the library already had. The message used to count every file
 * that came back as "added", so dropping a book already in the library, or
 * the same file twice, said "2 books added" when nothing had been.
 */
export const describeImport = (
  asked: number,
  imported: ReadonlyArray<{ id: string }>,
  known: ReadonlySet<string>
): string => {
  const ids = new Set(imported.map((book) => book.id));
  const added = [...ids].filter((id) => !known.has(id)).length;
  const already = ids.size - added;
  const unread = Math.max(0, asked - imported.length);

  const parts: string[] = [];
  if (added > 0) {
    parts.push(`${added} book${added === 1 ? "" : "s"} added.`);
    if (already > 0) {
      parts.push(`${already} ${already === 1 ? "was" : "were"} already in your library.`);
    }
  } else if (already > 0) {
    parts.push(already === 1 ? "That book is already in your library." : "Those books are already in your library.");
  } else {
    parts.push("Nothing was added.");
  }
  if (unread > 0) {
    parts.push(
      `${unread === 1 ? "One file" : `${unread} files`} couldn't be read; Settings → About → Copy diagnostics has the details.`
    );
  }
  return parts.join(" ");
};
