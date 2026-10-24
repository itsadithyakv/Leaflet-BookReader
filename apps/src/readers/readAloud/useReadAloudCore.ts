import { useEffect, useRef, useState } from "react";
import { onAndroid } from "../../platform/android";
import type { Sentence } from "./chapterText";
import { fakeEngine, type SpeechEngine, type SpeechVoice } from "./engine";
import { androidEngine } from "./androidEngine";
import { webSpeechAvailable, webSpeechEngine } from "./webSpeechEngine";
import { desktopEngine } from "./desktopEngine";
import { sharedNeuralEngine } from "./neuralEngine";
import { studioAvailable } from "./studioVoice";
import { createPlayer, DEFAULT_AHEAD, type PlayerStatus, type ReadAloudPlayer, type SentenceSource, type SpokenWord } from "./player";
import { loadPrefs, nextRate, pickVoice, savePrefs, snapRate, voicesFor, baseLanguage, type ReadAloudPrefs } from "./prefs";
import type { RankOptions } from "./voiceRank";

// The browser preview's fake voice is switched on by hand, on the window.
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * What both readers share of reading aloud (the text reader's
 * `useReadAloud.ts`, the page reader's `usePdfReadAloud.ts`): the voice
 * there is here, the speed and voice kept for every book, the player and its
 * controls, and the notice when there is nothing to read with or to read.
 * How a sentence is found, lit and kept on screen is each reader's own
 * (`ReadAloudView`).
 */

/** Why reading aloud did not start: no voice for the language, or no words on the page (a scanned PDF). */
export type ReadAloudNotice = "noVoice" | "noText" | "noTextBook" | null;

/** A place to read from: a section (a chapter, a PDF's page) and an offset in its text. */
export type ReadAloudPlace = { section: number; offset: number };

/** What Android's notification says of the book. */
export type ReadAloudInfo = { title: string; author: string; chapter: string; bookId: string };

/** The reader's part: its page, where the voice is lit and followed. */
export type ReadAloudView = {
  /** The book's language, for the voice (null: not known). */
  language(): string | null;
  /** Lights the sentence being read (null: none). */
  paint(sentence: Sentence | null): void;
  /** The word being said, where the voice says (null: none). */
  paintWord(word: SpokenWord | null): void;
  unpaint(): void;
  /** Keeps the sentence on screen. Only asked while the page is following the voice. */
  bringIntoView(sentence: Sentence): void;
  /** Where reading starts: the first sentence on screen. */
  placeOnScreen(): ReadAloudPlace | null | Promise<ReadAloudPlace | null>;
  info(section: number): ReadAloudInfo;
  toast(message: string): void;
  /** Just before reading starts: other hands-free reading gives way, menus close. */
  beforeStart?(): void;
  /** A notice instead of reading from here (nothing to read there), or null to read. */
  check?(place: ReadAloudPlace): ReadAloudNotice | Promise<ReadAloudNotice>;
  /** The reading came to the end (by default, of the book). */
  onEnd?(): void;
};

/**
 * Sentences queued past the one being read: more on Android, and many more
 * while Leaflet is out of sight; as many as the engine asks for (a voice that
 * prepares the chapter first wants the rest of it).
 */
const aheadFor = (engine: SpeechEngine) => () =>
  Math.max(
    engine.ahead?.() ?? 0,
    typeof document !== "undefined" && document.visibilityState === "hidden" ? 80 : engine.kind === "android" ? 10 : DEFAULT_AHEAD
  );

/** The engine there is here: Android's own speech, the browser's, or (for the browser preview, by hand) the fake. */
const makeEngine = (onFallback?: (voiceName: string | null) => void): SpeechEngine | null => {
  if (typeof window !== "undefined" && (window as any).__leafletReadAloudFake) {
    const wordMs = Number((window as any).__leafletReadAloudFakeWordMs) || undefined;
    return fakeEngine({ autoMs: Number((window as any).__leafletReadAloudFake) || 1600, wordMs });
  }
  if (onAndroid()) {
    return androidEngine();
  }
  // Windows: its own voices, and the Studio voice where it is downloaded (desktopEngine.ts).
  const web = webSpeechAvailable() ? webSpeechEngine() : null;
  const neural = studioAvailable() ? sharedNeuralEngine() : null;
  return web || neural ? desktopEngine({ web, neural, onFallback }) : null;
};

const storage = () => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

/**
 * How voices are ranked here: offline first on Android, and the phone's own
 * voice before Leaflet's studio voices there (picked only by hand); the
 * reader's own languages for the region.
 */
const rankOptions = (engine: SpeechEngine | null): RankOptions => ({
  preferOffline: (engine?.kind ?? (onAndroid() ? "android" : "web")) === "android",
  studioFirst: (engine?.kind ?? (onAndroid() ? "android" : "web")) !== "android",
  // (Only "false" is to be trusted: "true" may be a network that goes nowhere.)
  offline: typeof navigator !== "undefined" && navigator.onLine === false,
  userLangs: typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : []
});

/**
 * The player and its controls, for a book (`bookKey`). `source` is read when
 * the player is made (on the first play); `view` at every call, so it may be
 * made afresh each render.
 */
export const useReadAloudCore = ({ bookKey, source, view }: { bookKey: string; source: SentenceSource; view: ReadAloudView }) => {
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [current, setCurrent] = useState<Sentence | null>(null);
  const [following, setFollowing] = useState(true);
  const [prefs, setPrefs] = useState<ReadAloudPrefs>(() => loadPrefs(storage()));
  const [voices, setVoices] = useState<SpeechVoice[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [notice, setNotice] = useState<ReadAloudNotice>(null);
  /** Seconds until a studio voice that prepares the chapter first can start (null: not waiting). */
  const [preparing, setPreparing] = useState<number | null>(null);
  /** A voice for this reading only ("Use phone voice now"), not kept in the prefs. */
  const [voiceOverride, setVoiceOverride] = useState<string | null>(null);

  const engineRef = useRef<SpeechEngine | null>(null);
  const playerRef = useRef<ReadAloudPlayer | null>(null);
  const followingRef = useRef(true);
  followingRef.current = following;
  const currentRef = useRef<Sentence | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const sourceRef = useRef(source);
  sourceRef.current = source;

  const language = () => viewRef.current.language();

  const showNotice = (next: ReadAloudNotice) => {
    setNotice(next);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = next ? window.setTimeout(() => setNotice(null), 6000) : null;
  };

  const tellSection = (section: number) => {
    engineRef.current?.setInfo?.(viewRef.current.info(section));
  };

  const ensurePlayer = () => {
    if (playerRef.current) return playerRef.current;
    const engine = makeEngine((name) =>
      viewRef.current.toast(name ? `Studio voice stopped — reading on with ${name}` : "Studio voice stopped — reading on")
    );
    if (!engine) return null;
    engineRef.current = engine;
    engine.onEvent((event) => {
      if (event.type === "preparing") setPreparing(event.seconds);
      else if (event.type === "stopped") setPreparing(null);
    });
    const player = createPlayer(engine, sourceRef.current, {
      ahead: aheadFor(engine),
      onChange: (state) => {
        setStatus(state.status);
        if (state.status === "idle") setPreparing(null);
        const changedSection = state.current && currentRef.current?.section !== state.current.section;
        currentRef.current = state.current;
        setCurrent(state.current);
        if (changedSection && state.current) {
          tellSection(state.current.section);
        }
      },
      onWord: (word) => viewRef.current.paintWord(word),
      onEnd: () => {
        const ended = viewRef.current.onEnd;
        if (ended) ended();
        else viewRef.current.toast("The end of the book");
      },
      onStopped: () => setSheetOpen(false),
      // (Several items in a row the voice could not say: one that needs the network, offline.)
      onFailed: () => {
        setSheetOpen(false);
        viewRef.current.unpaint();
        viewRef.current.toast("The voice could not read here. Try another voice.");
      }
    });
    playerRef.current = player;
    return player;
  };

  const start = async () => {
    const player = ensurePlayer();
    const engine = engineRef.current;
    if (!player || !engine) {
      showNotice("noVoice");
      return;
    }
    const all = await engine.voices().catch(() => [] as SpeechVoice[]);
    setVoices(all);
    const offered = voicesFor(all, language(), rankOptions(engine));
    if (offered.length === 0) {
      showNotice("noVoice");
      return;
    }
    setVoiceOverride(null);
    setPreparing(null);
    const voice = pickVoice(all, language(), prefs, rankOptions(engine));
    player.setRate(prefs.rate);
    player.setVoice(voice?.id ?? null, voice?.lang ?? language());
    const place = await viewRef.current.placeOnScreen();
    if (!place) return;
    const blocked = viewRef.current.check ? await viewRef.current.check(place) : null;
    if (blocked) {
      showNotice(blocked);
      return;
    }
    viewRef.current.beforeStart?.();
    showNotice(null);
    setFollowing(true);
    tellSection(place.section);
    await player.start(place.section, place.offset);
  };

  const stop = () => {
    playerRef.current?.stop();
    setSheetOpen(false);
    viewRef.current.unpaint();
  };

  const pause = () => playerRef.current?.pause();
  const resume = () => playerRef.current?.resume();
  const toggle = () => {
    const player = playerRef.current;
    if (!player || player.state.status === "idle") void start();
    else if (player.state.status === "playing") player.pause();
    else if (player.state.status === "paused") player.resume();
  };

  const setRate = (value: number) => {
    const rate = snapRate(value);
    if (Math.abs(rate - prefs.rate) < 0.001) return;
    const next = { ...prefs, rate };
    setPrefs(next);
    savePrefs(storage(), next);
    playerRef.current?.setRate(rate);
  };

  const chooseVoice = (voice: SpeechVoice) => {
    const next = { ...prefs, voices: { ...prefs.voices, [baseLanguage(language())]: voice.id } };
    setPrefs(next);
    savePrefs(storage(), next);
    setVoiceOverride(null);
    setPreparing(null);
    playerRef.current?.setVoice(voice.id, voice.lang);
  };

  /** While a studio voice prepares the chapter: the phone's best voice reads now instead (this time only). */
  const usePhoneVoice = () => {
    const phone = voicesFor(voices, language(), rankOptions(engineRef.current)).find((entry) => !entry.studio);
    if (!phone) return;
    setVoiceOverride(phone.id);
    setPreparing(null);
    playerRef.current?.setVoice(phone.id, phone.lang);
  };

  /**
   * A studio voice chosen on a device too slow to read it live: the chapter
   * from the place on screen is prepared quietly before reading starts (the
   * engine prepares only while Leaflet is in front, not on a low battery), so
   * pressing play is often at once.
   */
  const prepareAhead = async () => {
    if (playerRef.current && playerRef.current.state.status !== "idle") return;
    const player = ensurePlayer();
    const engine = engineRef.current;
    if (!player || !engine?.prepare || player.state.status !== "idle") return;
    const all = await engine.voices().catch(() => [] as SpeechVoice[]);
    const voice = pickVoice(all, language(), prefs, rankOptions(engine));
    if (!voice?.studio || !voice.slow || player.state.status !== "idle") return;
    const place = await viewRef.current.placeOnScreen();
    if (!place) return;
    player.setRate(prefs.rate);
    player.setVoice(voice.id, voice.lang ?? language());
    tellSection(place.section);
    await player.prepare(place.section, place.offset);
  };

  const follow = () => {
    setFollowing(true);
    followingRef.current = true;
    if (currentRef.current) viewRef.current.bringIntoView(currentRef.current);
  };

  const active = status !== "idle";

  // Each new sentence: lit, and kept on screen.
  useEffect(() => {
    viewRef.current.paint(current);
    if (current && followingRef.current) viewRef.current.bringIntoView(current);
  }, [current]);

  // Out of sight: more queued, so the voice reads on while the page sleeps. Back: the page catches up.
  useEffect(() => {
    if (!active) return undefined;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        playerRef.current?.topUp();
      } else if (currentRef.current) {
        viewRef.current.paint(currentRef.current);
        if (followingRef.current) viewRef.current.bringIntoView(currentRef.current);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [active]);

  // The book closed (or another opened): the voice stops.
  useEffect(
    () => () => {
      playerRef.current?.stop();
      engineRef.current?.forget?.();
      playerRef.current?.dispose();
      playerRef.current = null;
      engineRef.current = null;
      viewRef.current.unpaint();
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    },
    [bookKey]
  );

  const offered = voicesFor(voices, language(), rankOptions(engineRef.current));
  const voice =
    (voiceOverride ? offered.find((entry) => entry.id === voiceOverride) : null) ?? pickVoice(voices, language(), prefs, rankOptions(engineRef.current));

  const controls = {
    /** Reading aloud is on (playing, paused, or finding its place). */
    active,
    status,
    current,
    following,
    rate: prefs.rate,
    voices: offered,
    voiceId: voice?.id ?? null,
    /** The one that sounds best here (first in the list). */
    bestVoiceId: offered[0]?.id ?? null,
    sheetOpen,
    setSheetOpen,
    notice,
    dismissNotice: () => showNotice(null),
    engineKind: engineRef.current?.kind ?? (onAndroid() ? "android" : "web"),
    start: () => void start(),
    toggle,
    pause,
    resume,
    stop,
    next: () => void playerRef.current?.next(),
    previous: () => void playerRef.current?.previous(),
    setRate,
    cycleRate: () => setRate(nextRate(prefs.rate)),
    chooseVoice,
    /** Seconds until a studio voice preparing the chapter can start; null when it is not waiting. */
    preparing: active ? preparing : null,
    /** Reads on in the phone's own voice now, while a studio voice prepares (null: there is none). */
    usePhoneVoice: offered.some((entry) => !entry.studio) ? usePhoneVoice : null,
    follow
  };

  return { controls, active, currentRef, followingRef, setFollowing, playerRef, prepareAhead, stop, showNotice };
};

export type ReadAloudControls = ReturnType<typeof useReadAloudCore>["controls"];
