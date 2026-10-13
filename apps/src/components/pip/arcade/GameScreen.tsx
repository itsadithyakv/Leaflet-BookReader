import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { GAME_H, GAME_W, type Controls, type Game, type GameId, type GameInfo } from "./games";
import { gameArt } from "./gameArt";
import { pixelsPerArtPixel } from "../PixelImage";
import { UiIcon } from "../../UiIcon";

/**
 * One of the arcade's games on its screen: the canvas in its old television
 * set, the loop, the keys and the pointer, pausing, and how a run ended. The
 * games themselves are plain simulations (`games.ts`); the overlay picks one
 * and says what a finished run gave.
 */

/** Simulation ticks per second: fixed, so a run plays the same at any frame rate. */
const TICK = 1 / 120;
/** Longest real time folded into one frame, so a stall does not teleport Pip. */
const MAX_FRAME = 1 / 20;
/** Sprite animation rate, like every other Pip. */
const ART_FPS = 12;

const prefersReducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/**
 * How long a finished game stays as it ended before a press starts the next.
 * A press used to start it at once, and the press was nearly always the jump
 * that came too late: the game was gone before the reader saw how it ended.
 */
const PLAY_AGAIN_AFTER_MS = 900;

/** What a finished game gave: mood for Pip, acorns for the camp, and how a wager on it went (null for none). */
export type Winnings = { mood: number; paid: number; wager: { won: boolean; stake: number } | null };

type GameScreenProps = {
  game: GameInfo;
  skin: string;
  outfit: readonly string[];
  best: number;
  onFinished: (game: GameId, score: number) => Promise<Winnings>;
  onExit: () => void;
  /** Shown under the screen while no run is on: before the first press, and after a game is over. */
  between?: ReactNode;
};

export const GameScreen = ({ game, skin, outfit, best, onFinished, onExit, between }: GameScreenProps) => {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [per, setPer] = useState(2);
  const [hud, setHud] = useState({ score: 0, lives: null as number | null, over: false, ready: true });
  const [paused, setPaused] = useState(false);
  const [result, setResult] = useState<({ score: number; newBest: boolean } & Winnings) | null>(null);
  // Whether a press starts the next game yet (PLAY_AGAIN_AFTER_MS).
  const [again, setAgain] = useState(false);
  const runs = useRef(0);
  const [run, setRun] = useState(0);
  // The running game's pause switch, for the Pause key (a pointer has no Esc).
  const pauseSwitch = useRef<(() => void) | null>(null);
  // What Pip wears, by what it is and not by which list holds it. Recording a
  // finished game brings back a fresh overview, and with it a new list of the
  // same clothes: a game that began again for every new list began again the
  // moment it ended, and the reader never saw how it went.
  const wornKey = outfit.join("|");
  const worn = useRef(outfit);
  worn.current = outfit;

  // Crisp: a whole number of device pixels per game pixel that fits the box.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    // The set's own frame takes 32 px of the width. The arcade fills the
    // window, so the game has all the height the window can give it.
    const measure = () => setPer(pixelsPerArtPixel(GAME_W, GAME_H, wrap.clientWidth - 32, Math.max(180, window.innerHeight * 0.7)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.imageSmoothingEnabled = false;

    const reduced = prefersReducedMotion();
    const art = gameArt(game.id, skin, worn.current);
    // Each run gets the next seed: different obstacles, the same curve.
    const sim: Game = game.create(0x5eed + runs.current * 7919);
    const controls: Controls = { up: false, down: false, left: false, right: false, pressed: 0, pointerX: null };
    let raf = 0;
    let last = 0;
    let acc = 0;
    let elapsed = 0;
    let isPaused = false;
    let reported = false;
    // When the game ended, and the timer that then lets the next one start.
    let overAt = Infinity;
    let againTimer = 0;
    const mayPlayAgain = () => performance.now() - overAt >= PLAY_AGAIN_AFTER_MS;
    let lastHud = "";

    const draw = () => {
      ctx.save();
      ctx.clearRect(0, 0, GAME_W, GAME_H);
      if (sim.shake > 0 && !reduced) {
        ctx.translate(Math.round((Math.random() - 0.5) * 4), Math.round((Math.random() - 0.5) * 3));
      }
      sim.draw(ctx, art, Math.floor(elapsed * ART_FPS));
      ctx.restore();
    };

    const syncHud = () => {
      const next = { score: sim.score, lives: sim.lives, over: sim.over, ready: sim.ready };
      const key = JSON.stringify(next);
      if (key !== lastHud) {
        lastHud = key;
        setHud(next);
      }
    };

    const frame = (time: number) => {
      const dt = last ? Math.min(MAX_FRAME, (time - last) / 1000) : 0;
      last = time;
      acc += dt;
      elapsed += dt;
      while (acc >= TICK) {
        sim.step(TICK, controls);
        controls.pressed = 0;
        acc -= TICK;
      }
      draw();
      syncHud();
      if (sim.over && !reported) {
        reported = true;
        overAt = performance.now();
        againTimer = window.setTimeout(() => setAgain(true), PLAY_AGAIN_AFTER_MS);
        const score = sim.score;
        void onFinished(game.id, score).then((won) => setResult({ score, ...won, newBest: score > best }));
      }
      // Once over, keep drawing a moment for the fall and the shake, then rest.
      if (!sim.over || sim.shake > 0 || elapsed < 0.5) {
        raf = requestAnimationFrame(frame);
      } else {
        raf = 0;
      }
    };

    const start = () => {
      if (!raf && !isPaused) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    };
    const pause = () => {
      if (sim.over || sim.ready) return;
      isPaused = true;
      setPaused(true);
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const resume = () => {
      if (!isPaused) return;
      isPaused = false;
      setPaused(false);
      start();
    };

    pauseSwitch.current = () => (isPaused ? resume() : pause());

    const JUMP = new Set([" ", "Spacebar", "ArrowUp", "w", "W"]);
    const onKey = (event: KeyboardEvent, down: boolean) => {
      if (event.key === "Escape") {
        if (down) {
          event.preventDefault();
          event.stopPropagation();
          if (isPaused || sim.over || sim.ready) onExit();
          else pause();
        }
        return;
      }
      if (event.key === "Tab") return;
      const handled = JUMP.has(event.key) || ["ArrowDown", "ArrowLeft", "ArrowRight", "s", "S", "a", "A", "d", "D", "Enter"].includes(event.key);
      if (!handled) return;
      event.preventDefault();
      event.stopPropagation();
      if (down && isPaused) {
        resume();
        return;
      }
      if (sim.over) {
        // Not at once: the jump that came too late is not "play again".
        if (down && !event.repeat && mayPlayAgain() && (JUMP.has(event.key) || event.key === "Enter")) restart();
        return;
      }
      if (JUMP.has(event.key)) {
        if (down && !event.repeat) controls.pressed += 1;
        controls.up = down;
      }
      if (event.key === "ArrowDown" || event.key === "s" || event.key === "S") controls.down = down;
      if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") controls.left = down;
      if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") controls.right = down;
      if (down) start();
    };
    const keyDown = (event: KeyboardEvent) => onKey(event, true);
    const keyUp = (event: KeyboardEvent) => onKey(event, false);

    const toGame = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return ((event.clientX - rect.left) / rect.width) * GAME_W;
    };
    const pointerDown = (event: PointerEvent) => {
      event.preventDefault();
      if (isPaused) {
        resume();
        return;
      }
      if (sim.over) {
        if (mayPlayAgain()) restart();
        return;
      }
      controls.pressed += 1;
      controls.up = true;
      controls.pointerX = game.id === "catch" ? toGame(event) : null;
      start();
    };
    const pointerMove = (event: PointerEvent) => {
      if (game.id === "catch" && (event.buttons > 0 || event.pointerType === "mouse")) controls.pointerX = toGame(event);
    };
    const pointerUp = () => {
      controls.up = false;
    };
    const pointerLeave = () => {
      controls.pointerX = null;
    };

    const restart = () => {
      runs.current += 1;
      setResult(null);
      setAgain(false);
      setRun(runs.current);
    };

    const onBlur = () => pause();
    const onVisibility = () => {
      if (document.visibilityState !== "visible") pause();
    };

    window.addEventListener("keydown", keyDown, true);
    window.addEventListener("keyup", keyUp, true);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointerleave", pointerLeave);
    // Running from the start, so the waiting screen breathes; a closed or
    // paused game stops the loop entirely.
    start();
    canvas.focus();

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(againTimer);
      pauseSwitch.current = null;
      window.removeEventListener("keydown", keyDown, true);
      window.removeEventListener("keyup", keyUp, true);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointerleave", pointerLeave);
    };
    // `best` is read once per run for the "new best" note.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, skin, wornKey, run]);

  const ratio = window.devicePixelRatio || 1;
  const cssW = (GAME_W * per) / ratio;
  const cssH = (GAME_H * per) / ratio;
  const status = paused
    ? "Paused. Press Space or tap to carry on."
    : hud.over
      ? `Game over. Score ${hud.score}.${again ? " Press Space or tap to play again." : ""}`
      : hud.ready
        ? `Press Space or tap to start. ${game.controls}`
        : null;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="font-semibold tabular-nums text-on-surface">
          Score {hud.score}
          {hud.lives !== null && <span className="ml-3 text-on-surface-variant">Lives {"●".repeat(hud.lives)}{"○".repeat(Math.max(0, 3 - hud.lives))}</span>}
        </p>
        <p className="flex items-center gap-3 text-xs text-on-surface-variant tabular-nums">
          Best {Math.max(best, result?.score ?? 0)}
          {/* While a run is on: pause it, or carry on. */}
          {!hud.ready && !hud.over && (
            <button type="button" className="tactile-button px-2.5 py-1 text-xs" aria-pressed={paused} onClick={() => pauseSwitch.current?.()}>
              {paused ? "Resume" : "Pause"}
            </button>
          )}
        </p>
      </div>
      <div ref={wrapRef} className="pip-arcade-screen mt-2">
        {/* An old television set: the frame, and the glass with its lines over the picture. */}
        <div className="pip-crt">
          <div className="pip-crt-glass" style={{ "--crt-line": `${cssW / GAME_W}px` } as CSSProperties}>
            <canvas
              ref={canvasRef}
              width={GAME_W}
              height={GAME_H}
              tabIndex={0}
              className="pip-sprite pip-arcade-canvas"
              style={{ width: cssW, height: cssH }}
              aria-label={`${game.name}. ${game.controls}`}
            />
            {status && (
              <div className={`pip-arcade-status${hud.over && !paused ? " is-over" : ""}`} aria-hidden="true">
                <p>{hud.ready && !paused ? "Press Space or tap to start" : paused ? "Paused" : "Game over"}</p>
                {hud.over && !paused && (
                  <p className="pip-arcade-final">
                    Score {hud.score}
                    <span>Best {Math.max(best, hud.score)}</span>
                  </p>
                )}
                {hud.over && result && (
                  <p className="text-xs">
                    {result.newBest ? "New best! " : ""}
                    {result.mood > 0 ? `Pip cheered up (+${result.mood} mood).` : "Pip had fun."}
                    {result.paid > 0 && (
                      <span className="pip-arcade-acorns" title="For the Hollow, Pip's camp">
                        +{result.paid} acorns
                      </span>
                    )}
                    {result.wager && (
                      <span className="pip-arcade-acorns">
                        {result.wager.won ? `Wager won: +${result.wager.stake} acorns` : `Wager lost: ${result.wager.stake} acorns`}
                      </span>
                    )}
                  </p>
                )}
                {hud.over && !paused && <p className={`pip-arcade-again${again ? " is-on" : ""}`}>Space or tap to play again</p>}
              </div>
            )}
          </div>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {status}
        {hud.over && result ? ` ${result.newBest ? "New best." : ""} ${result.mood > 0 ? `Pip's mood went up by ${result.mood}.` : ""}` : ""}
        {hud.over && result && result.paid > 0 ? ` ${result.paid} acorns for the camp.` : ""}
        {hud.over && result?.wager ? ` ${result.wager.won ? `Wager won: ${result.wager.stake} acorns.` : `Wager lost: ${result.wager.stake} acorns.`}` : ""}
      </p>
      {(hud.ready || hud.over) && between}
      <p className="mt-2 flex items-center gap-1.5 text-xs text-on-surface-variant">
        <UiIcon name="hand" size={13} />
        {game.controls} Esc pauses.
      </p>
    </div>
  );
};
