import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { COUNTER, KIND_OF, ROLE_DOES, ROLE_NAMES, type Role } from "../../../../pip/base/front";
import { WORKS } from "../../../../pip/base/guards";
import { Sprite, baseArt } from "./Sprite";

/** A prowler's picture, by his look's number or his role: the magpie and the mole have pictures of their own; the squirrel and Fizzwick are among the others'. */
export const FoeFace = ({ kind, box, className = "" }: { kind: number | Role; box: number; className?: string }) => {
  const look = typeof kind === "number" ? kind : KIND_OF[kind];
  if (look === 4) return <Sprite name="magpie" box={box} className={className} />;
  if (look === 6) return <Sprite name="mole" box={box} className={className} />;
  return <Sprite name="foe" variant={look === 5 ? 4 : look === 7 ? 5 : look} box={box} className={className} />;
};

export type NightCount = { role: Role; kind: number; count: number };

/**
 * Tonight, on the top bar (1.5.11): who is coming down the trail, as faces and counts, at dusk and while the night is
 * on. Nothing else: what each is and what beats it is a tap away (`NightCard`).
 */
export const NightChip = ({ counts, left, open, onOpen }: { counts: readonly NightCount[]; left: number | null; open: boolean; onOpen: () => void }) => (
  <button
    type="button"
    className="pip-base-chip pip-hud-chip pip-night-chip"
    data-hud="night"
    aria-expanded={open}
    aria-label={`Tonight: ${counts.map((entry) => `${entry.count} ${entry.count === 1 ? ROLE_NAMES[entry.role].one : ROLE_NAMES[entry.role].many}`).join(", ")}${left !== null ? `. ${left} still to come or about` : ""}. Who they are, and what beats them`}
    onClick={onOpen}
  >
    {counts.slice(0, 4).map((entry) => (
      <span key={entry.role} className="pip-night-chip-one" aria-hidden="true">
        <FoeFace kind={entry.kind} box={15} />
        <strong>{entry.count}</strong>
      </span>
    ))}
  </button>
);

/**
 * Tonight's card: each kind coming, how many, what it does, and the construct that beats it, with a mark where that is
 * not on the front.
 */
export const NightCard = ({ counts, placed, onClose, onFront }: { counts: readonly NightCount[]; placed: readonly number[]; onClose: () => void; onFront: () => void }) => (
  <section className="pip-base-card pip-night-card" aria-label="Tonight">
    <header className="pip-night-card-head">
      <h3 className="pip-sheet-title">Tonight</h3>
      <button type="button" className="pip-base-round" aria-label="Close" onClick={onClose}>
        <X size={14} aria-hidden />
      </button>
    </header>
    <ul className="pip-night-card-list">
      {counts.map((entry) => {
        const counter = COUNTER[entry.role];
        const missing = counter !== null && !placed.includes(counter);
        return (
          <li key={entry.role} className="pip-night-card-row">
            <FoeFace kind={entry.kind} box={26} />
            <span className="pip-night-card-text">
              <strong>
                {entry.count} {entry.count === 1 ? ROLE_NAMES[entry.role].one : ROLE_NAMES[entry.role].many}
              </strong>
              <span className="pip-night-card-does">{ROLE_DOES[entry.role]}</span>
            </span>
            {counter !== null && (
              <button
                type="button"
                className={`pip-night-card-counter ${missing ? "is-missing" : ""}`}
                title={`${WORKS[counter].name}${missing ? ": not on the front" : ": on the front"}`}
                aria-label={`Beaten by the ${WORKS[counter].name.toLowerCase()}${missing ? ", which is not on the front. The front" : ", which is on the front"}`}
                onClick={onFront}
              >
                <Sprite name="work" variant={counter} box={22} />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  </section>
);

/**
 * The guide's picture of the front (1.5.11): the Dark Wood on the left with its trail coming out of it, a creeper on
 * the trail, the wall across it, and a lookout behind. Drawn once, small, in the camp's own pixels.
 */
export const FrontPicture = ({ box, locked = false }: { box: number; locked?: boolean }) => {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const W = 96;
    const H = 56;
    canvas.width = W;
    canvas.height = H;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#86c46c";
    ctx.fillRect(0, 0, W, H);
    // The trail.
    ctx.fillStyle = "#a8804e";
    for (let x = 0; x < 62; x++) {
      const y = Math.round(36 - (x / 62) * 3);
      ctx.fillRect(x, y - 2, 1, 6);
    }
    // The Dark Wood, and the trail's mouth in it.
    ctx.fillStyle = "#1f3127";
    ctx.fillRect(0, 0, 18, H);
    ctx.fillStyle = "#2a4436";
    for (const [x, y] of [[3, 6], [10, 14], [4, 44], [12, 50], [8, 26]] as const) ctx.fillRect(x, y, 6, 5);
    ctx.fillStyle = "#120d19";
    ctx.fillRect(6, 27, 10, 11);
    ctx.fillRect(8, 25, 6, 2);
    ctx.fillStyle = "#a8804e";
    ctx.fillRect(10, 34, 8, 4);
    // The wall across it: logs on the slant, and the gate where the trail meets it.
    for (let y = 10; y <= 50; y += 3) {
      const x = Math.round(62 + (34 - y) * -0.3);
      ctx.fillStyle = y % 2 === 0 ? "#80552f" : "#6a4426";
      ctx.fillRect(x - 2, y - 9, 5, 9);
      ctx.fillStyle = "#33200f";
      ctx.fillRect(x - 2, y - 8, 1, 8);
      ctx.fillStyle = "#b5854f";
      ctx.fillRect(x - 1, y - 10, 3, 1);
    }
    ctx.fillStyle = "#6b2f22";
    ctx.fillRect(59, 20, 7, 2);
    const art = baseArt();
    const put = (name: string, variant: number, x: number, foot: number) => {
      const sprite = art.sprite(name, 0, { variant });
      if (sprite) ctx.drawImage(sprite.image, Math.round(x - sprite.w / 2), Math.round(foot - sprite.h));
    };
    put("tower", 2, 80, 50);
    put("foe", 0, 36, 39);
  }, []);
  const scale = box / 96;
  return <canvas ref={ref} className={`pip-sprite ${locked ? "is-locked" : ""}`} style={{ width: 96 * scale, height: 56 * scale, imageRendering: "pixelated" }} aria-hidden="true" />;
};
