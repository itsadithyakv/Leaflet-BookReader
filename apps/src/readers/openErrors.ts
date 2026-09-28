/** Turns what failed while opening a book into something a reader can act on. */
export const friendlyOpenError = (message: string) => {
  if (/os error 2|cannot find the (file|path)|no such file|not found on disk/i.test(message)) {
    return "The book file is missing. It may have been moved or deleted outside Leaflet. Import it again to keep reading.";
  }
  if (/encrypt|drm|adept/i.test(message)) {
    return "This book is copy-protected (DRM), so Leaflet can't open it. Books bought from most stores need their DRM removed by the store's own app first.";
  }
  if (/no section found|not a readable epub|damaged|invalid|zip/i.test(message)) {
    return "This book couldn't be read. The file may be damaged; importing it again sometimes helps.";
  }
  return message || "This book couldn't be opened.";
};
