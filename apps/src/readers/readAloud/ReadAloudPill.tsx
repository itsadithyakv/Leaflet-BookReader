import { useEffect, useState } from "react";
import { AudioLines, Info, LocateFixed, Pause, Play, SkipBack, SkipForward, Sparkles, X } from "lucide-react";
import type { ReadAloudControls } from "./useReadAloudCore";
import { RATES, rateLabel } from "./prefs";
import { openSpeechSettings } from "./androidEngine";
import "./readAloud.css";

/** The speed as a step of `RATES` (for the slider), the nearest one. */
const stepOf = (rate: number) =>
  RATES.reduce((best, step, index) => (Math.abs(step - rate) < Math.abs(RATES[best] - rate) ? index : best), 0);

/**
 * The speed, a tenth at a time: a slider whose speed is heard once it is let
 * go (each new speed starts the voice again from its word).
 */
const RateSlider = ({ rate, onRate }: { rate: number; onRate: (rate: number) => void }) => {
  const [step, setStep] = useState(() => stepOf(rate));
  useEffect(() => setStep(stepOf(rate)), [rate]);
  const commit = () => {
    if (Math.abs(RATES[step] - rate) > 0.001) onRate(RATES[step]);
  };
  return (
    <div className="read-aloud-rate">
      <input
        type="range"
        min={0}
        max={RATES.length - 1}
        step={1}
        value={step}
        aria-label="Speed"
        aria-valuetext={rateLabel(RATES[step])}
        onChange={(event) => setStep(Number(event.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <span className="read-aloud-rate-value tabular-nums reader-text-color">{rateLabel(RATES[step])}</span>
    </div>
  );
};

/** Seconds as m:ss. */
const clock = (seconds: number) => {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

/**
 * A studio voice preparing the chapter before it starts (a device too slow to
 * read it live): a ring filling as the wait runs down, the time left, and the
 * device's own voice to read now instead. It starts by itself when ready.
 */
const Preparing = ({ seconds, android, onPhoneVoice }: { seconds: number; android: boolean; onPhoneVoice: (() => void) | null }) => {
  const [total, setTotal] = useState(seconds);
  useEffect(() => setTotal((was) => Math.max(was, seconds)), [seconds]);
  const done = total > 0 ? Math.min(1, Math.max(0, 1 - seconds / total)) : 0;
  const around = 2 * Math.PI * 7;
  return (
    <div className="read-aloud-preparing reader-panel reader-border" role="status" aria-live="polite">
      <svg className="read-aloud-ring reader-accent" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <circle className="read-aloud-ring-track" cx="9" cy="9" r="7" />
        <circle className="read-aloud-ring-fill" cx="9" cy="9" r="7" strokeDasharray={around} strokeDashoffset={around * (1 - done)} />
      </svg>
      <span className="tabular-nums reader-text-color">Preparing · {clock(seconds)}</span>
      {onPhoneVoice && (
        <button type="button" className="read-aloud-link reader-accent" onClick={onPhoneVoice}>
          {android ? "Use phone voice now" : "Use system voice now"}
        </button>
      )}
    </div>
  );
};

/**
 * Reading aloud's own controls, there while it reads: a sentence back,
 * play or pause, a sentence on, the speed, the voice, stop. "Follow" comes
 * up beside them once the reader has moved the page away from the voice.
 * The same in both readers (each hands in its own `readAloud`).
 */
export const ReadAloudPill = ({ reader }: { reader: { readAloud: ReadAloudControls } }) => {
  const { readAloud } = reader;
  const [infoOpen, setInfoOpen] = useState(false);
  const android = readAloud.engineKind === "android";
  const playing = readAloud.status === "playing" || readAloud.status === "loading";
  return (
    <div className="read-aloud-dock">
      {readAloud.notice === "noVoice" && (
        <div className="read-aloud-notice reader-panel reader-border" role="status">
          <span>No voice for this book's language on this device</span>
          <button
            type="button"
            className="read-aloud-icon reader-icon reader-hover-accent"
            aria-label="How to add a voice"
            aria-expanded={infoOpen}
            onClick={() => setInfoOpen((open) => !open)}
          >
            <Info size={16} aria-hidden="true" />
          </button>
          <button type="button" className="read-aloud-icon reader-icon reader-hover-accent" aria-label="Close" onClick={readAloud.dismissNotice}>
            <X size={16} aria-hidden="true" />
          </button>
          {infoOpen && (
            <div className="read-aloud-info reader-muted">
              {android ? (
                <>
                  Add one in Settings › Text-to-speech.{" "}
                  <button type="button" className="read-aloud-link reader-accent" onClick={openSpeechSettings}>
                    Open settings
                  </button>
                </>
              ) : (
                "Add one in Windows Settings › Time & language › Speech."
              )}
            </div>
          )}
        </div>
      )}
      {(readAloud.notice === "noText" || readAloud.notice === "noTextBook") && (
        <div className="read-aloud-notice reader-panel reader-border" role="status">
          <span>{readAloud.notice === "noTextBook" ? "This PDF has no text to read" : "No text to read on this page"}</span>
          <button
            type="button"
            className="read-aloud-icon reader-icon reader-hover-accent"
            aria-label="Why"
            aria-expanded={infoOpen}
            onClick={() => setInfoOpen((open) => !open)}
          >
            <Info size={16} aria-hidden="true" />
          </button>
          <button type="button" className="read-aloud-icon reader-icon reader-hover-accent" aria-label="Close" onClick={readAloud.dismissNotice}>
            <X size={16} aria-hidden="true" />
          </button>
          {infoOpen && <div className="read-aloud-info reader-muted">Scanned pages are pictures: there are no words in them to read aloud.</div>}
        </div>
      )}
      {readAloud.active && readAloud.sheetOpen && (
        <div className="read-aloud-sheet reader-panel reader-border" role="dialog" aria-label="Voice and speed">
          <div className="text-[10px] uppercase tracking-widest reader-muted">Speed</div>
          <RateSlider rate={readAloud.rate} onRate={readAloud.setRate} />
          <div className="mt-3 text-[10px] uppercase tracking-widest reader-muted">Voice</div>
          <div className="read-aloud-voices" role="radiogroup" aria-label="Voice">
            {readAloud.voices.map((voice, index, all) => [
              // Leaflet's own downloaded voices first, under a heading of their own, then the device's.
              all.some((entry) => entry.studio) && (index === 0 || Boolean(all[index - 1].studio) !== Boolean(voice.studio)) && (
                <div key={`group-${voice.studio ? "studio" : "system"}`} className="read-aloud-group reader-muted">
                  {voice.studio ? "Studio voices" : "On this device"}
                </div>
              ),
              <button
                key={voice.id}
                type="button"
                role="radio"
                aria-checked={voice.id === readAloud.voiceId}
                className={`read-aloud-voice ${voice.id === readAloud.voiceId ? "is-active reader-accent" : "reader-text-color"}`}
                onClick={() => readAloud.chooseVoice(voice)}
                title={voice.lang}
              >
                <span className="truncate">{voice.name}</span>
                <span className="read-aloud-tags">
                  {voice.online && <span className="read-aloud-tag reader-muted">online</span>}
                  {voice.studio && voice.slow && (
                    <span
                      className="read-aloud-best reader-muted"
                      title={android ? "Prepares each chapter before reading on this phone" : "Prepares each chapter before reading on this computer"}
                      aria-label="Prepares each chapter before reading"
                    >
                      <Info size={12} aria-hidden="true" />
                    </span>
                  )}
                  {voice.id === readAloud.bestVoiceId && readAloud.voices.length > 1 && (
                    <span className="read-aloud-best reader-accent" title="Sounds best on this device" aria-label="Sounds best on this device">
                      <Sparkles size={12} aria-hidden="true" />
                    </span>
                  )}
                </span>
              </button>
            ])}
          </div>
        </div>
      )}
      {readAloud.active && readAloud.preparing !== null && (
        <Preparing seconds={readAloud.preparing} android={android} onPhoneVoice={readAloud.usePhoneVoice} />
      )}
      {readAloud.active && !readAloud.following && (
        <button type="button" className="read-aloud-follow reader-panel reader-border reader-accent" onClick={readAloud.follow} title="Back to the sentence being read">
          <LocateFixed size={15} aria-hidden="true" />
          <span>Follow</span>
        </button>
      )}
      {readAloud.active && (
        <div className="read-aloud-pill reader-panel reader-border" role="group" aria-label="Read aloud">
          <button type="button" className="read-aloud-button reader-icon reader-hover-accent" onClick={readAloud.previous} title="A sentence back" aria-label="A sentence back">
            <SkipBack size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="read-aloud-button is-main reader-accent"
            onClick={playing ? readAloud.pause : readAloud.resume}
            title={playing ? "Pause (R)" : "Carry on (R)"}
            aria-label={playing ? "Pause" : "Carry on"}
          >
            {playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
          </button>
          <button type="button" className="read-aloud-button reader-icon reader-hover-accent" onClick={readAloud.next} title="A sentence on" aria-label="A sentence on">
            <SkipForward size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="read-aloud-button is-rate reader-icon reader-hover-accent tabular-nums"
            onClick={readAloud.cycleRate}
            title="Speed"
            aria-label={`Speed ${rateLabel(readAloud.rate)}`}
          >
            {rateLabel(readAloud.rate)}
          </button>
          <button
            type="button"
            className={`read-aloud-button reader-icon reader-hover-accent ${readAloud.sheetOpen ? "is-open" : ""}`}
            onClick={() => readAloud.setSheetOpen((open) => !open)}
            title="Voice and speed"
            aria-label="Voice and speed"
            aria-expanded={readAloud.sheetOpen}
          >
            <AudioLines size={17} aria-hidden="true" />
          </button>
          <button type="button" className="read-aloud-button reader-icon reader-hover-accent" onClick={readAloud.stop} title="Stop reading aloud" aria-label="Stop reading aloud">
            <X size={17} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
};
