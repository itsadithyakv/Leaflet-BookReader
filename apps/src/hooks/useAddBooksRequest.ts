import { useEffect, useRef } from "react";

/**
 * "Add books" from somewhere that is not the Library page (the header's +,
 * on a phone held sideways): the page that knows how to import, and to say
 * what came in, listens for it while it is shown.
 */
const EVENT = "leaflet:add-books";

export const requestAddBooks = () => {
  window.dispatchEvent(new Event(EVENT));
};

export const useAddBooksRequest = (handler: () => void) => {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const listener = () => latest.current();
    window.addEventListener(EVENT, listener);
    return () => window.removeEventListener(EVENT, listener);
  }, []);
};
