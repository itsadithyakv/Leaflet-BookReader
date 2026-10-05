/* Desktop Pip's own poses. Drawn like every other move (pip/anims.js): a pure
 function of the frame, registered through `def`, so LIB stays one list. They
 have no category, like the house's parts, so the design kit leaves them out;
 and they load only with her window (desktop-pip/window.tsx), never with the
 app.

   sit      on the edge of the taskbar, feet out in front
   holdup   a placard's post in her hand: the board itself is her window's,
            set on top of the sprite (DesktopPip.tsx), so the post runs to
            the canvas's top edge to meet it */
import { drawPip } from "../pip/engine.js";
import { def, kit } from "../pip/anims.js";

const { wave, blink } = kit;

const WOOD = "#8A5A34", WOOD_D = "#5E3A1F";

def("sit", "Sitting", "", 48, "On the desktop: sat on the taskbar's edge.", (g, f) => {
  g.shadow(16, 8);
  drawPip(g, {
    y: 29, sq: 0.1 + wave(f, 24, 0.025), la: 44 + wave(f, 48, 6), eyes: blink(f) ? "blink" : "open",
    feet: (A) => [[A.cx - 4.5, A.bottom + 0.4, 2.7], [A.cx + 4.5, A.bottom + 0.4, 2.7]],
    hands: (A) => [{ x: A.handL[0] + 0.6, y: A.bottom - 2.2 }, { x: A.handR[0] - 0.6, y: A.bottom - 2.2 }]
  });
});

def("holdup", "Holding A Sign", "", 48, "On the desktop: a reminder is due, and she holds its sign up.", (g, f) => {
  g.shadow(16, 6);
  drawPip(g, {
    sq: wave(f, 24, 0.03), la: 8 + wave(f, 48, 5), look: [1, -1], fdx: 1, eyes: blink(f) ? "blink" : "open", mouth: "open",
    // The post first, so her hand closes over it.
    hold: () => g.rect(26, 0, 2, 25, WOOD).rect(27, 0, 1, 25, WOOD_D),
    hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: 27, y: A.cy + 1 }]
  });
});
