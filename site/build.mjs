// Builds Leaflet's website into site/dist for GitHub Pages.
//
// Pages: the landing page, the privacy policy and the terms of use (rendered
// from docs/legal/*.md, so the legal text has exactly one source), a 404, and
// the signed config.json the app reads to find the server.
//
//   node site/build.mjs
//
// No dependencies: the markdown in docs/legal uses a small, known subset
// (headings, paragraphs, lists, bold, links, inline code, tables, quotes),
// and the renderer below handles exactly that.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const dist = join(here, "dist");
const STORE_URL = "https://apps.microsoft.com/detail/9PH0NLGJFF9W";
const CONTACT = "adithyakrishnan.vinod@gmail.com";

// ---------------------------------------------------------------- markdown
const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s) =>
  escape(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) => `<a href="${href}">${text}</a>`);

function markdown(src) {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let para = [];
  let list = null;
  let table = null;
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<ul>${list.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`);
    list = null;
  };
  const flushTable = () => {
    if (!table) return;
    const [head, , ...body] = table;
    const cells = (row) => row.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    out.push(
      `<div class="table"><table><thead><tr>${cells(head).map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body
        .map((row) => `<tr>${cells(row).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table></div>`
    );
    table = null;
  };
  const flush = () => {
    flushPara();
    flushList();
    flushTable();
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    if (line.startsWith("|")) {
      flushPara();
      flushList();
      (table ??= []).push(line);
      continue;
    }
    if (/^\s*- /.test(line)) {
      flushPara();
      flushTable();
      (list ??= []).push(line.replace(/^\s*- /, ""));
      continue;
    }
    if (/^\s{2,}\S/.test(line) && list) {
      list[list.length - 1] += " " + line.trim();
      continue;
    }
    if (line.startsWith(">")) {
      flush();
      out.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`);
      continue;
    }
    flushList();
    flushTable();
    para.push(line.trim());
  }
  flush();
  return out.join("\n");
}

// ---------------------------------------------------------------- layout
const page = ({ title, description, path, body, depth }) => {
  const up = depth ? "../".repeat(depth) : "./";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="icon" type="image/png" href="${up}assets/pip-64.png">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${up}assets/pip-tile-640.png">
<link rel="stylesheet" href="${up}assets/site.css">
</head>
<body class="${path}">
<header class="bar">
  <a class="brand" href="${up}"><img src="${up}assets/pip-64.png" width="32" height="32" alt=""> Leaflet</a>
  <nav><a href="${up}privacy/">Privacy</a><a href="${up}terms/">Terms</a><a href="mailto:${CONTACT}">Contact</a></nav>
</header>
<main>
${body}
</main>
<footer>
  <p>Leaflet is made by PaperKite. Questions or problems: <a href="mailto:${CONTACT}">${CONTACT}</a></p>
</footer>
</body>
</html>
`;
};

const landing = `
<section class="hero">
  <img class="pip" src="assets/pip-wave.png" width="192" height="192" alt="Pip, Leaflet's pixel-art reading companion, waving">
  <div>
    <h1>Leaflet</h1>
    <p class="lede">A calm reader for your whole library, and a daily reading habit you'll actually keep. With Pip, who lives in the app and celebrates every page with you.</p>
    <p class="cta"><a class="button" href="${STORE_URL}">Get it from Microsoft Store</a> <span class="note">Free for Windows. Nothing locked.</span></p>
  </div>
</section>
<section class="grid">
  <article><img src="assets/pip-reading.png" width="96" height="96" alt=""><h2>Every format</h2><p>EPUB, PDF, comics and plain text open straight away. Other formats convert with the optional Calibre add-on.</p></article>
  <article><img src="assets/pip-goal.png" width="96" height="96" alt=""><h2>A habit, not a chore</h2><p>A daily goal, streaks with freezes and a grace day, focus sessions, and a bookshelf that fills up with every session you finish.</p></article>
  <article><img src="assets/pip-boxing.png" width="96" height="96" alt=""><h2>Pip</h2><p>Pip hops out of the logo to read with you, boxes when you hit your goal, and can be picked up and thrown around the app.</p></article>
  <article><img src="assets/pip-sleeping.png" width="96" height="96" alt=""><h2>Your books stay yours</h2><p>Your library lives on your computer. Back it up to your own Google Drive; we can't see it.</p></article>
</section>
<section class="soon">
  <h2>Leaflet for your phone is coming</h2>
  <p>Back up to Google Drive now, and your library, progress and streak will be waiting for you in the mobile app.</p>
</section>
`;

// ---------------------------------------------------------------- build
rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "assets"), { recursive: true });

const pipAssets = join(repo, "apps", "src", "assets", "pip");
for (const file of ["pip-64.png", "pip-tile-640.png", "pip-wave.png", "pip-reading.png", "pip-goal.png", "pip-boxing.png", "pip-sleeping.png"]) {
  cpSync(join(pipAssets, file), join(dist, "assets", file));
}
cpSync(join(here, "site.css"), join(dist, "assets", "site.css"));

const write = (rel, html) => {
  const file = join(dist, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
};

write("index.html", page({ title: "Leaflet — a reader with a reading habit", description: "A calm ebook reader for Windows, with streaks, focus sessions and Pip.", path: "home", body: landing, depth: 0 }));

for (const [slug, file, title] of [
  ["privacy", "privacy-policy.md", "Privacy Policy"],
  ["terms", "terms-of-use.md", "Terms of Use"]
]) {
  const md = readFileSync(join(repo, "docs", "legal", file), "utf8");
  write(`${slug}/index.html`, page({ title: `Leaflet ${title}`, description: `Leaflet's ${title.toLowerCase()}.`, path: "legal", body: `<article class="doc">${markdown(md)}</article>`, depth: 1 }));
}

write("404.html", page({ title: "Page not found · Leaflet", description: "That page isn't here.", path: "missing", body: `<section class="hero"><img class="pip" src="/Leaflet-BookReader/assets/pip-sleeping.png" width="160" height="160" alt=""><div><h1>Nothing here</h1><p class="lede">Pip looked everywhere. <a href="/Leaflet-BookReader/">Back to the start</a>.</p></div></section>`, depth: 0 }));

// The signed config: produced locally by sign-config.mjs, published as-is.
const config = join(here, "public", "config.json");
if (!existsSync(config)) {
  throw new Error("site/public/config.json is missing. Run: node site/sign-config.mjs");
}
cpSync(config, join(dist, "config.json"));
writeFileSync(join(dist, ".nojekyll"), "");
console.log(`Built ${dist}`);
