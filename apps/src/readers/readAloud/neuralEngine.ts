/**
 * The Studio voice on Windows: made and played in Rust (`src-tauri/src/tts`),
 * which says when each item starts, where each sentence of it begins (at
 * the item's `marks`, at the sample it is heard), and when it is done.
 *
 * Its "preparing" news (a device too slow to read live makes the chapter
 * first) comes from Rust as Android sends it, `{ type: "preparing", id,
 * seconds }`, and is ended (`seconds: null`) when that item starts.
 *
 * Commands go to Rust one after another, each once the one before has been
 * done there (else a pause or stop just after a first `speak`, while the
 * engine is still being made, could be done first, or not at all). After
 * `stop`, news still on its way from the reading stopped is not passed on.
 */
import { eventHub, toEngineEvent, type SpeechEngine, type SpeechItem, type SpeechVoice } from "./engine";
import { isStudioVoice, studioError, studioVoices, tauriBridge, type StudioBridge, type StudioMode, type StudioVoiceStatus } from "./studioVoice";

/** Sentences wanted queued ahead while a chapter is prepared: the rest of it. */
export const PREPARE_AHEAD = 600;

export type NeuralEngine = SpeechEngine & {
  /** How it reads here, as last heard (the self-test, then reading itself). */
  readonly mode: StudioMode;
  /** The status as last fetched. */
  readonly status: StudioVoiceStatus | null;
  /** Stops listening to Rust (the engine is let go). */
  dispose(): void;
};

export const neuralEngine = (bridge: StudioBridge = tauriBridge): NeuralEngine => {
  const hub = eventHub();
  let status: StudioVoiceStatus | null = null;
  let mode: StudioMode = "live";
  let preparing: string | null = null;
  let unlisten: (() => void) | null = null;
  let disposed = false;
  /** Stopped: Rust's news is of the reading stopped until the next `speak`. */
  let stopped = false;
  /** The commands, in order: each sent once the one before is done. */
  let queue: Promise<unknown> = Promise.resolve();

  const send = (command: string, args?: Record<string, unknown>) => {
    queue = queue
      .then(() => bridge.invoke(command, args))
      .catch((error) => hub.emit({ type: "error", id: null, message: studioError(error) }));
  };

  const fromRust = (raw: unknown) => {
    const event = toEngineEvent(raw);
    if (!event || stopped) return;
    if (event.type === "preparing") {
      if (event.seconds === null) {
        if (preparing === null) return;
        preparing = null;
      } else {
        const id = (raw as { id?: unknown }).id;
        preparing = typeof id === "string" ? id : "";
        mode = "prepare";
      }
      hub.emit(event);
      return;
    }
    if (event.type === "start" && preparing !== null) {
      preparing = null;
      hub.emit({ type: "preparing", seconds: null });
    }
    hub.emit(event);
  };

  void bridge
    .listen<unknown>("studio-voice:event", fromRust)
    .then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    })
    .catch(() => {});

  const engine: NeuralEngine = {
    kind: "neural",
    progress: "sentence",
    get mode() {
      return mode;
    },
    get status() {
      return status;
    },
    async voices(): Promise<SpeechVoice[]> {
      try {
        status = await bridge.invoke<StudioVoiceStatus>("studio_voice_status");
      } catch {
        status = null;
      }
      if (status) mode = status.mode;
      return status?.canSpeak ? studioVoices(status) : [];
    },
    speak(items: SpeechItem[], { replace }) {
      stopped = false;
      if (replace && preparing !== null) {
        preparing = null;
        hub.emit({ type: "preparing", seconds: null });
      }
      send("studio_speak", { items: items.map(({ id, text, silence, marks }) => ({ id, text, silence, marks })), replace });
    },
    pause: () => send("studio_pause"),
    resume: () => send("studio_resume"),
    stop() {
      stopped = true;
      if (preparing !== null) {
        preparing = null;
        hub.emit({ type: "preparing", seconds: null });
      }
      send("studio_stop");
    },
    setRate: (rate) => send("studio_set_rate", { rate }),
    setVoice: (id) => send("studio_set_voice", { voice: isStudioVoice(id) ? id : null }),
    ahead: () => (mode === "prepare" ? PREPARE_AHEAD : null),
    forget() {
      stopped = true;
      send("studio_stop");
    },
    onEvent: hub.on,
    dispose() {
      disposed = true;
      unlisten?.();
      unlisten = null;
    }
  };
  return engine;
};

let shared: NeuralEngine | null = null;

/** The one Studio voice engine (one listener on Rust's events, however many books are opened). */
export const sharedNeuralEngine = () => (shared ??= neuralEngine());
