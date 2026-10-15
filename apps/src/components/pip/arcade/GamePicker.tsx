import { useEffect, useRef, useState, type ReactNode } from "react";
import { BookA, Feather, Footprints, Leaf, Trophy, type LucideIcon } from "lucide-react";
import { gameArt } from "./gameArt";
import { GAMES, GAME_H, GAME_W, type Controls, type Game, type GameId, type GameInfo } from "./games";
import { useTouchInput } from "../../../platform/device";

/**
 * The arcade's front page: what there is to play, each as a card with a
 * picture of the game itself, what it is about and how it is played.
 *
 * The pictures are not drawings of the games: they are the games. Each card
 * runs its game with nobody at the controls but a few taps on a timer, far
 * enough for something to be on screen, and holds that frame. Under the
 * pointer, or with the keyboard on it, the card's game plays on by itself,
 * so a reader sees what it is before choosing it. The Hollow has no card
 * here: it is not a game in the cabinet but the place Pip's tab opens on.
 */

/** Canvas pixels to each game pixel in a card's picture: more than a card ever needs, brought down smoothly. */
const PREVIEW_PX = 3;
const TICK = 1 / 120;
/** How far into a game its card's still is taken. */
const STILL_AFTER_S = 3.2;
const ART_FPS = 12;

const prefersReducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/** A stand-in for a player: how each game is kept going on its card. Not good at any of them, which is the point. */
const DEMO: Record<GameId, (controls: Controls, time: number, tick: number) => void> = {
  dash: (controls, time, tick) => {
    // A hop every beat, held a little so it clears a stack.
    const beat = time % 0.78;
    controls.up = beat < 0.2;
    controls.pressed = beat < TICK || tick === 0 ? 1 : 0;
  },
  catch: (controls, time, tick) => {
    controls.pressed = tick === 0 ? 1 : 0;
    controls.pointerX = GAME_W / 2 + Math.sin(time * 1.7) * 78 + Math.sin(time * 0.6) * 20;
  },
  flap: (controls, time, tick) => {
    controls.pressed = time % 0.46 < TICK || tick === 0 ? 1 : 0;
  }
};

const GAME_ICONS: Record<GameId, LucideIcon> = { dash: Footprints, catch: Leaf, flap: Feather };

/** What each game is about, in a sentence more than its name; and how it is played, a key at a time. */
/** `touch`: the same, for a finger (a phone has no keys to name). */
const ABOUT: Record<GameId, { about: string; keys: ReadonlyArray<[string, string]>; touch: ReadonlyArray<[string, string]> }> = {
  dash: {
    about: "An endless run along the library's shelves. The stacks get taller and the bats lower the further Pip gets.",
    keys: [
      ["Space", "jump"],
      ["↓", "duck"]
    ],
    touch: [
      ["Tap", "jump"],
      ["Swipe ↓", "duck"]
    ]
  },
  catch: {
    about: "The claw machine has come loose: leaves, seeds and letters rain down. Fill the basket, and keep it out from under the ink.",
    keys: [["← →", "move"]],
    touch: [["Slide", "move"]]
  },
  flap: {
    about: "Pip takes to the air on a leaf, between towers of old books. Every flap is a little lift; the gaps do not wait.",
    keys: [["Space", "flap"]],
    touch: [["Tap", "flap"]]
  }
};

/** A game's own picture: the game, played by the stand-in. Still until `live`. */
const GamePreview = ({ game, skin, outfit, live }: { game: GameInfo; skin: string; outfit: readonly string[]; live: boolean }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const worn = outfit.join("|");
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const art = gameArt(game.id, skin, worn ? worn.split("|") : []);
    const demo = DEMO[game.id];
    const controls: Controls = { up: false, down: false, left: false, right: false, pressed: 0, pointerX: null };
    let seed = 0x5eed;
    let sim: Game = game.create(seed);
    let time = 0;
    let tick = 0;
    const step = () => {
      demo(controls, time, tick);
      sim.step(TICK, controls);
      time += TICK;
      tick += 1;
      // The stand-in loses, often. The card starts another run and nobody is told.
      if (sim.over) {
        seed += 7919;
        sim = game.create(seed);
        tick = 0;
      }
    };
    const draw = () => {
      ctx.setTransform(PREVIEW_PX, 0, 0, PREVIEW_PX, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, GAME_W, GAME_H);
      sim.draw(ctx, art, Math.floor(time * ART_FPS));
    };
    for (let warm = 0; warm < STILL_AFTER_S / TICK; warm++) step();
    draw();
    if (!live || prefersReducedMotion()) return;
    let raf = 0;
    let last = 0;
    let owed = 0;
    const frame = (now: number) => {
      owed += last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      while (owed >= TICK) {
        step();
        owed -= TICK;
      }
      draw();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [game, skin, worn, live]);
  return <canvas ref={canvasRef} width={GAME_W * PREVIEW_PX} height={GAME_H * PREVIEW_PX} className="pip-arcade-card-picture" aria-hidden="true" />;
};

/** The quiz's picture: Pip with a book, and three cards to choose from, one of them turned up. */
const QuizPreview = ({ skin, outfit, live }: { skin: string; outfit: readonly string[]; live: boolean }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const worn = outfit.join("|");
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const art = gameArt("base", skin, worn ? worn.split("|") : []);
    const draw = (seconds: number) => {
      ctx.setTransform(PREVIEW_PX, 0, 0, PREVIEW_PX, 0, 0);
      ctx.imageSmoothingEnabled = false;
      // A reading room at dusk: a wall, a floor, and a rug for Pip to stand on.
      ctx.fillStyle = "#2c3350";
      ctx.fillRect(0, 0, GAME_W, GAME_H);
      ctx.fillStyle = "#39426a";
      for (let stripe = 0; stripe < GAME_W; stripe += 24) ctx.fillRect(stripe, 0, 12, 86);
      ctx.fillStyle = "#6b4a2e";
      ctx.fillRect(0, 86, GAME_W, GAME_H - 86);
      ctx.fillStyle = "#8a6238";
      ctx.fillRect(0, 86, GAME_W, 3);
      // The answers: three cards, and the one being thought about lifts.
      const pick = Math.floor(seconds / 1.4) % 3;
      for (let card = 0; card < 3; card++) {
        const lifted = card === pick ? Math.round(Math.sin(((seconds % 1.4) / 1.4) * Math.PI) * 5) : 0;
        const x = 104 + card * 42;
        const y = 36 - lifted;
        ctx.fillStyle = "#1a1a22";
        ctx.fillRect(x - 1, y - 1, 36, 46);
        ctx.fillStyle = card === pick ? "#ffd86b" : "#fffbf0";
        ctx.fillRect(x, y, 34, 44);
        ctx.fillStyle = card === pick ? "#8a6238" : "#c9bfa3";
        for (let line = 0; line < 4; line++) ctx.fillRect(x + 5, y + 8 + line * 8, line === 3 ? 14 : 24, 2);
      }
      const pip = art.pip(live ? "read" : "idea", Math.floor(seconds * ART_FPS));
      ctx.drawImage(pip.image, 34, 86 - pip.h + 6);
    };
    draw(0.7);
    if (!live || prefersReducedMotion()) return;
    let raf = 0;
    const frame = (now: number) => {
      draw(now / 1000);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [skin, worn, live]);
  return <canvas ref={canvasRef} width={GAME_W * PREVIEW_PX} height={GAME_H * PREVIEW_PX} className="pip-arcade-card-picture" aria-hidden="true" />;
};

type CardProps = {
  name: string;
  about: string;
  icon: LucideIcon;
  /** What is said about it in a chip or two: a best score, a key and what it does. */
  facts: ReactNode;
  title?: string;
  onChoose: () => void;
  picture: (live: boolean) => ReactNode;
};

const Card = ({ name, about, icon: Icon, facts, title, onChoose, picture }: CardProps) => {
  // Its game plays while the pointer is on it, or the keyboard is.
  const [live, setLive] = useState(false);
  return (
    <button
      type="button"
      className="pip-arcade-card"
      title={title}
      onClick={onChoose}
      onPointerEnter={() => setLive(true)}
      onPointerLeave={() => setLive(false)}
      onFocus={() => setLive(true)}
      onBlur={() => setLive(false)}
    >
      <span className="pip-arcade-card-screen">{picture(live)}</span>
      <span className="pip-arcade-card-name">
        <span className="pip-arcade-card-icon" aria-hidden="true">
          <Icon size={16} />
        </span>
        {name}
      </span>
      <span className="pip-arcade-card-about">{about}</span>
      <span className="pip-arcade-card-facts">{facts}</span>
    </button>
  );
};

const key = ([cap, does]: readonly [string, string]) => (
  <span key={cap} className="pip-arcade-fact">
    <kbd>{cap}</kbd> {does}
  </span>
);

type Props = {
  skin: string;
  outfit: readonly string[];
  bestOf: (id: string) => number;
  /** What each game pays the camp: its card's tooltip. */
  termsOf: (id: GameId) => string;
  /** What the quiz has to say about the reader's words; null while not known. */
  words: string | null;
  onGame: (game: GameInfo) => void;
  onQuiz: () => void;
};

export const GamePicker = ({ skin, outfit, bestOf, termsOf, words, onGame, onQuiz }: Props) => {
  const touch = useTouchInput();
  return (
  <div className="pip-arcade-cards">
    {GAMES.map((game) => (
      <Card
        key={game.id}
        name={game.name}
        icon={GAME_ICONS[game.id]}
        about={ABOUT[game.id].about}
        title={`${touch ? game.touchControls : game.controls} ${termsOf(game.id)}`}
        facts={
          <>
            {bestOf(game.id) > 0 && (
              <span className="pip-arcade-fact is-best">
                <Trophy size={12} aria-hidden /> {bestOf(game.id)}
                <span className="sr-only"> is your best</span>
              </span>
            )}
            {(touch ? ABOUT[game.id].touch : ABOUT[game.id].keys).map(key)}
          </>
        }
        onChoose={() => onGame(game)}
        picture={(live) => <GamePreview game={game} skin={skin} outfit={outfit} live={live} />}
      />
    ))}
    <Card
      name="Word Quiz"
      icon={BookA}
      about="Pip holds up a word you looked up while reading. Pick what it means. The ones you miss come round again sooner."
      facts={<span className="pip-arcade-fact">{words ?? "…"}</span>}
      onChoose={onQuiz}
      picture={(live) => <QuizPreview skin={skin} outfit={outfit} live={live} />}
    />
  </div>
  );
};
