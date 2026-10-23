import { kindKey, panicKind, type ErrorKind } from "./errorScrub";

/**
 * Error reports the app sends by itself: which kinds of error happen to
 * readers, in which version and on which platform, so the owner hears of a
 * crash without waiting for someone to press "Report a problem".
 *
 * Each error the interface logs, each unhandled rejection, and each Rust
 * panic (noted for the next start, `take_panic_reports`) becomes its kind
 * (`errorScrub.ts`: nothing of the reader's in it), kept on this device in a
 * short list, the same kind counted rather than repeated, twenty kinds at
 * most. Once a session, a while after it starts, the list goes to the server
 * in one small request, never signed in, from readers signed in or not; what
 * happens after that waits for the next session. Settings has the switch
 * (on unless turned off), and turning it off forgets what was waiting.
 *
 * Nothing here may log an error of its own: that would be reported in turn.
 */

export const QUEUE_KEY = "leaflet.errorKinds.v1";
export const SWITCH_KEY = "leaflet.errorReports";
export const QUEUE_MAX = 20;
const COUNT_MAX = 1000;

export type QueuedKind = ErrorKind & { count: number; version?: string };
/** Sends a batch: true when it was taken, false when the server has no such route yet. */
export type SendKinds = (kinds: QueuedKind[]) => Promise<boolean>;

const read = (): QueuedKind[] => {
  try {
    const kept = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
    return Array.isArray(kept) ? kept.slice(0, QUEUE_MAX) : [];
  } catch {
    return [];
  }
};

const write = (kinds: QueuedKind[]) => {
  try {
    if (kinds.length === 0) localStorage.removeItem(QUEUE_KEY);
    else localStorage.setItem(QUEUE_KEY, JSON.stringify(kinds));
  } catch {
    // No room or no storage: this session's kinds are lost, which is all.
  }
};

let version: string | undefined;
let sentThisSession = false;

export const errorReports = {
  /** Whether reports are sent: on unless the reader turned them off. */
  on(): boolean {
    try {
      return localStorage.getItem(SWITCH_KEY) !== "off";
    } catch {
      return true;
    }
  },

  /** The Settings switch. Off forgets what was waiting to go. */
  setOn(on: boolean) {
    try {
      if (on) localStorage.removeItem(SWITCH_KEY);
      else localStorage.setItem(SWITCH_KEY, "off");
    } catch {
      // Kept for this session only.
    }
    if (!on) write([]);
  },

  /** This app's version, once it is known: kept with each kind seen after. */
  setVersion(next: string | null) {
    version = next ?? undefined;
  },

  /** Counts one error of `kind`: the same kind again adds to its count, a new one waits its turn, past twenty none. */
  note(kind: ErrorKind) {
    if (!errorReports.on() || (!kind.message && kind.frames.length === 0)) return;
    const kinds = read();
    const key = kindKey(kind);
    const same = kinds.find((kept) => kindKey(kept) === key && kept.version === version);
    if (same) {
      same.count = Math.min(same.count + 1, COUNT_MAX);
    } else if (kinds.length < QUEUE_MAX) {
      kinds.push({ ...kind, count: 1, ...(version ? { version } : {}) });
    } else {
      return;
    }
    write(kinds);
  },

  /** The panics the Rust side noted before the app last ended, each as its kind. */
  notePanics(panics: { message: string; place: string }[]) {
    for (const panic of panics.slice(0, QUEUE_MAX)) {
      errorReports.note(panicKind(panic.message, panic.place));
    }
  },

  /** What is waiting to go. */
  waiting(): QueuedKind[] {
    return read();
  },

  /**
   * Sends what is waiting, once a session: whatever comes of it, not again
   * until the app is next opened. Taken, or refused by a server that has no
   * such route yet, the list is cleared (an older server will never take
   * it); not sent at all (offline, no server), it waits for the next session.
   */
  async sendOnce(send: SendKinds): Promise<void> {
    if (sentThisSession || !errorReports.on()) return;
    const kinds = read();
    if (kinds.length === 0) return;
    sentThisSession = true;
    try {
      await send(kinds);
      // Only what was sent goes: a new kind noted while it was on its way stays.
      const sent = new Set(kinds.map(kindKey));
      write(read().filter((kept) => !sent.has(kindKey(kept))));
    } catch {
      // Kept for the next session, quietly.
    }
  },

  /** For tests: a new session. */
  resetSession() {
    sentThisSession = false;
    version = undefined;
  }
};
