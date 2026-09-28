import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { GAMES, GAME_H, GAME_W, type Controls, type Game, type GameId, type GameInfo } from "./games";
import { gameArt } from "./gameArt";
import { pixelsPerArtPixel } from "../PixelImage";
import { UiIcon } from "../../UiIcon";

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

const BEST_KEY = "leaflet.pip.arcadeBest";
/** Best scores kept in the browser too, for the dev server (no Rust there). */
const readLocalBest = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
};

export type ArcadeOverlayProps = {
  skin: string;
  outfit: readonly string[];
  /** Best scores from Rust (per device). */
  best: Record<string, number>;
  /** Mood games have given today, and the cap. */
  moodToday: number;
  moodCap: number;
  /** Records a finished game; resolves with the mood it added. */
  onFinished: (game: GameId, score: number) => Promise<number>;
  onClose: () => void;
};

/**
 * The Attic Arcade: pick a game, play it in a crisp pixel canvas.
 *
 * The loop runs on requestAnimationFrame only while a game is on screen and
 * not paused; it stops when the overlay closes, when the window loses focus
 * (the game pauses), and when the tab is hidden. Keys are captured while the
 * overlay is open, so Space and the arrows never page a book underneath.
 *
 * Games never earn seeds (those come only from reading in focus). A finished
 * game cheers Pip up a little, up to a daily cap, and keeps a best score.
 */
export const ArcadeOverlay = ({ skin, outfit, best, moodToday, moodCap, onFinished, onClose }: ArcadeOverlayProps) => {
  const [chosen, setChosen] = useState<GameInfo | null>(null);
  const [localBest, setLocalBest] = useState(readLocalBest);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const bestOf = (id: string) => Math.max(best[id] ?? 0, localBest[id] ?? 0);

  // Focus into the overlay, and back where it came from on close.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => before?.focus?.();
  }, []);

  const finished = useCallback(
    async (game: GameId, score: number) => {
      setLocalBest((current) => {
        if ((current[game] ?? 0) >= score) return current;
        const next = { ...current, [game]: score };
        try {
          localStorage.setItem(BEST_KEY, JSON.stringify(next));
        } catch {
          // Rust keeps the real record.
        }
        return next;
      });
      try {
        return await onFinished(game, score);
      } catch {
        return 0;
      }
    },
    [onFinished]
  );

  return (
    <div className="pip-arcade-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className="pip-arcade modal-surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pip-arcade-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !chosen) {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Attic Arcade</p>
            <h2 id="pip-arcade-title" className="page-title text-2xl text-on-surface">
              {chosen ? chosen.name : "Pick a game"}
            </h2>
          </div>
          <button type="button" className="tactile-button px-3 py-1.5 text-xs" onClick={chosen ? () => setChosen(null) : onClose}>
            {chosen ? "All games" : "Close"}
          </button>
        </div>

        {chosen ? (
          <GameScreen
            key={chosen.id}
            game={chosen}
            skin={skin}
            outfit={outfit}
            best={bestOf(chosen.id)}
            onFinished={finished}
            onExit={() => setChosen(null)}
          />
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {GAMES.map((game) => (
              <button key={game.id} type="button" className="pip-arcade-pick" onClick={() => setChosen(game)}>
                <span className="font-headline text-lg font-bold text-on-surface">{game.name}</span>
                <span className="text-xs text-on-surface-variant">{game.blurb}</span>
                <span className="mt-auto text-[11px] font-semibold text-on-surface-variant">Best: {bestOf(game.id)}</span>
              </button>
            ))}
          </div>
        )}

        <p className="mt-4 text-xs text-on-surface-variant">
          Games don't earn seeds: those come only from reading in focus. Playing cheers Pip up a little
          {moodToday >= moodCap ? " (that's all the cheering games can do today)." : ` (up to +${moodCap} mood a day).`}
        </p>
      </div>
    </div>
  );
};

type GameScreenProps = {
  game: GameInfo;
  skin: string;
  outfit: readonly string[];
  best: number;
  onFinished: (game: GameId, score: number) => Promise<number>;
  onExit: () => void;
};

const GameScreen = ({ game, skin, outfit, best, onFinished, onExit }: GameScreenProps) => {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [per, setPer] = useState(2);
  const [hud, setHud] = useState({ score: 0, lives: null as number | null, over: false, ready: true });
  const [paused, setPaused] = useState(false);
  const [result, setResult] = useState<{ score: number; mood: number; newBest: boolean } | null>(null);
  const runs = useRef(0);
  const [run, setRun] = useState(0);

  // Crisp: a whole number of device pixels per game pixel that fits the box.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => setPer(pixelsPerArtPixel(GAME_W, GAME_H, wrap.clientWidth, Math.max(180, window.innerHeight * 0.55)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.imageSmoothingEnabled = false;

    const reduced = prefersReducedMotion();
    const art = gameArt(game.id, skin, outfit);
    // Each run gets the next seed: different obstacles, the same curve.
    const sim: Game = game.create(0x5eed + runs.current * 7919);
    const controls: Controls = { up: false, down: false, left: false, right: false, pressed: 0, pointerX: null };
    let raf = 0;
    let last = 0;
    let acc = 0;
    let elapsed = 0;
    let isPaused = false;
    let reported = false;
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
        const score = sim.score;
        void onFinished(game.id, score).then((mood) => setResult({ score, mood, newBest: score > best }));
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
      if (down && sim.over && (JUMP.has(event.key) || event.key === "Enter")) {
        if (!event.repeat) restart();
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
        restart();
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
  }, [game, skin, outfit, run]);

  const ratio = window.devicePixelRatio || 1;
  const cssW = (GAME_W * per) / ratio;
  const cssH = (GAME_H * per) / ratio;
  const status = paused
    ? "Paused. Press Space or tap to carry on."
    : hud.over
      ? `Game over. Score ${hud.score}. Press Space or tap to play again.`
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
        <p className="text-xs text-on-surface-variant tabular-nums">Best {Math.max(best, result?.score ?? 0)}</p>
      </div>
      <div ref={wrapRef} className="pip-arcade-screen mt-2">
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
          <div className="pip-arcade-status" aria-hidden="true">
            <p>{hud.ready && !paused ? "Press Space or tap to start" : paused ? "Paused" : "Game over"}</p>
            {hud.over && result && (
              <p className="text-xs">
                {result.newBest ? "New best! " : ""}
                {result.mood > 0 ? `Pip cheered up (+${result.mood} mood).` : "Pip had fun."}
              </p>
            )}
          </div>
        )}
      </div>
      <p className="sr-only" aria-live="polite">
        {status}
        {hud.over && result ? ` ${result.newBest ? "New best." : ""} ${result.mood > 0 ? `Pip's mood went up by ${result.mood}.` : ""}` : ""}
      </p>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-on-surface-variant">
        <UiIcon name="hand" size={13} />
        {game.controls} Esc pauses.
      </p>
    </div>
  );
};
