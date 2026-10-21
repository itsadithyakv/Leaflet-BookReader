import { useCallback, useEffect, useRef, useState } from "react";
import { InfoTip } from "./ui/InfoTip";
import { isAndroid } from "../platform/device";
import { RATES, loadPrefs, rateLabel, savePrefs, snapRate, type ReadAloudPrefs } from "../readers/readAloud/prefs";
import {
  STUDIO_APPROX_BYTES,
  formatBytes,
  studioAvailable,
  studioError,
  studioService,
  tauriBridge,
  type StudioBridge,
  type StudioProgress,
  type StudioVoiceStatus
} from "../readers/readAloud/studioVoice";
import { androidOnMeteredNetwork, androidStudioSelfTest, androidStudioSupport } from "../readers/readAloud/androidEngine";
import { android } from "../platform/android";

const storage = () => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

/** The read-aloud prefs' key for English (the Studio voices are English). */
const LANG = "en";

const PHASE: Record<StudioProgress["phase"], string> = {
  download: "Downloading",
  verify: "Checking",
  extract: "Unpacking",
  install: "Installing",
  test: "Trying it out"
};

/** What the self-test found, for the (i). */
export const modeNote = (status: StudioVoiceStatus, android: boolean) => {
  const device = android ? "phone" : "computer";
  const test = status.selfTest;
  const measured = test ? ` (${test.rtf.toFixed(2)}× real time, ${test.threads} threads)` : "";
  if (!test) return `Not yet tried on this ${device}.`;
  if (status.mode === "tooSlow") return `Too slow on this ${device} to read with: the system voices read instead${measured}.`;
  if (status.mode === "prepare") return `This ${device} makes it a little slower than it speaks, so each chapter is prepared for a moment before it is read${measured}.`;
  if (status.slow) return `Reads as it goes on this ${device}, only just: it is not picked by itself${measured}.`;
  return `Reads as it goes on this ${device}${measured}.`;
};

export type StudioVoiceCardProps = {
  showToast: (message: string) => void;
  /** The calls it makes (a fake in the tests). */
  bridge?: StudioBridge;
  /** Android (else Windows); from the device by default. */
  onPhone?: boolean;
};

/**
 * Settings → Reading → Studio voice: Leaflet's own natural voices (Kokoro),
 * downloaded on request. On a computer it is offered up front (the system
 * voices until it is installed, then it reads by itself, if it keeps up);
 * on a phone, lower-key (the phone's own voice stays the one picked).
 * Download with progress and cancel; then the voice, a ▶ to hear each at
 * the reading speed (the same speed as the reader's), and Remove.
 */
export const StudioVoiceCard = ({ showToast, bridge, onPhone }: StudioVoiceCardProps) => {
  const phone = onPhone ?? isAndroid();
  const available = Boolean(bridge) || studioAvailable();
  const service = useRef(studioService(bridge ?? tauriBridge)).current;
  const [status, setStatus] = useState<StudioVoiceStatus | null>(null);
  const [progress, setProgress] = useState<StudioProgress | null>(null);
  const [busy, setBusy] = useState<"download" | "remove" | null>(null);
  const [prefs, setPrefs] = useState<ReadAloudPrefs>(() => loadPrefs(storage()));
  const [rateStep, setRateStep] = useState(() => RATES.indexOf(snapRate(prefs.rate)));
  const [playing, setPlaying] = useState<string | null>(null);
  /** Off on this phone (no native libraries, too little memory). */
  const [phoneOff, setPhoneOff] = useState(false);

  const look = useCallback(
    () =>
      service
        .status()
        .then((next) => {
          setStatus(next);
          return next;
        })
        .catch(() => null),
    [service]
  );

  useEffect(() => {
    if (!available) return;
    void look();
    if (phone && !bridge) {
      void androidStudioSupport()
        .then((support) => setPhoneOff(Boolean(support && (!support.native || support.lowRam))))
        .catch(() => {});
    }
  }, [available, phone, bridge, look]);

  // The preview's end, from the Studio voice's own news (Windows).
  useEffect(() => {
    if (!available || phone || !playing) return undefined;
    let stop: (() => void) | null = null;
    let gone = false;
    void (bridge ?? tauriBridge)
      .listen<{ type: string; id?: string }>("studio-voice:event", (event) => {
        if ((event.type === "done" || event.type === "error") && event.id === "preview") setPlaying(null);
      })
      .then((off) => {
        if (gone) off();
        else stop = off;
      });
    return () => {
      gone = true;
      stop?.();
    };
  }, [available, phone, playing, bridge]);

  if (!available || phoneOff) return null;
  // A copy of Leaflet without the voice's engine (Windows): nothing to offer unless something is to be removed.
  if (status && !phone && !status.canSpeak && !status.installed) return null;

  const chosen = prefs.voices[LANG];
  const voiceId = status?.voices.some((voice) => voice.id === chosen) ? chosen : (status?.defaultVoice ?? null);
  const rate = RATES[rateStep] ?? 1;

  const savePrefsWith = (change: Partial<ReadAloudPrefs>) => {
    // Read again first: the reader may have changed the speed since this card was drawn.
    const next = { ...loadPrefs(storage()), ...change };
    setPrefs(next);
    savePrefs(storage(), next);
  };

  const download = async () => {
    if (busy) return;
    if (phone && !bridge && (await androidOnMeteredNetwork().catch(() => false))) {
      showToast(`On mobile data: the Studio voice is ${formatBytes(status?.downloadBytes ?? STUDIO_APPROX_BYTES)}. Connect to Wi-Fi to download it.`);
      return;
    }
    setBusy("download");
    setProgress({ phase: "download", done: status?.partialBytes ?? 0, total: status?.downloadBytes ?? STUDIO_APPROX_BYTES });
    try {
      let next = await service.download(setProgress);
      if (phone && !bridge) {
        // The phone tries it itself (Kotlin), and the result is kept with the pack.
        setProgress({ phase: "test", done: 0, total: 1 });
        await androidStudioSelfTest().catch(() => null);
        next = await service.status();
      }
      setStatus(next);
      showToast(next.mode === "tooSlow" ? "Studio voice installed, but too slow here to read with" : "Studio voice ready");
    } catch (error) {
      const message = studioError(error);
      if (message !== "cancelled") showToast(message);
      void look();
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const cancel = () => void service.cancel().catch(() => {});

  const remove = async () => {
    if (busy) return;
    setBusy("remove");
    setPlaying(null);
    try {
      const freed = await service.remove();
      showToast(`Studio voice removed · ${formatBytes(freed)} freed`);
      await look();
    } catch (error) {
      showToast(studioError(error));
    } finally {
      setBusy(null);
    }
  };

  const choose = (id: string) => savePrefsWith({ voices: { ...loadPrefs(storage()).voices, [LANG]: id } });

  const preview = (id: string) => {
    if (playing === id) {
      setPlaying(null);
      if (phone && !bridge) void android.readAloud("stop");
      else void service.stopPreview().catch(() => {});
      return;
    }
    setPlaying(id);
    if (phone && !bridge) {
      // The phone's read-aloud service says it, in the Studio voice, at the speed chosen.
      const sample = "The lamp was lit, the tea was warm, and the next page was waiting.";
      void (async () => {
        await android.readAloud("voice", { voice: id, language: "en" });
        await android.readAloud("rate", { rate });
        await android.readAloud("speak", { items: [{ id: "preview", text: sample, marks: [0] }], replace: true });
      })().catch(() => setPlaying(null));
      window.setTimeout(() => setPlaying((now) => (now === id ? null : now)), 6000);
      return;
    }
    service.preview(id, rate).catch((error) => {
      setPlaying(null);
      showToast(studioError(error));
    });
  };

  const commitRate = () => {
    const next = RATES[rateStep];
    if (next !== undefined && Math.abs(next - prefs.rate) > 0.001) savePrefsWith({ rate: next });
  };

  const heading = "flex items-center gap-1.5 text-xs uppercase tracking-widest text-on-surface-variant";
  const about = phone
    ? "Leaflet's own natural voices, made on this phone and read offline once downloaded. The phone's voice stays the one used unless you pick one of these."
    : "Leaflet's own natural voices, made on this computer and read offline once downloaded. Once it is here it reads by itself, unless you pick another voice.";
  const percent = progress && progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;

  return (
    <section className="paper-surface rounded-xl p-5" aria-labelledby="studio-voice-title" data-studio-voice={phone ? "phone" : "desktop"}>
      <p id="studio-voice-title" className={heading}>
        Studio voice
        <InfoTip className="normal-case tracking-normal" text={about} />
      </p>

      {status?.installed && busy !== "download" ? (
        <>
          <div className="mt-3 flex flex-col gap-2" role="radiogroup" aria-label="Studio voice">
            {status.voices.map((voice) => (
              <div key={voice.id} className="flex items-center gap-2">
                <button
                  type="button"
                  role="radio"
                  aria-checked={voice.id === voiceId}
                  className={`inset-field flex min-w-0 flex-1 items-center justify-between px-4 py-2.5 text-sm transition hover:text-primary ${
                    voice.id === voiceId ? "text-primary" : "text-on-surface"
                  }`}
                  onClick={() => choose(voice.id)}
                >
                  <span className="truncate">{voice.name}</span>
                  <span className="text-[11px] text-on-surface-variant">{voice.lang === "en-GB" ? "British" : "American"}</span>
                </button>
                <button
                  type="button"
                  className="liquid-pill grid h-9 w-9 shrink-0 place-items-center text-on-surface transition hover:text-primary"
                  aria-label={playing === voice.id ? `Stop ${voice.name}` : `Hear ${voice.name}`}
                  aria-pressed={playing === voice.id}
                  onClick={() => preview(voice.id)}
                  disabled={!phone && !status.canSpeak}
                >
                  <span aria-hidden="true" className="text-xs">
                    {playing === voice.id ? "■" : "▶"}
                  </span>
                </button>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <span className="text-[10px] uppercase tracking-widest text-on-surface-variant">Speed</span>
            <input
              type="range"
              className="min-w-0 flex-1"
              min={0}
              max={RATES.length - 1}
              step={1}
              value={rateStep}
              aria-label="Reading speed"
              aria-valuetext={rateLabel(rate)}
              onChange={(event) => setRateStep(Number(event.target.value))}
              onPointerUp={commitRate}
              onKeyUp={commitRate}
              onBlur={commitRate}
            />
            <span className="w-10 text-right text-xs tabular-nums text-on-surface">{rateLabel(rate)}</span>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-xs text-on-surface-variant">
              {formatBytes(status.installedBytes)}
              <InfoTip text={modeNote(status, phone)} />
            </span>
            <button type="button" className="tactile-button px-4 py-2 text-xs" onClick={() => void remove()}>
              Remove
            </button>
          </div>
        </>
      ) : busy === "download" && progress ? (
        <div className="mt-3">
          <div
            className="liquid-pill h-2.5 w-full overflow-hidden"
            role="progressbar"
            aria-label="Downloading the Studio voice"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${percent}%` }} />
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-xs text-on-surface-variant">
            <span className="tabular-nums">
              {PHASE[progress.phase]}
              {progress.phase === "download" ? ` · ${formatBytes(progress.done)} of ${formatBytes(progress.total)}` : ""}
            </span>
            <button type="button" className="tactile-button px-3 py-1.5 text-xs" onClick={cancel} disabled={progress.phase === "install" || progress.phase === "test"}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-on-surface">{phone ? "Natural voices, on this phone" : "Very natural reading voices"}</p>
            <p className="text-xs text-on-surface-variant">{formatBytes(status?.downloadBytes ?? STUDIO_APPROX_BYTES)}</p>
          </div>
          <button
            type="button"
            className={`tactile-button ${phone ? "" : "tactile-button-primary"} shrink-0 px-4 py-2 text-xs`}
            onClick={() => void download()}
            disabled={busy !== null}
          >
            {status && status.partialBytes > 0 ? "Resume" : "Download"}
          </button>
        </div>
      )}
    </section>
  );
};
