/* Pip's wardrobe: accessories worn on top of any variant (skin), one per
 slot. Each draws in the 32x32 frame from Pip's anchors, like a skin's `acc`.
 The shape is fixed:
   { id, name, slot: "head" | "face" | "neck" | "back" | "hand", price, draw(g, A, p) }
 `price` is in seeds; 0 means free.

 Everything is placed from the anchors (top of head, face centre, eye row,
 hands), so an item follows Pip through squash, lean, jumps and falls.
 Back items tuck behind the body (they only fill empty pixels); hand items
 go in Pip's left hand wherever the move puts it, and the hand is drawn over
 the grip. `dress(skin, ids)` builds a skin that wears them. */
import { drawHand } from "./engine.js";
import { hatAt, tintBody, behind, eyesAt, neckY, midX, cape } from "./skins.js";

void drawHand;

const TAU = Math.PI * 2;
const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/** Where Pip's hand is this frame (0 = left, 1 = right), or null when the move hides hands. */
function handAt(A, p, side = 0) {
  const rest = [{ x: A.handL[0], y: A.handL[1] }, { x: A.handR[0], y: A.handR[1] }];
  if (!p || p.hands === false) return null;
  const hs = typeof p.hands === "function" ? p.hands(A) || rest : p.hands || rest;
  return hs[side] || null;
}

/** Hat width scale: follows squash so a squashed Pip wears a wider hat. */
const kw = (A) => A.rx / 8;

// ============================================================ HEAD
const head = [
  {
    id: "cap", name: "Ball Cap", slot: "head", price: 60,
    draw(g, A) {
      const h = hatAt(A), k = kw(A);
      g.stamp((l) => {
        l.ell(h.x - 0.5, h.y + 1, 5.2 * k, 3.4, (nx, ny) => (ny > 0.35 ? null : nx < -0.4 && ny < 0 ? "#6FB2FF" : nx > 0.5 ? "#1F5FB8" : "#2F80E6"));
        l.px(h.x - 1, h.y - 2, "#FFFFFF");
        const bx = h.x + Math.round(3 * k);
        l.rect(bx, h.y + 1, 5, 1, "#2F80E6").rect(bx + 1, h.y + 2, 4, 1, "#17488C");
        l.rect(h.x - 3, h.y, 2, 1, "#FFD23F");
      }, "#0A1E3A");
    }
  },
  {
    id: "beanie", name: "Cosy Beanie", slot: "head", price: 80,
    draw(g, A) {
      const h = hatAt(A), k = kw(A);
      g.stamp((l) => {
        l.ell(h.x, h.y + 2, 6.2 * k, 4.2, (nx, ny, x) => (ny > 0.28 ? null : ny > -0.05 ? (x % 2 ? "#F6D06B" : "#E8B84A") : nx < -0.35 && ny < -0.4 ? "#FF8A7A" : x % 2 ? "#E0493F" : "#C83A33"));
        l.ell(h.x, h.y - 2.6, 1.9, 1.8, (nx, ny) => (nx + ny < -0.4 ? "#FFFFFF" : "#EDE6D6"));
      }, "#3A0E0A");
    }
  },
  {
    id: "bow", name: "Big Bow", slot: "head", price: 60,
    draw(g, A) {
      const x = Math.round(A.top.x + 4 * kw(A)), y = Math.round(A.top.y + 1);
      g.stamp((l) => {
        l.rect(x - 4, y - 2, 3, 4, "#FF6FA8").rect(x + 2, y - 2, 3, 4, "#FF6FA8").px(x - 4, y - 2, "#FFB3D1").px(x + 2, y - 2, "#FFB3D1");
        l.px(x - 2, y - 1, "#FF6FA8").px(x - 2, y, "#FF6FA8").px(x + 1, y - 1, "#FF6FA8").px(x + 1, y, "#FF6FA8");
        l.rect(x - 1, y - 1, 2, 2, "#E0457F").px(x - 4, y + 1, "#D0457F").px(x + 4, y + 1, "#D0457F");
      }, "#4A0A24");
    }
  },
  {
    id: "crown", name: "Little Crown", slot: "head", price: 400,
    draw(g, A) {
      const h = hatAt(A), sh = g.f % 30 < 4;
      g.stamp((l) => {
        l.rect(h.x - 3, h.y - 1, 7, 3, "#FFD23F").rect(h.x - 3, h.y + 1, 7, 1, "#E0A800");
        for (const dx of [-3, 0, 3]) l.px(h.x + dx, h.y - 2, "#FFD23F").px(h.x + dx, h.y - 3, dx ? "#FFD23F" : "#FF4D6D");
        l.px(h.x, h.y, "#3AA0FF").px(h.x - 3, h.y - 1, sh ? "#FFFFFF" : "#FFF1A8");
      }, "#4A3100");
    }
  },
  {
    id: "headphones", name: "Headphones", slot: "head", price: 180,
    draw(g, A) {
      const cy = A.cy - 1, r = A.rx + 0.6, sx = A.sh(cy);
      g.stamp((l) => {
        l.ring(A.cx + sx - 0.5, cy + 0.5, r, "#3A3F4B", (t) => t < 0.52 || t > 0.98);
        l.ring(A.cx + sx - 0.5, cy + 0.5, r - 0.8, "#5A606E", (t) => t < 0.55 || t > 0.95);
        const lx = Math.round(A.cx - A.rx + sx) - 2, rx = Math.round(A.cx + A.rx + sx) - 1, y = Math.round(cy - 1);
        l.rect(lx, y, 3, 5, "#E0393E").px(lx, y, "#FF7A7A").rect(rx, y, 3, 5, "#E0393E").px(rx, y, "#FF7A7A");
        l.rect(lx + 2, y + 1, 1, 3, "#3A3F4B").rect(rx, y + 1, 1, 3, "#3A3F4B");
      }, "#14161C");
    }
  },
  {
    id: "partyhat", name: "Party Hat", slot: "head", price: 90,
    draw(g, A) {
      const h = hatAt(A), bx = h.x - 3, by = h.y + 1;
      g.stamp((l) => {
        for (let j = 0; j < 8; j++) {
          const w = Math.max(1, Math.round(7 - j * 0.85));
          const x = Math.round(bx + (7 - w) / 2 + j * 0.45);
          l.rect(x, by - j, w, 1, (j + (x & 1)) % 3 === 0 ? "#FFD23F" : j % 3 === 1 ? "#8E5CFF" : "#3AA0FF");
          if (j % 3 === 0) l.px(x + (j % 2), by - j, "#FF4D6D");
        }
        const tx = Math.round(bx + 3 + 7 * 0.45), ty = by - 9;
        l.ell(tx, ty, 1.6, 1.6, (nx, ny) => (nx + ny < -0.4 ? "#FFFFFF" : "#FF4D6D"));
      }, "#1E1238");
    }
  },
  {
    id: "flower", name: "Hair Flower", slot: "head", price: 50,
    draw(g, A) {
      const x = A.top.x - 4 * kw(A), y = A.top.y + 2.5, ph = Math.sin(g.f * 0.2) * 0.2;
      g.stamp((l) => {
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * TAU + ph - Math.PI / 2;
          l.ell(x + Math.cos(a) * 1.8, y + Math.sin(a) * 1.8, 1.4, 1.4, "#FFFFFF");
        }
        l.ell(x, y, 1.2, 1.2, "#FFC53D");
      }, "#5A3A10");
    }
  },
  {
    id: "halo", name: "Halo", slot: "head", price: 300,
    draw(g, A) {
      const x = A.top.x, y = A.top.y - 4 + Math.round(Math.sin(g.f * 0.26) * 0.8), k = kw(A);
      g.stamp((l) => l.ell(x, y, 5 * k, 1.8, (nx, ny) => {
        const d = nx * nx + ny * ny;
        if (d < 0.36) return null;
        return ny < 0 ? "#FFF3A6" : "#FFD23F";
      }), "#8A6400");
      if (g.f % 24 < 3) g.px(Math.round(x + 4 * k), Math.round(y - 2), "#FFFFFF");
    }
  },
  {
    id: "tophat", name: "Top Hat", slot: "head", price: 220,
    draw(g, A) {
      const h = hatAt(A);
      g.stamp((l) => {
        l.rect(h.x - 5, h.y + 1, 11, 1, "#1B1B22").rect(h.x - 4, h.y + 2, 9, 1, "#0F0F14");
        l.rect(h.x - 3, h.y - 6, 7, 7, "#1B1B22").rect(h.x - 3, h.y - 6, 1, 7, "#3A3A48");
        l.rect(h.x - 3, h.y - 1, 7, 2, "#B01E3A").px(h.x + 2, h.y - 1, "#E0393E");
      }, "#F4F1E8");
    }
  },
  {
    id: "catears", name: "Cat Ears", slot: "head", price: 120,
    draw(g, A) {
      for (const s of [-1, 1]) {
        const x = Math.round(A.top.x + s * 4.2 * kw(A)), y = Math.round(A.top.y + 2);
        const tw = Math.round(Math.sin(g.f * 0.35 + s) * 0.6);
        g.stamp((l) => {
          for (let j = 0; j < 4; j++) {
            const w = 4 - j;
            l.rect(x - Math.floor(w / 2) + (j > 1 ? s + (j === 3 ? tw : 0) : 0), y - j, w, 1, "#3A3346");
          }
          l.px(x + (s > 0 ? 0 : -1), y - 1, "#FF9CC0").px(x + (s > 0 ? 0 : -1), y, "#FF9CC0");
        }, "#0F0C16");
      }
    }
  },
  {
    id: "propeller", name: "Propeller Cap", slot: "head", price: 160,
    draw(g, A) {
      const h = hatAt(A), k = kw(A);
      g.stamp((l) => {
        l.ell(h.x, h.y + 1.5, 5 * k, 3.2, (nx, ny) => (ny > 0.35 ? null : nx < -0.33 ? "#E0393E" : nx < 0.33 ? "#FFD23F" : "#2F80E6"));
        l.rect(h.x - 1, h.y - 2, 1, 2, "#3A3F4B");
        const c = Math.cos(g.f * 1.3), w = Math.max(1, Math.round(Math.abs(c) * 4));
        l.rect(h.x - w, h.y - 3, w, 1, c > 0 ? "#E0393E" : "#2F80E6").rect(h.x, h.y - 3, w, 1, c > 0 ? "#2F80E6" : "#E0393E");
      }, "#14161C");
    }
  }
];

// ============================================================ FACE
const face = [
  {
    id: "roundglasses", name: "Round Specs", slot: "face", price: 70,
    draw(g, A, p) {
      const { L, R, Y } = eyesAt(A, p), F = "#B0562A";
      for (const x0 of [L, R]) {
        g.rect(x0, Y - 3, 2, 1, F).rect(x0, Y + 2, 2, 1, F).rect(x0 - 1, Y - 2, 1, 4, F).rect(x0 + 2, Y - 2, 1, 4, F);
      }
      g.rect(L + 3, Y - 1, R - L - 4, 1, F);
    }
  },
  {
    id: "shades", name: "Cool Shades", slot: "face", price: 120,
    draw(g, A, p) {
      const { c, Y } = eyesAt(A, p);
      g.stamp((l) => {
        l.rect(c - 6, Y - 2, 5, 3, "#1B1F2A").rect(c + 1, Y - 2, 5, 3, "#1B1F2A").rect(c - 1, Y - 2, 2, 1, "#1B1F2A");
        l.px(c - 6, Y - 2, "#7F8CB3").px(c - 5, Y - 2, "#7F8CB3").px(c + 1, Y - 2, "#7F8CB3").px(c + 2, Y - 2, "#7F8CB3");
        l.px(c - 3, Y + 1, "#1B1F2A").px(c - 4, Y + 1, "#1B1F2A").px(c + 3, Y + 1, "#1B1F2A").px(c + 4, Y + 1, "#1B1F2A");
      }, "#0A0B10");
    }
  },
  {
    id: "monocle", name: "Monocle", slot: "face", price: 200,
    draw(g, A, p) {
      const { c, R, Y } = eyesAt(A, p);
      g.stamp((l) => l.ring(R + 0.5, Y + 0.5, 2.7, "#FFD23F"), "#4A3100");
      g.px(R - 1, Y - 1, "#FFFFFFaa");
      const x0 = R + 3, y0 = Y + 2;
      for (let i = 0; i < 5; i++) g.px(x0 + Math.round(i * 0.4), y0 + i, i % 2 ? "#E0A800" : "#FFD23F");
      void c;
    }
  },
  {
    id: "heartglasses", name: "Heart Specs", slot: "face", price: 150,
    draw(g, A, p) {
      const { c, Y } = eyesAt(A, p);
      const heart = (l, x, y) => {
        l.rect(x, y, 2, 1, "#FF4D6D").rect(x + 3, y, 2, 1, "#FF4D6D").rect(x - 0, y + 1, 5, 2, "#FF4D6D").rect(x + 1, y + 3, 3, 1, "#FF4D6D").px(x + 2, y + 4, "#FF4D6D");
        l.px(x, y + 1, "#FFB3C1").px(x + 1, y, "#FFB3C1");
      };
      g.stamp((l) => { heart(l, c - 6, Y - 2); heart(l, c + 1, Y - 2); l.px(c - 1, Y - 1, "#C8264A").px(c, Y - 1, "#C8264A"); }, "#4A0E1C");
    }
  },
  {
    id: "moustache", name: "Fancy Moustache", slot: "face", price: 90,
    draw(g, A, p) {
      const { c } = eyesAt(A, p), my = A.ey + 2;
      const M = "#7A4A22", Md = "#3A2210";
      g.rect(c - 4, my, 8, 1, Md).rect(c - 4, my - 1, 3, 1, M).rect(c + 1, my - 1, 3, 1, M).px(c - 3, my - 1, "#A0662E").px(c + 2, my - 1, "#A0662E");
      g.px(c - 5, my - 1, Md).px(c + 4, my - 1, Md).px(c - 6, my - 2, Md).px(c + 5, my - 2, Md);
    }
  },
  {
    id: "blush", name: "Blush Stickers", slot: "face", price: 40,
    draw(g, A) {
      const c = A.fc, y = A.ey + 2;
      for (const x of [c - 7, c + 4]) {
        g.stamp((l) => l.rect(x, y - 1, 3, 2, "#FF7FA8").px(x, y - 1, "#FFC2D6"), "#B8336A");
      }
      if (g.f % 24 < 12) g.px(c - 8, y - 3, "#FFFFFF").px(c + 7, y - 3, "#FFFFFF");
    }
  },
  {
    id: "starglasses", name: "Star Shades", slot: "face", price: 180,
    draw(g, A, p) {
      const { c, Y } = eyesAt(A, p);
      const star = (l, x, y) => {
        l.px(x, y - 2, "#FFD23F").rect(x - 2, y - 1, 5, 1, "#FFD23F").rect(x - 1, y, 3, 1, "#FFB400").px(x - 1, y + 1, "#FFB400").px(x + 1, y + 1, "#FFB400");
        l.px(x - 2, y - 1, "#FFF6C2");
      };
      g.stamp((l) => { star(l, c - 3, Y); star(l, c + 3, Y); l.px(c, Y - 1, "#FFD23F").px(c - 1, Y - 1, "#FFD23F"); }, "#4A3100");
    }
  },
  {
    id: "glasses3d", name: "3D Glasses", slot: "face", price: 110,
    draw(g, A, p) {
      const { c, Y } = eyesAt(A, p);
      g.stamp((l) => {
        l.rect(c - 6, Y - 2, 12, 4, "#F4F1E8");
        l.rect(c - 5, Y - 1, 4, 2, "#FF3D5A").rect(c + 1, Y - 1, 4, 2, "#35C8FF");
      }, "#1B1F2A");
    }
  },
  {
    id: "clownnose", name: "Clown Nose", slot: "face", price: 50,
    draw(g, A, p) {
      const { c } = eyesAt(A, p);
      g.stamp((l) => l.ell(c - 0.5, A.ey + 1.5, 1.6, 1.4, (nx, ny) => (nx + ny < -0.5 ? "#FF9A9A" : "#E0262E")), "#4A0A10");
    }
  }
];

// ============================================================ NECK
const neck = [
  {
    id: "scarf", name: "Knit Scarf", slot: "neck", price: 80,
    draw(g, A) {
      const y = Math.round(A.cy + A.ry * 0.55), sway = Math.round(Math.sin(g.f * 0.3) * 0.6);
      g.stamp((l) => {
        for (let x = Math.round(A.cx - A.rx * 0.85 + A.sh(y)); x <= A.cx + A.rx * 0.85 + A.sh(y); x++) l.rect(x, y, 1, 2, (x & 2) ? "#3AA0FF" : "#F4F1E8");
        const tx = Math.round(A.cx - A.rx * 0.55 + A.sh(y));
        l.rect(tx + sway, y + 2, 2, 3, "#3AA0FF").rect(tx + sway, y + 4, 2, 1, "#F4F1E8");
      }, "#0E2A4A");
    }
  },
  {
    id: "bowtie", name: "Bow Tie", slot: "neck", price: 70,
    draw(g, A) {
      const n = neckY(A) + 1, c = Math.round(midX(A, n));
      g.stamp((l) => {
        l.rect(c - 4, n - 1, 2, 3, "#E0393E").rect(c + 2, n - 1, 2, 3, "#E0393E").rect(c - 2, n, 4, 1, "#E0393E");
        l.rect(c - 1, n, 2, 1, "#A81E2A").px(c - 4, n - 1, "#FF7A7A");
      }, "#3A0A10");
    }
  },
  {
    id: "necklace", name: "Pearl Necklace", slot: "neck", price: 160,
    draw(g, A) {
      const n = neckY(A), c = midX(A, n);
      for (let i = -3; i <= 3; i++) {
        const x = Math.round(c - 0.5 + i * 1.6), y = Math.round(n + 2.4 - (i * i) * 0.2);
        g.stamp((l) => l.px(x, y, "#FFFFFF"), "#8C8AA8");
      }
    }
  },
  {
    id: "bandana", name: "Bandana", slot: "neck", price: 60,
    draw(g, A) {
      const n = neckY(A) + 1, c = Math.round(midX(A, n));
      g.stamp((l) => {
        l.rect(c - 6, n, 12, 1, "#2F6FD0");
        l.rect(c - 3, n + 1, 6, 1, "#2F6FD0").rect(c - 2, n + 2, 4, 1, "#2F6FD0").rect(c - 1, n + 3, 2, 1, "#2F6FD0");
        l.px(c - 4, n, "#FFFFFF").px(c + 2, n, "#FFFFFF").px(c, n + 1, "#FFFFFF").px(c - 2, n + 1, "#9CC2FF");
      }, "#0A1E3A");
    }
  },
  {
    id: "medal", name: "Gold Medal", slot: "neck", price: 250,
    draw(g, A) {
      const n = neckY(A), c = Math.round(midX(A, n));
      g.line(c - 5, n - 1, c - 1, n + 2, "#2F80E6").line(c + 4, n - 1, c, n + 2, "#E0393E");
      const sh = g.f % 36 < 4;
      g.stamp((l) => l.ell(c - 0.5, n + 3.5, 1.9, 1.9, (nx, ny) => (nx + ny < -0.5 ? (sh ? "#FFFFFF" : "#FFF1A8") : nx + ny > 0.6 ? "#E0A800" : "#FFD23F")), "#4A3100");
    }
  },
  {
    id: "lei", name: "Flower Lei", slot: "neck", price: 100,
    draw(g, A) {
      const n = neckY(A), c = midX(A, n), cols = ["#FF6FA8", "#FFD23F", "#FFFFFF", "#FF8A3D"];
      g.stamp((l) => {
        for (let i = -4; i <= 4; i++) {
          const x = Math.round(c - 1 + i * 1.7), y = Math.round(n + 2.2 - (i * i) * 0.13);
          l.rect(x, y, 2, 2, cols[(i + 8) % 4]).px(x, y, "#FFFFFF");
        }
      }, "#5A1A30");
    }
  },
  {
    id: "tie", name: "Necktie", slot: "neck", price: 60,
    draw(g, A) {
      const n = neckY(A), c = Math.round(midX(A, n));
      g.stamp((l) => {
        l.rect(c - 1, n, 2, 1, "#1FA36A");
        l.rect(c - 1, n + 1, 2, 3, "#2BC47F").px(c - 1, n + 2, "#FFD23F").px(c, n + 3, "#FFD23F").rect(c - 1, n + 4, 2, 1, "#1FA36A");
      }, "#0A2A1A");
    }
  },
  {
    id: "bell", name: "Bell Collar", slot: "neck", price: 90,
    draw(g, A) {
      const n = neckY(A) + 1, c = Math.round(midX(A, n)), ring = g.f % 24 < 4 ? (g.f % 2 ? 1 : -1) : 0;
      g.stamp((l) => {
        l.rect(Math.round(A.cx - A.rx * 0.9 + A.sh(n)), n, Math.round(A.rx * 1.8), 1, "#E0393E");
        l.ell(c - 0.5 + ring, n + 2, 1.7, 1.6, (nx, ny) => (nx + ny < -0.4 ? "#FFF1A8" : "#FFD23F")).px(c - 1 + ring, n + 3, "#8A6400");
      }, "#3A0A10");
    }
  }
];

// ============================================================ BACK
const back = [
  {
    id: "backpack", name: "Backpack", slot: "back", price: 150,
    draw(g, A) {
      behind(g, (l) => {
        const top = Math.round(A.cy - A.ry * 0.5), bot = Math.round(A.bottom - 1);
        for (let y = top; y <= bot; y++) {
          const c = midX(A, y), half = A.rx + 1.5;
          l.rect(Math.round(c - half), y, Math.round(half * 2), 1, y === top ? "#FF9A5A" : (y - top) % 5 === 3 ? "#C04E1A" : "#F2742E");
        }
      });
      tintBody(g, A, (nx, ny, x, y) => (y >= A.cy - 3 && y <= A.bottom - 2 && (Math.abs(nx + 0.66) < 0.07 || Math.abs(nx - 0.66) < 0.07) ? "#8A3A12" : null));
    }
  },
  {
    id: "cape", name: "Hero Cape", slot: "back", price: 260,
    draw(g, A) { cape(g, A, "#7A4BD6", "#5A33A8", "#FFD23F"); }
  },
  {
    id: "angelwings", name: "Angel Wings", slot: "back", price: 380,
    draw(g, A) {
      const flap = Math.sin(g.f * 0.4);
      behind(g, (l) => {
        for (const s of [-1, 1]) {
          const bx = A.cx + s * (A.rx - 1) + A.sh(A.cy), by = A.cy - 1;
          for (let i = 0; i < 4; i++) {
            const x = bx + s * (1.5 + i * 1.45), y = by - 3 + i * 1.1 - flap * (i * 0.6);
            l.ell(x, y, 2.4 - i * 0.2, 3 - i * 0.35, (nx, ny) => (ny > 0.4 ? "#D8DEEA" : "#FFFFFF"));
          }
        }
      }, "#4A5270");
    }
  },
  {
    id: "jetpack", name: "Jetpack", slot: "back", price: 400,
    draw(g, A) {
      const f = g.f;
      behind(g, (l) => {
        for (const s of [-1, 1]) {
          const x = Math.round(A.cx + s * (A.rx - 0.5) + A.sh(A.cy)) - (s < 0 ? 2 : 1), y = Math.round(A.cy - 4);
          l.rect(x, y, 3, 8, "#C9D1DB").rect(x, y, 1, 8, "#EEF3F8").rect(x + 2, y, 1, 8, "#8C97A6");
          l.rect(x, y - 1, 3, 1, "#E0393E").rect(x, y + 8, 3, 1, "#5A606E");
          const len = 2 + ((f + (s > 0 ? 2 : 0)) % 3);
          for (let j = 0; j < len; j++) l.px(x + 1, y + 9 + j, j === 0 ? "#FFF3B0" : j < 2 ? "#FFC53D" : "#FF7A2A");
          if ((f + s) % 2) l.px(x + (s > 0 ? 2 : 0), y + 10, "#FFC53D");
        }
      }, "#1B2230");
    }
  },
  {
    id: "bookbag", name: "Book Satchel", slot: "back", price: 120,
    draw(g, A) {
      tintBody(g, A, (nx, ny, x, y) => {
        const t = (x + 0.5 - (A.cx - A.rx)) / (A.rx * 2);
        const yy = A.cy - A.ry * 0.55 + t * A.ry * 1.25;
        return Math.abs(y + 0.5 - yy) < 0.8 && ny > -0.75 ? "#7A4A22" : null;
      });
      const x = Math.round(A.cx + A.rx - 3 + A.sh(A.bottom - 3)), y = Math.round(A.bottom - 5);
      g.stamp((l) => {
        l.rect(x + 1, y - 1, 1, 1, "#E0393E").rect(x + 2, y - 2, 1, 2, "#2F80E6");
        l.rect(x, y, 6, 4, "#A0662E").rect(x, y, 6, 2, "#8A5424").px(x + 2, y + 2, "#FFD23F").px(x, y, "#C68A4E");
      }, "#2B1608");
    }
  },
  {
    id: "fairywings", name: "Fairy Wings", slot: "back", price: 320,
    draw(g, A) {
      const flap = Math.abs(Math.sin(g.f * 0.55));
      behind(g, (l) => {
        for (const s of [-1, 1]) {
          const bx = A.cx + s * (A.rx - 1) + A.sh(A.cy), by = A.cy - 2;
          const w = 1.2 + 2.6 * (0.35 + 0.65 * flap);
          l.ell(bx + s * (w + 1), by - 2.5, w, 3.4, (nx, ny) => (nx * nx + ny * ny > 0.55 ? "#C89BFF" : "#EAD9FF"));
          l.ell(bx + s * (w * 0.7 + 1), by + 3, w * 0.7, 2.4, (nx, ny) => (nx * nx + ny * ny > 0.55 ? "#7FD6FF" : "#D6F4FF"));
        }
      }, "#3A2A6B");
      if (g.f % 16 < 4) g.px(Math.round(A.cx - A.rx - 5), Math.round(A.cy - 7), "#FFFFFF");
    }
  }
];

// ============================================================ HAND
const hand = [
  {
    id: "balloon", name: "Balloon", slot: "hand", price: 60,
    draw(g, A, p) {
      const h = handAt(A, p);
      if (!h) return;
      const sway = Math.sin(g.f * 0.2) * 1.2;
      const bx = Math.max(3.2, h.x - 3 + sway), by = Math.max(4, h.y - 14);
      for (let i = 0; i <= 8; i++) {
        const t = i / 8, x = h.x + (bx - h.x) * t + Math.sin(t * Math.PI * 2 + g.f * 0.3) * 0.5, y = h.y + (by + 4 - h.y) * t;
        g.px(Math.round(x), Math.round(y), "#6B6558");
      }
      g.stamp((l) => {
        l.ell(bx, by, 3, 3.6, (nx, ny) => (nx + ny < -0.9 ? "#FFB3C1" : nx + ny > 0.8 ? "#B8193A" : "#F0304F"));
        l.px(Math.round(bx - 1.5), Math.round(by - 1.8), "#FFFFFF");
        l.px(Math.floor(bx), Math.round(by + 3.6), "#B8193A");
      }, "#3A0610");
    }
  },
  {
    id: "wand", name: "Star Wand", slot: "hand", price: 240,
    draw(g, A, p) {
      const h = handAt(A, p);
      if (!h) return;
      const tx = Math.round(h.x - 4), ty = Math.round(h.y - 6);
      g.stamp((l) => l.line(h.x, h.y, tx, ty, "#6B3A1E"), "#1B1008");
      g.stamp((l) => {
        l.px(tx, ty - 2, "#FFD23F").rect(tx - 2, ty - 1, 5, 1, "#FFD23F").rect(tx - 1, ty, 3, 1, "#FFD23F").px(tx - 1, ty + 1, "#FFD23F").px(tx + 1, ty + 1, "#FFD23F");
        l.px(tx, ty - 1, "#FFFFFF");
      }, "#4A3100");
      const k = g.f % 16;
      if (k < 8) g.px(tx - 3 - (k >> 2), ty - 3 - (k >> 1), k < 4 ? "#FFFFFF" : "#FFE36B");
      if (k > 6 && k < 14) g.px(tx + 3, ty - 4 + ((k - 7) >> 1), "#FFE36B");
    }
  },
  {
    id: "book", name: "Pocket Book", slot: "hand", price: 40,
    draw(g, A, p) {
      const h = handAt(A, p);
      if (!h) return;
      const x = Math.round(h.x - 4), y = Math.round(h.y - 5);
      g.stamp((l) => {
        l.rect(x, y, 4, 6, "#2F80E6").rect(x + 3, y + 1, 1, 4, "#FFF6DF").rect(x, y, 1, 6, "#1F5FB8");
        l.rect(x + 1, y + 1, 2, 1, "#FFD23F");
      }, "#0A1E3A");
    }
  },
  {
    id: "coffee", name: "Coffee To Go", slot: "hand", price: 50,
    draw(g, A, p) {
      const h = handAt(A, p);
      if (!h) return;
      const x = Math.round(h.x - 3), y = Math.round(h.y - 5);
      g.stamp((l) => {
        l.rect(x - 1, y, 5, 1, "#F4F1E8").rect(x, y + 1, 3, 4, "#F4F1E8").rect(x, y + 2, 3, 2, "#A0662E").px(x + 1, y + 2, "#C68A4E");
      }, "#2B1608");
      for (let k = 0; k < 2; k++) {
        const t = ((g.f + k * 6) % 12) / 12;
        if (t < 0.8) g.px(x + k + Math.round(Math.sin((g.f + k * 5) * 0.8)), Math.round(y - 1 - t * 4), "#FFFFFFcc");
      }
    }
  },
  {
    id: "lollipop", name: "Lollipop", slot: "hand", price: 45,
    draw(g, A, p) {
      const h = handAt(A, p);
      if (!h) return;
      const cx = h.x - 2, cy = h.y - 8;
      g.stamp((l) => l.line(h.x, h.y, cx, cy + 2, "#F4F1E8"), "#6B6558");
      g.stamp((l) => l.ell(cx, cy, 2.6, 2.6, (nx, ny) => {
        const a = Math.atan2(ny, nx) + Math.hypot(nx, ny) * 5 + g.f * 0.2;
        return Math.sin(a * 2) > 0 ? "#FF4D8D" : "#FFF3F7";
      }), "#5A0A2A");
    }
  },
  {
    id: "umbrella", name: "Umbrella", slot: "hand", price: 130,
    draw(g, A, p) {
      const h = handAt(A, p);
      if (!h) return;
      const tx = Math.max(6.5, h.x - 1), ty = Math.max(6, h.y - 13);
      g.stamp((l) => { l.line(h.x, h.y + 1, tx, ty, "#3A3F4B"); l.px(h.x + 1, h.y + 2, "#3A3F4B"); }, "#14161C");
      g.stamp((l) => {
        l.ell(tx, ty + 1, 6, 4, (nx, ny, x) => {
          if (ny > 0) return null;
          const seg = Math.floor((nx + 1) * 2.5);
          return seg % 2 ? "#FFD23F" : "#2FA35E";
        });
        l.px(Math.round(tx), Math.round(ty - 3), "#3A3F4B");
      }, "#1B2A1A");
    }
  },
  {
    id: "sparkler", name: "Sparkler", slot: "hand", price: 110,
    draw(g, A, p) {
      const h = handAt(A, p);
      if (!h) return;
      const tx = Math.round(h.x - 3), ty = Math.round(h.y - 7);
      g.stamp((l) => l.line(h.x, h.y, tx, ty, "#8C97A6"), "#2A2F3A");
      for (let i = 0; i < 7; i++) {
        const a = rnd(g.f * 7 + i) * TAU, r = 1 + rnd(g.f * 3 + i * 11) * 3.2;
        g.px(Math.round(tx + Math.cos(a) * r), Math.round(ty + Math.sin(a) * r), i % 3 ? "#FFE36B" : "#FFFFFF");
      }
      g.px(tx, ty, "#FFFFFF");
    }
  },
  {
    id: "sunflower", name: "Sunflower", slot: "hand", price: 70,
    draw(g, A, p) {
      const h = handAt(A, p);
      if (!h) return;
      const fx = h.x - 2, fy = h.y - 9;
      g.stamp((l) => { l.line(h.x, h.y, fx, fy + 2, "#2FA35E"); l.px(h.x - 2, h.y - 4, "#5BBF4A").px(h.x - 3, h.y - 4, "#5BBF4A"); }, "#123A1E");
      g.stamp((l) => {
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU + g.f * 0.05;
          l.px(fx + Math.cos(a) * 2.4, fy + Math.sin(a) * 2.4, "#FFC53D");
        }
        l.ell(fx, fy, 2.2, 2.2, (nx, ny) => (nx * nx + ny * ny > 0.55 ? "#FFC53D" : "#7A4A22"));
      }, "#4A3100");
    }
  }
];

export const ACCESSORIES = [...head, ...face, ...neck, ...back, ...hand];

/** Draw order: back tucks behind first, then front layers outward. */
export const SLOT_ORDER = ["back", "neck", "face", "head", "hand"];
const SKIN_FLAG = { head: "hat", face: "face", neck: "neck", back: "back" };
const BY_ID = new Map(ACCESSORIES.map((a) => [a.id, a]));

/**
 * A skin wearing accessories: returns a new skin object whose `acc` draws the
 * skin's own accessory, then the worn items in slot order (back, neck, face,
 * head, hand). One item per slot (the last id given wins); an item is skipped
 * when the skin already dresses that slot (`hat`, `face`, `neck`, `back`).
 * Works with resolve()/renderFrame() exactly like a skin, in either order:
 * resolve(dress(skin, ids), f) or dress(resolve(skin, f), ids).
 */
export function dress(skin, accessoryIds) {
  const pick = {};
  for (const id of accessoryIds || []) {
    const a = BY_ID.get(id);
    if (a) pick[a.slot] = a;
  }
  const worn = SLOT_ORDER.map((s) => pick[s]).filter((a) => a && !(SKIN_FLAG[a.slot] && skin[SKIN_FLAG[a.slot]]));
  if (!worn.length) return skin;
  const own = skin.acc;
  return Object.assign({}, skin, {
    worn: worn.map((a) => a.id),
    acc(g, A, p) {
      if (own) own(g, A, p);
      for (const a of worn) a.draw(g, A, p || {});
    }
  });
}
