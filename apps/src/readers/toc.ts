/** The table of contents, flattened for the chapter list. */

import type { TocItem } from "./readerTypes";

export const flattenToc = (items: TocItem[]) => {
  const result: TocItem[] = [];
  const walk = (list: TocItem[]) => {
    list.forEach((item) => {
      result.push(item);
      if (item.subitems && item.subitems.length > 0) {
        walk(item.subitems);
      }
    });
  };
  walk(items);
  return result;
};
