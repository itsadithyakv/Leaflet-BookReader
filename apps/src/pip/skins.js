/* Pip's wardrobe. Each skin is a palette plus an optional accessory drawn from
 the rig's anchors, so every animation works in every skin for free. The
 earned skins are tied to reading behaviour the app already measures; the rest
 are bought with seeds in the Pip shop.

 Fields beyond the palette:
   price       seeds; 0 for the starter and for earned skins
   earnedOnly  true when the skin can't be bought, only unlocked by `unlock`
   rarity      "Starter" | "Common" | "Rare" | "Epic" | "Legendary" (earned ones
               may also be "Seasonal" / "Secret")
   hat/face/neck/back  true when the skin's own `acc` already dresses that slot,
               so `dress()` (accessories.js) skips a worn item there */
import { Layer, G, N } from "./engine.js";

const BASE = {
  outline: "#15281B", ink: "#10231A", eyeHi: "#FFFFFF",
  base: "#6CC04A", shade: "#3E8F3B", light: "#A2E477", hi: "#EFFFD8", belly: "#BDEB93", foot: "#2E6B33",
  leaf: "#2FA35E", leafShade: "#1D7646", vein: "#B9F0B4", stem: "#285F36",
  cheek: "#FF8FA3", tongue: "#F2607A"
};
const skin = (o) => Object.assign({}, BASE, o);

// ------------------------------------------------------------ drawing helpers
// Shared with the wardrobe (accessories.js).

/** Where a hat sits: the top of the head, following lean. */
const hatAt = (A) => ({ x: Math.round(A.top.x), y: Math.round(A.top.y) });

/** Is pixel (x, y) inside Pip's body? Returns [nx, ny] in -1..1, or null. */
function inBody(A, x, y) {
  const X = x + 0.5 - A.sh(y + 0.5), Y = y + 0.5;
  const nx = (X - A.cx) / A.rx, ny = (Y - A.cy) / A.ry;
  const k = ny < 0 ? 1 + 0.22 * ny * ny : 1;
  return (nx * k) ** 2 + ny * ny > 1 ? null : [nx, ny];
}

/** Recolour Pip's body pixels (never the face ink, cheeks or anything drawn
 over the body), e.g. a suit, a onesie or a mask band. fn returns a colour or
 null to keep the pixel. */
function tintBody(g, A, fn) {
  const S = g.S, own = new Set([S.base, S.shade, S.light, S.hi]);
  if (S.belly) own.add(S.belly);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const q = inBody(A, x, y);
    if (!q || !own.has(g.L.get(x, y))) continue;
    const c = fn(q[0], q[1], x, y, g.L.get(x, y));
    if (c) g.L.set(x, y, c);
  }
}

/** Draw behind Pip: like `stamp`, but only fills pixels that are still empty,
 so a cape or backpack tucks behind the body and its outline. */
function behind(g, fn, col) {
  const t = new Layer();
  fn(new G(t, g.S, g.f));
  const o = new Layer(), oc = col || g.S.outline;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (t.get(x, y)) continue;
    if (t.get(x - 1, y) || t.get(x + 1, y) || t.get(x, y - 1) || t.get(x, y + 1)) o.set(x, y, oc);
  }
  o.blit(t);
  for (let i = 0; i < N * N; i++) if (o.d[i] && !g.L.d[i]) g.L.d[i] = o.d[i];
}

/** Where the eyes are this frame (they follow `look`). */
const eyesAt = (A, p) => {
  const lx = Math.round((p && p.look && p.look[0]) || 0), ly = Math.round((p && p.look && p.look[1]) || 0);
  return { c: A.fc, L: A.fc - 4 + lx, R: A.fc + 2 + lx, Y: A.ey + ly };
};

/** The row where a neckline / waistline sits, just under the mouth. */
const neckY = (A) => Math.round(A.cy + A.ry * 0.42);

/** Centre column of the body at row y (follows lean). */
const midX = (A, y) => A.cx + A.sh(y + 0.5);

/** A flowing cape behind the body. */
function cape(g, A, col, dark, lining) {
  const f = g.f;
  behind(g, (l) => {
    const top = Math.round(A.cy - A.ry * 0.35), bot = Math.round(A.bottom + 2);
    for (let y = top; y <= bot; y++) {
      const t = (y - top) / Math.max(1, bot - top);
      const flap = Math.sin(f * 0.5 + y * 0.6) * t * 0.9;
      const half = A.rx * 0.98 + t * 3.4;
      const c = midX(A, y);
      for (let x = Math.floor(c - half + flap); x <= Math.ceil(c + half + flap); x++) {
        const edge = x - (c - half + flap) < 1.2 || (c + half + flap) - x < 1.2;
        l.px(x, y, edge && lining ? lining : (x + y + Math.round(f / 3)) % 5 === 0 ? dark : col);
      }
    }
  });
}

// ------------------------------------------------------------ accessories used by skins
const glasses = (g, A) => {
  const c = A.fc, y = A.ey - 2;
  g.stamp((l) => {
    l.ring(c - 3, y + 1.5, 2.3, "#F5F1E6");
    l.ring(c + 3, y + 1.5, 2.3, "#F5F1E6");
    l.px(c - 1, y + 1, "#F5F1E6").px(c, y + 1, "#F5F1E6");
  }, BASE.outline);
};
const scarf = (col, stripe) => (g, A) => {
  const y = Math.round(A.cy + A.ry * 0.55);
  g.stamp((l) => {
    for (let x = Math.round(A.cx - A.rx * 0.8); x <= A.cx + A.rx * 0.8; x++) l.rect(x, y, 1, 2, (x & 2) ? col : stripe);
    l.rect(Math.round(A.cx + A.rx * 0.45), y + 2, 2, 3, col);
  });
};
const shades = (g, A, p, lens = "#1B1F2A", glint = "#7F8CB3") => {
  const { c, Y } = eyesAt(A, p);
  g.stamp((l) => l.rect(c - 5, Y - 1, 4, 2, lens).rect(c + 1, Y - 1, 4, 2, lens).rect(c - 1, Y - 1, 2, 1, lens).px(c - 5, Y - 1, glint).px(c + 1, Y - 1, glint), "#0E0E14");
};

const SKINS = [
  skin({ id: "sprout", name: "Sprout", rarity: "Starter", price: 0, unlock: "Pip's own leaf. Yours from day one." }),
  skin({
    id: "autumn", name: "Maple", rarity: "Common", price: 0, earnedOnly: true, unlock: "Keep a 7-day streak.",
    base: "#F2A33A", shade: "#C0662A", light: "#FFD27A", hi: "#FFF3D6", belly: "#FFD9A0", foot: "#8F4520",
    leaf: "#E0492F", leafShade: "#A22A1C", vein: "#FFC7A8", stem: "#6B3A1E", outline: "#2E1A0E", ink: "#2A140A", cheek: "#FF7A6B"
  }),
  skin({
    id: "earlybird", name: "Early Bird", rarity: "Common", price: 0, earnedOnly: true, unlock: "Read before 8 am on 10 days.",
    base: "#FFD95A", shade: "#D9A42B", light: "#FFF0A0", hi: "#FFFFFF", belly: "#FFF2B8", foot: "#E07A2A",
    outline: "#3A2A0A", ink: "#2A1E06", cheek: "#FF9A7A",
    acc: (g, A) => {
      const c = A.fc, y = A.ey + 2;
      g.stamp((l) => l.rect(c - 1, y, 2, 1, "#FF8C2A").px(c - 1, y + 1, "#E0661A"), "#3A2A0A");
    }
  }),
  skin({
    id: "bookworm", name: "Bookworm", rarity: "Common", price: 0, earnedOnly: true, unlock: "Finish 5 books.", face: true, neck: true,
    acc: (g, A) => { scarf("#C8453B", "#F2E3C2")(g, A); glasses(g, A); }
  }),
  skin({
    id: "nightowl", name: "Night Owl", rarity: "Rare", price: 0, earnedOnly: true, unlock: "Read after 10 pm on 10 nights.",
    base: "#5A63C9", shade: "#363C8F", light: "#8C95F0", hi: "#E3E6FF", belly: "#8990DB", foot: "#252A66",
    leaf: "#33C7B5", leafShade: "#1E8B80", vein: "#C8FFF6", stem: "#1E5F59",
    outline: "#0C0F2A", ink: "#0B0D24", eyeHi: "#FFFFFF", cheek: "#C79BFF", glow: "#FFE066", eyes: "glow",
    dark: true
  }),
  skin({
    id: "detective", name: "Detective", rarity: "Rare", price: 0, earnedOnly: true, unlock: "Finish 3 mystery books.", hat: true,
    acc: (g, A) => {
      const h = hatAt(A);
      g.stamp((l) => {
        l.ell(h.x, h.y + 1, 5.6, 2.2, (nx, ny, x, y) => ((x + y) % 2 ? "#B08A55" : "#8C6A3C"));
        l.rect(h.x - 6, h.y + 2, 3, 1, "#8C6A3C").rect(h.x + 4, h.y + 2, 3, 1, "#8C6A3C");
      }, "#2B1D0C");
    }
  }),
  skin({
    id: "wizard", name: "Wizard", rarity: "Rare", price: 0, earnedOnly: true, unlock: "Finish 3 fantasy books.", hat: true,
    base: "#A98BE8", shade: "#7258B8", light: "#CDB9FF", hi: "#F4EEFF", belly: "#CBB8F5", foot: "#4B3585",
    outline: "#1E1238", ink: "#1A0E30", cheek: "#FF9CCB",
    acc: (g, A) => {
      const h = hatAt(A);
      g.stamp((l) => {
        for (let j = 0; j < 7; j++) l.rect(h.x - 3 + Math.floor(j / 2.4), h.y - j, Math.max(1, 7 - Math.floor(j * 1.1)), 1, "#3D2B8F");
        l.rect(h.x - 5, h.y + 1, 11, 1, "#3D2B8F");
        l.px(h.x, h.y - 3, "#FFD23F").px(h.x - 1, h.y - 1, "#FFD23F");
      }, "#12082A");
    }
  }),
  skin({
    id: "astronaut", name: "Astronaut", rarity: "Rare", price: 0, earnedOnly: true, unlock: "Finish 3 science fiction books.", hat: true,
    over: true,
    acc: (g, A) => {
      g.ring(A.cx, A.cy - 1, A.rx + 2.2, "#DDF3FF");
      g.px(Math.round(A.cx - A.rx * 0.6), Math.round(A.cy - A.ry * 0.9), "#FFFFFF");
    }
  }),
  skin({
    id: "cyclist", name: "Tour de Page", rarity: "Rare", price: 0, earnedOnly: true, unlock: "Read 1,000 pages in a month.", hat: true,
    acc: (g, A) => {
      const h = hatAt(A);
      g.stamp((l) => {
        l.ell(h.x, h.y + 2, 6, 3, (nx, ny) => (ny > 0.35 ? null : Math.abs(nx) < 0.2 ? "#FFFFFF" : "#1F8FFF"));
      }, "#0A1E3A");
    }
  }),
  skin({
    id: "champ", name: "Champ", rarity: "Epic", price: 0, earnedOnly: true, unlock: "Finish first in a weekly league.", neck: true,
    acc: (g, A) => {
      const y = Math.round(A.cy + A.ry * 0.5);
      g.stamp((l) => {
        l.rect(Math.round(A.cx - A.rx + 1), y, Math.round(A.rx * 2 - 1), 2, "#C8453B");
        l.rect(Math.round(A.cx - 2), y - 1, 4, 4, "#FFD23F").px(Math.round(A.cx - 1), y, "#FFF6C2");
      });
      const t = Math.round(A.top.y + 3);
      g.rect(Math.round(A.cx - A.rx * 0.8), t, Math.round(A.rx * 1.6), 1, "#E0393E");
    }
  }),
  skin({
    id: "frost", name: "Frost", rarity: "Epic", price: 0, earnedOnly: true, unlock: "Read on the longest night of the year.",
    base: "#9EDCF7", shade: "#5AA8D6", light: "#D4F1FF", hi: "#FFFFFF", belly: "#DDF4FF", foot: "#3B7FAE",
    leaf: "#E8F7FF", leafShade: "#9CCBE6", vein: "#FFFFFF", stem: "#3B7FAE", outline: "#0E2A40", ink: "#0B2236", cheek: "#FFB3C7",
    leafMode: "snow"
  }),
  skin({
    id: "sakura", name: "Sakura", rarity: "Epic", price: 0, earnedOnly: true, unlock: "Keep a 30-day streak.",
    base: "#FFB3CB", shade: "#E07A9E", light: "#FFD9E6", hi: "#FFFFFF", belly: "#FFE3EC", foot: "#B8577D",
    outline: "#3A1224", ink: "#2E0E1C", cheek: "#FF6F9A", leafMode: "flower", petal: "#FFFFFF", petalCore: "#FF6F9A"
  }),
  skin({
    id: "cactus", name: "Prickly", rarity: "Epic", price: 0, earnedOnly: true, unlock: "Finish a book you'd set aside for 30+ days.",
    base: "#4FA56A", shade: "#2F7447", light: "#7FCB8F", hi: "#D9F5DE", belly: null, foot: "#1F5634",
    leafMode: "flower", petal: "#FF6FA8", petalCore: "#FFE066",
    acc: (g, A) => {
      for (const [dx, dy] of [[-0.6, -0.1], [0.62, 0.05], [-0.35, 0.55], [0.4, 0.62], [0, -0.75]]) {
        g.px(Math.round(A.cx + dx * A.rx), Math.round(A.cy + dy * A.ry), "#F4F1DE");
      }
    }
  }),
  skin({
    id: "ink", name: "Midnight Ink", rarity: "Epic", price: 0, earnedOnly: true, unlock: "Read 100 hours in total.",
    base: "#2B2F3A", shade: "#171A22", light: "#474D5E", hi: "#8A93AB", belly: "#3A3F4D", foot: "#0F1117",
    leaf: "#F4F1E8", leafShade: "#BDB7A6", vein: "#2B2F3A", stem: "#BDB7A6",
    outline: "#F4F1E8", ink: "#F4F1E8", eyeHi: "#2B2F3A", cheek: "#FF7A93", tongue: "#FF7A93", dark: true
  }),
  skin({
    id: "ghost", name: "Boo", rarity: "Seasonal", price: 0, earnedOnly: true, unlock: "Read on Halloween.",
    base: "#F4F6FF", shade: "#C3C9E6", light: "#FFFFFF", hi: "#FFFFFF", belly: null, foot: "#C3C9E6",
    leaf: "#A7ADCF", leafShade: "#7F86AD", vein: "#E8EBFF", stem: "#7F86AD", outline: "#2A2D45", ink: "#1C1E33", cheek: "#FFB3C7"
  }),
  skin({
    id: "classic", name: "Cartridge", rarity: "Secret", price: 0, earnedOnly: true, unlock: "Finish a whole book in one sitting.",
    base: "#8BAC0F", shade: "#306230", light: "#9BBC0F", hi: "#C4D96A", belly: null, foot: "#306230",
    leaf: "#306230", leafShade: "#0F380F", vein: "#8BAC0F", stem: "#0F380F", outline: "#0F380F", ink: "#0F380F", eyeHi: "#9BBC0F",
    cheek: "#306230", tongue: "#306230"
  }),
  skin({
    id: "golden", name: "Golden Pip", rarity: "Legendary", price: 0, earnedOnly: true, unlock: "Keep a 365-day streak.",
    base: "#FFC93C", shade: "#C98A12", light: "#FFE27A", hi: "#FFFFFF", belly: "#FFE9A6", foot: "#9A640A",
    leaf: "#FFB000", leafShade: "#B87400", vein: "#FFF4C2", stem: "#8A5A06", outline: "#3A2400", ink: "#2E1C00", cheek: "#FF8A5C",
    sparkle: true,
    acc: (g, A) => {
      const k = g.f % 24;
      if (k < 6) g.stamp((l) => l.px(Math.round(A.cx + A.rx - 1), Math.round(A.cy - A.ry + 2) - (k > 2 ? 1 : 0), "#FFFFFF"), "#FFE27A");
    }
  }),
  skin({
    id: "rainbow", name: "Prism", rarity: "Legendary", price: 0, earnedOnly: true, unlock: "Reach every league tier.",
    dyn: true
  })
];

// ============================================================ shop variants
const SHOP = "Buy it in the Pip shop.";

SKINS.push(
  // ---------------------------------------------------------- Common
  skin({
    id: "gardener", name: "Gardener", rarity: "Common", price: 150, unlock: SHOP, blurb: "Straw hat, dungarees, dirt under the leaf.", hat: true,
    acc: (g, A) => {
      const n = neckY(A);
      tintBody(g, A, (nx, ny, x, y) => {
        const c = midX(A, y), d = Math.abs(x + 0.5 - c);
        if (y > n) return nx > 0.5 || ny > 0.85 ? "#2F5596" : "#4C7DC9";
        if (y === n && d < 3.5) return "#4C7DC9";
        if (y < n && y >= n - 3 && (nx < -0.72 || nx > 0.72)) return "#4C7DC9";
        return null;
      });
      // Brass buttons and a patch pocket.
      const c = Math.round(midX(A, n));
      g.px(c - 3, n, "#FFD23F").px(c + 2, n, "#FFD23F");
      g.rect(c - 1, n + 2, 2, 1, "#2F5596");
      const h = hatAt(A);
      g.stamp((l) => {
        l.ell(h.x, h.y + 1.5, 8, 1.7, (nx, ny, x) => (ny > 0.2 ? "#C9A04A" : x % 2 ? "#F2D27E" : "#E4BD5E"));
        l.ell(h.x, h.y - 0.5, 4.2, 2.8, (nx, ny, x, y) => (ny > 0.35 ? null : nx < -0.4 ? "#F7DE95" : (x + y) % 2 ? "#E8C46A" : "#DDB456"));
        l.rect(h.x - 4, h.y, 8, 1, "#3F9E4F");
        l.px(h.x + 2, h.y - 1, "#FF6F91").px(h.x + 3, h.y, "#FF6F91").px(h.x + 1, h.y, "#FF6F91").px(h.x + 2, h.y, "#FFE066");
      }, "#4A3410");
    }
  }),
  skin({
    id: "painter", name: "Painter", rarity: "Common", price: 200, unlock: SHOP, blurb: "A beret, a smock and a bit of everything on it.", hat: true,
    acc: (g, A) => {
      const n = neckY(A);
      tintBody(g, A, (nx, ny, x, y) => (y > n ? (nx > 0.5 || ny > 0.85 ? "#C9C2B2" : "#F1ECDF") : null));
      const c = Math.round(midX(A, n + 1));
      for (const [dx, dy, col] of [[-4, 2, "#2F8FE6"], [-3, 2, "#2F8FE6"], [3, 1, "#FFB400"], [1, 3, "#E0393E"], [2, 3, "#E0393E"], [-1, 1, "#1FBF6A"]]) g.px(c + dx, n + dy, col);
      g.px(A.fc + 4, A.ey + 1, "#2F8FE6").px(A.fc + 5, A.ey + 1, "#2F8FE6");
      const h = hatAt(A);
      g.stamp((l) => {
        l.ell(h.x - 1, h.y + 0.5, 6.2, 2.4, (nx, ny) => (ny > 0.45 ? "#8E1C3E" : nx < -0.3 && ny < 0 ? "#E0517A" : "#C8305A"));
        l.rect(h.x - 1, h.y - 3, 1, 2, "#8E1C3E");
      }, "#2E0A16");
    }
  }),
  skin({
    id: "sailor", name: "Sailor", rarity: "Common", price: 250, unlock: SHOP, blurb: "Ahoy. Reads on the high seas.", hat: true, neck: true,
    acc: (g, A) => {
      const n = neckY(A), c = midX(A, n);
      tintBody(g, A, (nx, ny, x, y) => {
        if (y < n) return null;
        const d = Math.abs(x + 0.5 - c), r = y - n;
        if (d < 3.5 - r) return null;
        if (d < 4.5 - r) return "#FFFFFF";
        return nx > 0.5 || ny > 0.85 ? "#1F3A7A" : "#2E56B3";
      });
      const cx = Math.round(c);
      g.stamp((l) => l.rect(cx - 1, n + 2, 2, 1, "#E0393E").px(cx - 2, n + 3, "#E0393E").px(cx + 1, n + 3, "#E0393E"), "#4A0E14");
      const h = hatAt(A);
      g.stamp((l) => {
        l.ell(h.x, h.y - 0.3, 3.6, 2.4, (nx, ny) => (ny > 0.3 ? null : nx < -0.3 ? "#FFFFFF" : "#E8EEF6"));
        l.ell(h.x, h.y + 1.3, 5.6, 1.4, (nx, ny) => (ny > 0.3 ? "#C3CFDF" : "#FFFFFF"));
        l.rect(h.x - 3, h.y + 1, 6, 1, "#2E56B3");
      }, "#1B2A4A");
    }
  }),
  skin({
    id: "chef", name: "Chef", rarity: "Common", price: 300, unlock: SHOP, blurb: "Magnifique. Cooks the books.", hat: true, face: true,
    acc: (g, A, p) => {
      const { c } = eyesAt(A, p), my = A.ey + 2;
      const M = "#7A4A22", Md = "#3A2210";
      g.rect(c - 4, my, 8, 1, Md).rect(c - 4, my - 1, 3, 1, M).rect(c + 1, my - 1, 3, 1, M).px(c - 3, my - 1, "#A0662E").px(c + 2, my - 1, "#A0662E");
      g.px(c - 5, my - 1, Md).px(c + 4, my - 1, Md).px(c - 6, my - 2, Md).px(c + 5, my - 2, Md);
      const h = hatAt(A);
      g.stamp((l) => {
        const puff = (nx, ny) => (nx + ny > 0.55 ? "#D8DEE8" : nx + ny < -0.8 ? "#FFFFFF" : "#F4F6FA");
        l.ell(h.x - 2.6, h.y - 3, 2.8, 2.8, puff).ell(h.x + 2.6, h.y - 3, 2.8, 2.8, puff).ell(h.x, h.y - 4.5, 3, 3, puff);
        l.rect(h.x - 4, h.y - 2, 8, 2, "#F4F6FA");
        l.rect(h.x - 4, h.y, 8, 2, "#FFFFFF").rect(h.x - 4, h.y + 1, 8, 1, "#D8DEE8");
      }, "#39404D");
    }
  }),
  skin({
    id: "skater", name: "Skater", rarity: "Common", price: 300, unlock: SHOP, blurb: "Backwards cap, comfy hoodie, kickflips between chapters.", hat: true,
    acc: (g, A) => {
      const n = neckY(A), c = midX(A, n);
      tintBody(g, A, (nx, ny, x, y) => {
        if (y < n) return null;
        const d = x + 0.5 - c;
        if (y >= n + 2 && Math.abs(d) < 3) return "#B94E1F";
        return nx > 0.5 || ny > 0.85 ? "#C0551F" : nx < -0.55 ? "#FFA95C" : "#F2802E";
      });
      const h = hatAt(A);
      g.stamp((l) => {
        l.rect(h.x - 9, h.y + 1, 5, 1, "#A81E2A").rect(h.x - 8, h.y + 2, 3, 1, "#7E1520");
        l.ell(h.x, h.y + 1, 5.2, 3.2, (nx, ny) => (ny > 0.4 ? null : nx < -0.35 && ny < -0.1 ? "#FF6B6B" : "#E0393E"));
        l.rect(h.x - 1, h.y + 1, 2, 1, "#FFFFFF").px(h.x, h.y - 2, "#A81E2A");
      }, "#3A0A10");
    }
  }),
  skin({
    id: "zombie", name: "Zombie", rarity: "Common", price: 350, unlock: SHOP, blurb: "Braaains. Well, books. Mostly books.",
    base: "#93AD85", shade: "#62795C", light: "#B9CCA6", hi: "#DDE8CC", belly: "#AFC19A", foot: "#4A5A44",
    leaf: "#8A8A45", leafShade: "#5E5E2A", vein: "#C9C98A", stem: "#5B4A2A", outline: "#1C2418", ink: "#1C2418", cheek: "#B07A8E", tongue: "#9A5A74",
    leafMode: "wilt", eyes: "dot",
    acc: (g, A) => {
      const c = A.fc, y = A.ey - 5;
      g.line(c - 5, y + 1, c - 1, y - 1, "#4A2E3A");
      for (const x of [c - 4, c - 2]) g.px(x, y - 1 + (x === c - 4 ? 1 : 0), "#4A2E3A").px(x, y + 1 + (x === c - 4 ? 1 : 0), "#4A2E3A");
      g.stamp((l) => l.rect(c + 4, A.ey + 1, 3, 2, "#E8D3A8").px(c + 5, A.ey + 1, "#C9B084").px(c + 5, A.ey + 2, "#C9B084"), "#4A3A22");
      g.px(Math.round(A.cx - A.rx + 2), Math.round(A.cy + 3), "#62795C").px(Math.round(A.cx - A.rx + 3), Math.round(A.cy + 4), "#62795C");
    }
  }),

  // ---------------------------------------------------------- Rare
  skin({
    id: "scientist", name: "Scientist", rarity: "Rare", price: 400, unlock: SHOP, blurb: "Goggles on, lab coat buttoned, hypothesis: more books.", hat: true,
    acc: (g, A) => {
      const n = neckY(A), c = midX(A, n);
      tintBody(g, A, (nx, ny, x, y) => {
        if (y < n) return null;
        const d = Math.abs(x + 0.5 - c);
        if (d < 1.5 - (y - n) * 0.1) return null;
        return nx > 0.5 || ny > 0.85 ? "#C9D1DB" : "#F7F9FC";
      });
      const cx = Math.round(c);
      g.px(cx + 3, n + 1, "#2F8FE6").px(cx + 3, n + 2, "#2F8FE6").px(cx + 4, n + 1, "#E0393E");
      const ey = A.ey - 5, fc = A.fc;
      tintBody(g, A, (nx, ny, x, y) => (y === ey ? "#3A3F4B" : null));
      g.stamp((l) => {
        const lens = (nx, ny) => (nx + ny < -0.5 ? "#FFFFFF" : nx + ny > 0.5 ? "#3FA3C9" : "#7FE0FF");
        l.ell(fc - 3, ey + 0.5, 2.2, 2, lens).ell(fc + 3, ey + 0.5, 2.2, 2, lens);
        l.rect(fc - 1, ey, 2, 1, "#5A606E");
      }, "#1B2230");
    }
  }),
  skin({
    id: "cowboy", name: "Cowboy", rarity: "Rare", price: 450, unlock: SHOP, blurb: "Yeehaw. Rides into the sunset with a paperback.", hat: true, neck: true,
    acc: (g, A) => {
      const n = neckY(A) + 1, c = Math.round(midX(A, n));
      g.stamp((l) => {
        l.rect(c - 6, n, 12, 1, "#D8323F");
        l.rect(c - 3, n + 1, 6, 1, "#D8323F").rect(c - 2, n + 2, 4, 1, "#D8323F").rect(c - 1, n + 3, 2, 1, "#D8323F");
        l.px(c - 4, n, "#FFFFFF").px(c + 1, n, "#FFFFFF").px(c - 1, n + 1, "#FFFFFF").px(c + 3, n, "#FFFFFF");
      }, "#4A0E14");
      const h = hatAt(A);
      g.stamp((l) => {
        l.ell(h.x, h.y - 1.2, 3.8, 3, (nx, ny) => (ny > 0.5 ? null : nx < -0.35 ? "#C68A4E" : "#A96B35"));
        l.px(h.x, h.y - 3, "#7A4A22").px(h.x - 1, h.y - 3, "#7A4A22");
        l.rect(h.x - 4, h.y, 8, 1, "#4A2A14");
        l.rect(h.x - 7, h.y + 1, 14, 1, "#A96B35").rect(h.x - 5, h.y + 2, 10, 1, "#7A4A22");
        l.px(h.x - 8, h.y, "#A96B35").px(h.x + 7, h.y, "#A96B35");
      }, "#2B1608");
    }
  }),
  skin({
    id: "punk", name: "Punk", rarity: "Rare", price: 500, unlock: SHOP, blurb: "Liberty spikes and a studded collar. Loud, but only with books.", hat: true, neck: true,
    leafMode: "none",
    acc: (g, A) => {
      const h = hatAt(A);
      g.stamp((l) => {
        for (const [a, len] of [[-62, 5], [-30, 6], [0, 7], [30, 6], [62, 5]]) {
          const r = (a * Math.PI) / 180, dx = Math.sin(r), dy = -Math.cos(r);
          const bx = h.x + dx * 3.2, by = h.y + 3 + dy * 2.6;
          for (let t = 0; t < len; t++) {
            const w = t < 2 ? 1 : 0;
            const x = bx + dx * t, y = by + dy * t;
            l.px(x, y, t > len - 3 ? "#9FE0FF" : "#2F9BFF");
            if (w) l.px(x + (dx > 0.2 ? -1 : 1), y, "#1D6FD1");
          }
        }
      }, "#0A1A33");
      const n = Math.round(A.cy + A.ry * 0.5), c = Math.round(A.cx);
      g.stamp((l) => {
        l.rect(Math.round(A.cx - A.rx + 2), n, Math.round(A.rx * 2 - 3), 2, "#23232B");
        for (let x = Math.round(A.cx - A.rx + 3); x < A.cx + A.rx - 2; x += 2) l.px(x, n, "#DDE3EC");
        l.px(c, n + 2, "#C8CFD9");
      }, "#0B0B10");
      g.px(Math.round(A.cx - A.rx), Math.round(A.cy - 1), "#DDE3EC").px(Math.round(A.cx - A.rx), Math.round(A.cy), "#DDE3EC");
    }
  }),
  skin({
    id: "pirate", name: "Pirate", rarity: "Rare", price: 550, unlock: SHOP, blurb: "Arr. Buried treasure is just an unread book.", hat: true, face: true,
    acc: (g, A, p) => {
      const { c, R, Y } = eyesAt(A, p);
      g.line(R - 1, Y - 3, c - 6, A.ey - 5, "#1B1B22").line(R + 2, Y - 3, c + 6, A.ey - 4, "#1B1B22");
      g.rect(R - 1, Y - 2, 4, 3, "#1B1B22").rect(R, Y + 1, 2, 1, "#1B1B22").px(R, Y - 2, "#4A4A5A");
      const h = hatAt(A);
      g.stamp((l) => {
        l.rect(h.x - 2, h.y - 3, 5, 1, "#23232B");
        l.rect(h.x - 3, h.y - 2, 7, 1, "#23232B");
        l.rect(h.x - 4, h.y - 1, 9, 2, "#23232B").px(h.x - 6, h.y - 1, "#23232B").px(h.x + 6, h.y - 1, "#23232B");
        l.rect(h.x - 6, h.y, 13, 1, "#23232B");
        l.rect(h.x - 5, h.y + 1, 11, 1, "#D9A441").px(h.x - 6, h.y, "#D9A441").px(h.x + 6, h.y, "#D9A441");
        l.rect(h.x - 1, h.y - 2, 3, 2, "#F4F1E8").px(h.x - 1, h.y - 1, "#23232B").px(h.x + 1, h.y - 1, "#23232B");
      }, "#0B0B10");
    }
  }),
  skin({
    id: "ninja", name: "Ninja", rarity: "Rare", price: 600, unlock: SHOP, blurb: "Silent. Swift. Finishes chapters before you notice.", hat: true, face: true,
    base: "#4B4F6B", shade: "#2E3148", light: "#6A6F91", hi: "#9CA2C6", belly: null, foot: "#23253A",
    leaf: "#3FA35E", leafShade: "#256E3E", stem: "#1E3A2A", outline: "#0C0D18", ink: "#0C0D18", cheek: "#4B4F6B", tongue: "#4B4F6B",
    acc: (g, A, p) => {
      const { c, Y } = eyesAt(A, p);
      tintBody(g, A, (nx, ny, x, y) => {
        const dx = x + 0.5 - (c - 0.5);
        if (y >= Y - 2 && y <= Y + 1 && Math.abs(dx) < 6.5 - (y === Y - 2 || y === Y + 1 ? 1 : 0)) return "#F2C89B";
        if (y === A.ey - 4 || y === A.ey - 5) return "#E0393E";
        return null;
      });
      const kx = Math.round(A.cx + A.rx + A.sh(A.ey - 4)) - 1, ky = A.ey - 5;
      const w = Math.round(Math.sin(g.f * 0.6) * 1.2);
      g.stamp((l) => {
        l.rect(kx, ky, 2, 2, "#E0393E");
        l.line(kx + 2, ky, kx + 5, ky - 1 + w, "#E0393E").line(kx + 2, ky + 1, kx + 5, ky + 3 - w, "#C0262E");
      }, "#3A0A10");
    }
  }),
  skin({
    id: "mermaid", name: "Mermaid", rarity: "Rare", price: 650, unlock: SHOP, blurb: "Shimmering scales and a fin for a leaf. Reads underwater.",
    base: "#41C4C0", shade: "#23898F", light: "#8BEBE0", hi: "#E6FFFB", belly: null, foot: "#1E7482",
    leaf: "#FF7FA8", leafShade: "#D94F7F", vein: "#FFD3E2", stem: "#B83A68", outline: "#0C2C36", ink: "#0B2430", cheek: "#FF8FB0",
    acc: (g, A) => {
      const n = neckY(A);
      tintBody(g, A, (nx, ny, x, y) => {
        if (y < n) return null;
        const row = y - n, off = row % 2 ? 1 : 0;
        const edge = (x + off) % 3 === 0;
        if (nx > 0.5 || ny > 0.85) return edge ? "#1B6E78" : "#2A8F9A";
        return edge ? "#2A9FA6" : row % 2 ? "#5AD6CE" : "#49C9C4";
      });
      const sx = Math.round(A.cx - A.rx * 0.55 + A.sh(A.top.y + 3)), sy = Math.round(A.top.y + 2);
      g.stamp((l) => {
        l.rect(sx - 1, sy, 3, 2, "#FFB3C7").px(sx, sy - 1, "#FFB3C7").px(sx - 2, sy + 1, "#FFB3C7").px(sx + 2, sy + 1, "#FFB3C7");
        l.px(sx, sy, "#FF7FA8").px(sx, sy + 1, "#FF7FA8");
      }, "#5A1A30");
      if (g.f % 36 < 18) g.px(Math.round(A.cx + 3), n + 2, "#FFFFFF");
    }
  }),

  // ---------------------------------------------------------- Epic
  skin({
    id: "robot", name: "Robo-Pip", rarity: "Epic", price: 700, unlock: SHOP, blurb: "Beep boop. Reads in binary, blinks in red.", hat: true,
    base: "#A9B5C4", shade: "#6F7C8E", light: "#D5DEE8", hi: "#FFFFFF", belly: "#BFC9D6", foot: "#4B5566",
    leaf: "#7F8CA0", leafShade: "#5B6678", vein: "#D5DEE8", stem: "#4B5566", outline: "#171D29", ink: "#171D29", cheek: "#FF9E7A",
    leafMode: "none", eyes: "robot",
    acc: (g, A) => {
      const h = hatAt(A), on = g.f % 24 < 12;
      g.stamp((l) => {
        l.rect(h.x, h.y - 4, 1, 5, "#5B6678");
        l.rect(h.x - 1, h.y - 6, 3, 2, on ? "#FF4D4D" : "#A83A3A").px(h.x - 1, h.y - 6, on ? "#FFD0D0" : "#C86060");
      });
      const by = Math.round(A.cy - 2);
      const lx = Math.round(A.cx - A.rx + A.sh(by)) - 1, rx = Math.round(A.cx + A.rx + A.sh(by)) - 1;
      g.stamp((l) => l.rect(lx, by, 2, 3, "#FFC23D").px(lx, by, "#FFF1A8").rect(rx, by, 2, 3, "#FFC23D").px(rx, by, "#FFF1A8"), "#3A2A08");
      const n = neckY(A) + 1, c = Math.round(midX(A, n));
      g.rect(c - 3, n, 6, 2, "#39414F");
      const k = Math.floor(g.f / 6) % 3;
      g.px(c - 2, n, k === 0 ? "#7CFF6B" : "#2E6B33").px(c, n, k === 1 ? "#FFE066" : "#6B5A1A").px(c + 1, n + 1, k === 2 ? "#FF6B6B" : "#6B2A2A");
      g.px(c - 1, n + 1, "#7FE7FF");
      for (const [dx, dy] of [[-0.62, -0.45], [0.62, -0.45]]) g.px(Math.round(A.cx + dx * A.rx), Math.round(A.cy + dy * A.ry), "#6F7C8E");
    }
  }),
  skin({
    id: "dino", name: "Dino Onesie", rarity: "Epic", price: 750, unlock: SHOP, blurb: "RAWR means 'I love this chapter' in dinosaur.", hat: true,
    base: "#34B5A0", shade: "#1F7F71", light: "#6FDCC7", hi: "#D6FFF5", belly: "#F4E3A1", foot: "#1B6B5F",
    outline: "#0C2A26", ink: "#10231A", cheek: "#FF8FA3", leafMode: "none",
    acc: (g, A, p) => {
      const { c } = eyesAt(A, p), fy = A.ey + 1;
      tintBody(g, A, (nx, ny, x, y) => {
        const X = (x + 0.5 - (c - 0.5)) / 5.6, Y = (y + 0.5 - fy) / 4.1;
        if (X * X + Y * Y > 1) return null;
        return X + Y < -0.9 ? "#A2E477" : X + Y > 0.95 ? "#4FA83F" : "#6CC04A";
      });
      // Teeth along the top of the opening.
      const ty = Math.round(fy - 4.1);
      g.rect(c - 4, ty, 8, 1, "#FFFFFF");
      for (let x = c - 4; x <= c + 3; x += 3) g.px(x + 1, ty + 1, "#FFFFFF");
      const h = hatAt(A);
      // Spikes down the crest (centre one tallest), then the hood's own eyes.
      g.stamp((l) => {
        for (const [dx, s] of [[-3, 2], [0, 3], [3, 2]]) {
          const x = h.x + dx - 0.5, y = h.y + 1 - s;
          for (let j = 0; j < s; j++) l.rect(Math.round(x - j * 0.5), y + j, j + 1, 1, j === 0 ? "#FFC27A" : "#FF8A3D");
        }
      }, "#4A1E08");
      // Nostrils on the snout above the teeth.
      g.px(c - 3, ty - 1, "#0C2A26").px(c + 2, ty - 1, "#0C2A26");
    }
  }),
  skin({
    id: "vampire", name: "Vampire", rarity: "Epic", price: 800, unlock: SHOP, blurb: "Only reads by candlelight. Never by daylight.", back: true,
    base: "#DCD6EE", shade: "#A197C4", light: "#F4F1FF", hi: "#FFFFFF", belly: null, foot: "#5A4A7A",
    leaf: "#B0203A", leafShade: "#7A1024", vein: "#FF8FA3", stem: "#3A1A28", outline: "#170E24", ink: "#170E24", cheek: "#E7A6D6", tongue: "#B0203A",
    acc: (g, A, p) => {
      cape(g, A, "#1B1422", "#120D18", "#B0203A");
      const top = Math.round(A.top.y), c = A.cx;
      behind(g, (l) => {
        for (const s of [-1, 1]) {
          const x0 = Math.round(c + s * (A.rx - 1.5) + A.sh(A.cy));
          for (let j = 0; j < 8; j++) {
            const w = Math.max(1, 3 - Math.floor(j / 3));
            l.rect(s < 0 ? x0 - w - Math.floor(j / 2) : x0 + Math.floor(j / 2), top + 8 - j, w + 1, 1, j > 5 ? "#1B1422" : "#B0203A");
          }
        }
      });
      tintBody(g, A, (nx, ny, x, y) => {
        const d = Math.abs(x + 0.5 - (A.fc - 0.5));
        const edge = A.ey - 5 + (d < 1 ? 2 : d < 2 ? 1 : 0);
        if (y <= edge && ny < -0.35) return nx < -0.3 ? "#3A2E52" : "#241A33";
        return null;
      });
      const { c: fc } = eyesAt(A, p), my = A.ey + 3 + (p && p.mouthDy ? p.mouthDy : 0);
      g.px(fc - 2, my + 1, "#FFFFFF").px(fc + 1, my + 1, "#FFFFFF");
    }
  }),
  skin({
    id: "knight", name: "Knight", rarity: "Epic", price: 850, unlock: SHOP, blurb: "Sworn protector of the bookshelf.", hat: true,
    leafMode: "none",
    acc: (g, A) => {
      const h = hatAt(A), f = g.f;
      // A feather plume sweeping back from a gold socket.
      g.stamp((l) => {
        const sway = Math.round(Math.sin(f * 0.25));
        for (let j = 0; j < 7; j++) {
          const t = j / 6;
          const x = h.x + t * 5 + (j > 3 ? sway : 0), y = h.y - 2 - Math.sin(t * Math.PI * 0.8) * 5 + t * 1.5;
          l.ell(x, y, 1.7 - t * 0.6, 1.7 - t * 0.6, j < 3 ? "#E0393E" : "#C8203A");
          if (j < 5) l.px(x - 1, y - 1, "#FF7A7A");
        }
        l.rect(h.x - 1, h.y - 1, 2, 2, "#FFD23F");
      }, "#3A0A10");
      const cy = A.ey - 3;
      g.stamp((l) => {
        l.ell(A.top.x, A.cy - 1, A.rx + 0.6, A.ry + 0.4, (nx, ny, x, y) => {
          if (y > cy) return null;
          if (y >= cy - 1) return y === cy - 1 && x % 2 ? "#39414F" : "#8C97A6";
          return nx + ny < -0.8 ? "#EEF3F8" : nx > 0.45 ? "#7E8A99" : "#B8C2CE";
        });
        l.rect(A.fc - 1, cy + 1, 2, 3, "#B8C2CE").px(A.fc, cy + 1, "#7E8A99");
        const lx = Math.round(A.cx - A.rx + A.sh(cy + 2)), rx = Math.round(A.cx + A.rx + A.sh(cy + 2));
        l.rect(lx - 1, cy + 1, 2, 4, "#B8C2CE").rect(rx - 1, cy + 1, 2, 4, "#8C97A6");
      }, "#1B2230");
    }
  }),
  skin({
    id: "rockstar", name: "Rockstar", rarity: "Epic", price: 900, unlock: SHOP, blurb: "Shades on, mohawk up, turns every page to eleven.", hat: true, face: true,
    leafMode: "none",
    acc: (g, A, p) => {
      const n = neckY(A), c = midX(A, n);
      tintBody(g, A, (nx, ny, x, y) => {
        if (y < n) return null;
        const d = x + 0.5 - c;
        if (Math.abs(d + 1) < 0.6) return "#C9D1DB";
        return nx > 0.5 || ny > 0.85 ? "#16161C" : nx < -0.5 ? "#4A4A5A" : "#2A2A33";
      });
      g.px(Math.round(c) + 2, n + 1, "#FF3D9A").px(Math.round(c) + 3, n + 1, "#FF3D9A");
      shades(g, A, p, "#14141C", "#FF7FC0");
      const h = hatAt(A);
      g.stamp((l) => {
        for (const [dx, hgt] of [[-3, 3], [-1, 5], [1, 6], [3, 4]]) {
          for (let j = 0; j < hgt; j++) l.rect(h.x + dx - (j < 2 ? 1 : 0), h.y + 1 - j, j < 2 ? 3 : 2 - (j === hgt - 1 ? 1 : 0), 1, j >= hgt - 2 ? "#FF9CCB" : "#FF3D9A");
        }
      }, "#3A0A24");
    }
  }),

  // ---------------------------------------------------------- Legendary
  skin({
    id: "president", name: "Mr. President", rarity: "Legendary", price: 950, unlock: SHOP, blurb: "Sharp suit, slick leaf, signs every book into law.", neck: true,
    leaf: "#2E9A56", leafShade: "#17643A", vein: "#F2FFF4", stem: "#1E4A2C",
    acc: (g, A) => {
      const n = neckY(A);
      tintBody(g, A, (nx, ny, x, y) => {
        if (y < n) return null;
        const c = midX(A, y), d = x + 0.5 - c, r = y - n;
        if (Math.abs(d) < 1) return r === 0 ? "#B01E2A" : "#E0393E";
        if (Math.abs(d) < 3 - r) return "#FFFFFF";
        if (Math.abs(d) < 4 - r) return "#3A5494";
        return nx > 0.5 || ny > 0.85 ? "#141F3D" : "#243A6B";
      });
      const c = Math.round(midX(A, n));
      g.px(c - 5, n + 1, "#3A6FE0").px(c - 4, n + 1, "#E0393E").px(c - 4, n + 2, "#FFFFFF").px(c - 5, n + 2, "#E0393E");
    }
  }),
  skin({
    id: "superhero", name: "Super Pip", rarity: "Legendary", price: 1000, unlock: SHOP, blurb: "Faster than a speed-reader. Able to leap tall bookshelves.", face: true, back: true,
    acc: (g, A, p) => {
      cape(g, A, "#D8263B", "#A8182C", "#FF5A6E");
      const { c, Y } = eyesAt(A, p);
      tintBody(g, A, (nx, ny, x, y) => {
        const dx = x + 0.5 - (c - 0.5);
        const w = y === Y - 2 ? 5.5 : y === Y + 1 ? 5.5 : 6.5;
        if (y >= Y - 2 && y <= Y + 1 && Math.abs(dx) < w) return y === Y - 2 && dx < -2 ? "#5A8CFF" : "#2F5FD0";
        return null;
      });
      const n = neckY(A) + 1, cx = Math.round(midX(A, n));
      g.stamp((l) => l.rect(cx - 1, n, 2, 1, "#FFD23F").rect(cx - 2, n + 1, 4, 1, "#FFD23F").rect(cx - 1, n + 2, 2, 1, "#FFD23F").px(cx - 1, n + 1, "#E0393E").px(cx, n + 1, "#E0393E"), "#4A1E08");
    }
  }),
  skin({
    id: "king", name: "King Pip", rarity: "Legendary", price: 1200, unlock: SHOP, blurb: "Long live the reader. A crown, an ermine cape, a kingdom of books.", hat: true, back: true, neck: true,
    acc: (g, A) => {
      cape(g, A, "#A8173A", "#7E0F2A", "#FFFFFF");
      const n = neckY(A) + 1;
      tintBody(g, A, (nx, ny, x, y) => (y > n + 1 ? (nx > 0.5 || ny > 0.85 ? "#7E0F2A" : "#A8173A") : null));
      g.stamp((l) => {
        const x0 = Math.round(A.cx - A.rx * 0.95 + A.sh(n)), x1 = Math.round(A.cx + A.rx * 0.95 + A.sh(n));
        l.rect(x0, n, x1 - x0, 2, "#FFFFFF");
        for (let x = x0 + 1; x < x1; x += 3) l.px(x, n + (x % 2), "#1B1B22");
      }, "#39404D");
      const h = hatAt(A), sh = g.f % 30 < 4;
      g.stamp((l) => {
        l.rect(h.x - 4, h.y - 1, 9, 3, "#FFD23F").rect(h.x - 4, h.y + 1, 9, 1, "#E0A800");
        for (const dx of [-4, 0, 4]) l.px(h.x + dx, h.y - 2, "#FFD23F").px(h.x + dx, h.y - 3, "#FFD23F");
        l.px(h.x - 2, h.y - 2, "#FFD23F").px(h.x + 2, h.y - 2, "#FFD23F");
        l.px(h.x, h.y, "#E0393E").px(h.x - 3, h.y, "#3AA0FF").px(h.x + 3, h.y, "#1FBF6A");
        l.px(h.x - 4, h.y - 1, sh ? "#FFFFFF" : "#FFF1A8");
      }, "#4A3100");
    }
  })
);

// Prism re-tints per frame; the rest are static palettes.
function resolve(s, f) {
  if (!s.dyn) return s;
  const h = (f * 9) % 360;
  const hsl = (hh, sat, l) => {
    const a = sat * Math.min(l, 1 - l);
    const k = (n) => (n + hh / 30) % 12;
    const c = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return "#" + [c(0), c(8), c(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
  };
  return Object.assign({}, s, {
    base: hsl(h, 0.75, 0.62), shade: hsl(h, 0.6, 0.42), light: hsl(h, 0.85, 0.78), belly: hsl((h + 40) % 360, 0.8, 0.8),
    foot: hsl(h, 0.55, 0.32), leaf: hsl((h + 150) % 360, 0.7, 0.5), leafShade: hsl((h + 150) % 360, 0.65, 0.35),
    vein: hsl((h + 150) % 360, 0.8, 0.85), outline: "#1A1530", ink: "#140F26"
  });
}

export { SKINS, resolve, BASE, hatAt, inBody, tintBody, behind, eyesAt, neckY, midX, cape };
