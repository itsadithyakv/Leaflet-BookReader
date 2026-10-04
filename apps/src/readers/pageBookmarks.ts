/**
 * Bookmarks in the page reader: a page of a PDF or a comic, kept on this
 * device under `leaflet.bookmarks.<book id>`. Pure, so adding, removing and
 * reading what was stored can be tested without a window.
 */

export type PageBookmark = {
  id: string;
  page: number;
  label: string;
  createdAt: string;
};

/** What was stored, with anything that is not a bookmark left out. */
export const parsePageBookmarks = (stored: unknown): PageBookmark[] => {
  if (!Array.isArray(stored)) {
    return [];
  }
  return stored.filter(
    (bookmark): bookmark is PageBookmark =>
      Boolean(bookmark) &&
      typeof bookmark === "object" &&
      typeof (bookmark as PageBookmark).id === "string" &&
      Number.isFinite((bookmark as PageBookmark).page) &&
      typeof (bookmark as PageBookmark).label === "string" &&
      typeof (bookmark as PageBookmark).createdAt === "string"
  );
};

export const isBookmarked = (bookmarks: PageBookmark[], page: number) =>
  bookmarks.some((bookmark) => bookmark.page === page);

export const removeBookmark = (bookmarks: PageBookmark[], id: string) =>
  bookmarks.filter((bookmark) => bookmark.id !== id);

/** Bookmarks the page if it is not, and takes the bookmark off if it is. */
export const toggleBookmark = (bookmarks: PageBookmark[], bookId: string, page: number, now: Date = new Date()) =>
  isBookmarked(bookmarks, page)
    ? bookmarks.filter((bookmark) => bookmark.page !== page)
    : [
        ...bookmarks,
        {
          id: `${bookId}-${page}-${now.getTime()}`,
          page,
          label: `Page ${page}`,
          createdAt: now.toISOString()
        }
      ];

/** In page order, which is the order a reader looks for them in. */
export const inPageOrder = (bookmarks: PageBookmark[]) => [...bookmarks].sort((a, b) => a.page - b.page);
