/**
 * Reading aloud on Windows: the Studio voice (`neuralEngine.ts`) when one of
 * its voices is picked, else Windows' own voices (`webSpeechEngine.ts`),
 * behind one engine, so the player need not know which is speaking.
 *
 * If the Studio voice fails (its files damaged, the speakers refusing it),
 * reading goes on at once in the best Windows voice, from the sentence it
 * had reached, and the reader is told in a small toast.
 */
import { eventHub, type EngineEvent, type EngineKind, type SpeechEngine, type SpeechItem, type SpeechVoice } from "./engine";
import { isStudioVoice } from "./studioVoice";
import type { NeuralEngine } from "./neuralEngine";
import { bestVoice } from "./voiceRank";

export type DesktopEngineOptions = {
  web: SpeechEngine | null;
  neural: NeuralEngine | null;
  /** The Studio voice failed and a Windows voice took over (its name). */
  onFallback?: (voiceName: string | null) => void;
};

export const desktopEngine = ({ web, neural, onFallback }: DesktopEngineOptions): SpeechEngine => {
  const hub = eventHub();
  let active: SpeechEngine | null = web ?? neural;
  let lang: string | null = null;
  let rate = 1;
  /** What has been given to the voice since the queue last started again, from the item being said on. */
  let items: SpeechItem[] = [];
  /** The item being said, and the start of the sentence the voice is in (Studio voice). */
  let current: { id: string; at: number } | null = null;
  /** An item given to Windows' voice part of the way in (after a fallback): its offset, to give events back in the item's own terms. */
  const offsets = new Map<string, number>();

  const use = (next: SpeechEngine | null) => {
    if (next === active) return;
    active?.stop();
    active = next;
    offsets.clear();
  };

  const fallBack = async (failedId: string | null) => {
    if (!web || active !== neural) return;
    // The piece that failed may be one made ahead, past what is being heard: reading
    // goes on from the sentence heard (its audio stopped with the failure), not from there.
    const failedAt = failedId === null ? -1 : items.findIndex((item) => item.id === failedId);
    const heardAt = current ? items.findIndex((item) => item.id === current?.id) : -1;
    const fromHeard = heardAt >= 0 && (failedAt < 0 || heardAt <= failedAt);
    const index = fromHeard ? heardAt : failedAt >= 0 ? failedAt : items.length > 0 ? 0 : -1;
    const from = fromHeard && current ? current.at : 0;
    const rest = index >= 0 ? items.slice(index) : [];
    neural?.stop();
    active = web;
    offsets.clear();
    const voices = await web.voices().catch(() => [] as SpeechVoice[]);
    const voice = bestVoice(voices, lang);
    web.setRate(rate);
    web.setVoice(voice?.id ?? null, voice?.lang ?? lang);
    onFallback?.(voice?.name ?? null);
    if (rest.length === 0) return;
    const [first, ...after] = rest;
    const head: SpeechItem =
      from > 0
        ? {
            id: first.id,
            text: first.text.slice(from),
            marks: (first.marks ?? []).filter((mark) => mark >= from).map((mark) => mark - from)
          }
        : first;
    if (from > 0) offsets.set(first.id, from);
    items = rest;
    web.speak([head, ...after], { replace: true });
  };

  const fromEngine = (source: SpeechEngine) => (event: EngineEvent) => {
    if (source !== active) return;
    if (source === neural && event.type === "error" && web) {
      void fallBack(event.id);
      return;
    }
    if (source === neural) {
      if (event.type === "start") current = { id: event.id, at: 0 };
      if (event.type === "boundary" && current?.id === event.id) current = { id: event.id, at: event.charIndex };
    }
    if (event.type === "done") {
      // What is said is let go.
      const index = items.findIndex((item) => item.id === event.id);
      if (index > 0) items = items.slice(index);
    }
    const offset = "id" in event && event.id !== null ? offsets.get(event.id) : undefined;
    if (offset !== undefined && event.type === "start") {
      hub.emit({ ...event, from: offset + (event.from ?? 0) });
      return;
    }
    if (offset !== undefined && event.type === "boundary") {
      hub.emit({ ...event, charIndex: event.charIndex + offset });
      return;
    }
    hub.emit(event);
  };
  const detach = [web?.onEvent(fromEngine(web)), neural?.onEvent(fromEngine(neural))];

  return {
    get kind(): EngineKind {
      return active?.kind ?? "web";
    },
    get progress() {
      return active?.progress;
    },
    async voices() {
      const [studio, system] = await Promise.all([
        neural ? neural.voices().catch(() => [] as SpeechVoice[]) : Promise.resolve([] as SpeechVoice[]),
        web ? web.voices().catch(() => [] as SpeechVoice[]) : Promise.resolve([] as SpeechVoice[])
      ]);
      return [...studio, ...system];
    },
    speak(next, options) {
      if (options.replace) {
        items = [...next];
        current = null;
        offsets.clear();
      } else {
        items.push(...next);
      }
      active?.speak(next, options);
    },
    pause: () => active?.pause(),
    resume: () => active?.resume(),
    stop() {
      items = [];
      current = null;
      offsets.clear();
      active?.stop();
    },
    setRate(next) {
      rate = next;
      web?.setRate(next);
      neural?.setRate(next);
    },
    setVoice(id, language) {
      lang = language;
      if (isStudioVoice(id) && neural) {
        use(neural);
        neural.setVoice(id, language);
      } else {
        use(web ?? neural);
        web?.setVoice(id, language);
      }
    },
    setInfo: (info) => web?.setInfo?.(info),
    ahead: () => active?.ahead?.() ?? null,
    forget() {
      // The book closed: this engine is done with (the Studio voice itself is shared, and stays).
      neural?.forget?.();
      detach.forEach((off) => off?.());
    },
    onEvent: hub.on
  };
};
