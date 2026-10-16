import { useState } from "react";
import { AudioLines, Info, LocateFixed, Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import type { ReaderScope } from "../text/scope";
import { RATES, rateLabel } from "./prefs";
import { openSpeechSettings } from "./androidEngine";
import "./readAloud.css";

/**
 * Reading aloud's own controls, there while it reads: a sentence back,
 * play or pause, a sentence on, the speed, the voice, stop. "Follow" comes
 * up beside them once the reader has moved the page away from the voice.
 */
export const ReadAloudPill = ({ reader }: { reader: ReaderScope }) => {
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
      {readAloud.active && readAloud.sheetOpen && (
        <div className="read-aloud-sheet reader-panel reader-border" role="dialog" aria-label="Voice and speed">
          <div className="text-[10px] uppercase tracking-widest reader-muted">Speed</div>
          <div className="read-aloud-rates" role="radiogroup" aria-label="Speed">
            {RATES.map((rate) => (
              <button
                key={rate}
                type="button"
                role="radio"
                aria-checked={Math.abs(readAloud.rate - rate) < 0.001}
                className={`reader-notes-tab ${Math.abs(readAloud.rate - rate) < 0.001 ? "is-active" : ""}`}
                onClick={() => readAloud.setRate(rate)}
              >
                {rateLabel(rate)}
              </button>
            ))}
          </div>
          <div className="mt-3 text-[10px] uppercase tracking-widest reader-muted">Voice</div>
          <div className="read-aloud-voices" role="radiogroup" aria-label="Voice">
            {readAloud.voices.map((voice) => (
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
                {voice.online && <span className="read-aloud-tag reader-muted">online</span>}
              </button>
            ))}
          </div>
        </div>
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
