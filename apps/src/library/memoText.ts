/**
 * A text-to-text function that remembers its answers.
 *
 * The library's series are worked out again whenever any book changes (a page
 * read moves its progress), and most of that time went on normalising the
 * same few thousand titles and series names with chains of regular
 * expressions. The function must be pure; past `cap` answers the memory starts
 * again, so a long session cannot grow it without end.
 */
export const memoText = (fn: (text: string) => string, cap = 20_000): ((text: string) => string) => {
  let seen = new Map<string, string>();
  return (text: string) => {
    const hit = seen.get(text);
    if (hit !== undefined) {
      return hit;
    }
    const value = fn(text);
    if (seen.size >= cap) {
      seen = new Map();
    }
    seen.set(text, value);
    return value;
  };
};
