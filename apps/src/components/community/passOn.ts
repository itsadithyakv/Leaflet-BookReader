import { android, onAndroid } from "../../platform/android";

/** What a button that hands a line to a friend says: "Share" on a phone, where it opens the share sheet. */
export const passOnLabel = (desktop: string) => (onAndroid() ? "Share" : desktop);

/**
 * Hands a line to a friend (an invite, a handle, a club's code): on a phone
 * the share sheet, straight into a message; elsewhere the clipboard, with a
 * toast. `fallback` is said when neither worked, so the words are still seen.
 */
export const passOn = (text: string, toast: (message: string) => void, fallback: string) => {
  if (onAndroid()) {
    void android.shareText(text).catch(() => toast(fallback));
    return;
  }
  navigator.clipboard
    .writeText(text)
    .then(() => toast("Copied. Send it to a friend."))
    .catch(() => toast(fallback));
};
