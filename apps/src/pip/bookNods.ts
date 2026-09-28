/**
 * Pip's nods to famous books: open one of these and, now and then, Pip plays
 * a little scene about it (a dragon on its tail, eyes on the walls, an owl
 * with a letter). The scenes live in ./books/; this decides which book gets
 * which, and what Pip says.
 *
 * Matching is on the title (and the author, for writers whose every book
 * shares a world), case-insensitive, so any edition or boxed set matches.
 * Lines are Pip's own words, never quotes from the books.
 */

export type BookNod = {
  /** Scenes to pick from (all ids from ./books/). */
  moves: string[];
  /** Pip's lines, one picked per showing. */
  lines: string[];
  title?: RegExp;
  author?: RegExp;
};

const NODS: BookNod[] = [
  // ---------------------------------------------------------------- fantasy
  {
    title: /song of ice and fire|game of thrones|clash of kings|storm of swords|feast for crows|dance with dragons|fire (&|and) blood|winds of winter/i,
    author: /george r\.? ?r\.? martin/i,
    moves: ["dragonchase"],
    lines: ["dragon! dragon! not the leaf!", "winter's on its way. so is that dragon.", "i'd like to file a complaint about the dragons."]
  },
  { title: /\bthe hobbit\b|there and back again/i, moves: ["dragonchase", "ring"], lines: ["second breakfast first, then the dragon.", "is this ring… humming?", "i'm going on an adventure! (slowly)"] },
  {
    title: /lord of the rings|fellowship of the ring|two towers|return of the king|silmarillion/i,
    moves: ["fireeye", "ring"],
    lines: ["i feel watched. by a very big eye.", "one ring. zero thank-yous.", "that eye has seen my reading streak."]
  },
  {
    title: /harry potter|philosopher'?s stone|sorcerer'?s stone|chamber of secrets|prisoner of azkaban|goblet of fire|order of the phoenix|half-blood prince|deathly hallows/i,
    moves: ["owlpost", "wandspell"],
    lines: ["a letter! for me! delivered by owl!", "swish and flick. mostly flick.", "i'm a wizard, apparently."]
  },
  { title: /eragon|eldest|brisingr|inheritance cycle/i, moves: ["dragonchase"], lines: ["a dragon egg would be nice. a smaller dragon, please."] },
  { title: /fourth wing|iron flame|onyx storm/i, moves: ["dragonchase"], lines: ["dragon school sounds dangerous. i'm in."] },
  { title: /how to train your dragon/i, moves: ["dragonchase"], lines: ["step one: don't get toasted. step two: pending."] },
  { title: /temeraire|his majesty'?s dragon|priory of the orange tree/i, moves: ["dragonchase"], lines: ["this dragon has excellent manners. and fire."] },
  {
    title: /narnia|lion,? the witch|prince caspian|dawn treader|silver chair|horse and his boy|magician'?s nephew|last battle/i,
    moves: ["wardrobe"],
    lines: ["check the back of every wardrobe. every one.", "it's always winter in here. bring a scarf."]
  },
  { title: /alice'?s adventures|alice in wonderland|through the looking.glass/i, moves: ["rabbitwatch", "teaparty"], lines: ["late for something. very important something.", "tea time! the teapot disagrees."] },
  { title: /wizard of oz|wonderful wizard/i, moves: ["tornado"], lines: ["home is wherever the book is.", "click click click. still here."] },
  { title: /peter pan/i, moves: ["flyshadow"], lines: ["come back, shadow! we had plans!", "off to the island. back by bedtime."] },
  {
    title: /mistborn|well of ascension|hero of ages|stormlight|way of kings|words of radiance|oathbringer|rhythm of war|wind and truth|elantris|warbreaker/i,
    author: /brandon sanderson/i,
    moves: ["coinpush"],
    lines: ["push the coin, fly the pip.", "the magic has rules. i have a leaf."]
  },
  { title: /percy jackson|lightning thief|sea of monsters|titan'?s curse|battle of the labyrinth|last olympian/i, moves: ["trident"], lines: ["half pip, half god of the sea.", "i've been claimed. by the splash zone."] },
  { title: /hunger games|catching fire|mockingjay|ballad of songbirds/i, moves: ["mockingjay"], lines: ["the odds are in my favour. mostly.", "one more chapter. i volunteer."] },
  // ---------------------------------------------------------------- classics
  { title: /moby.?dick|the whale\b/i, moves: ["whale"], lines: ["call me pip.", "that is one big white problem."] },
  { title: /old man and the sea/i, moves: ["marlin"], lines: ["the fish is winning. the fish is winning."] },
  { title: /great gatsby/i, moves: ["greenlight"], lines: ["so close, that little green light.", "old sport. new chapter."] },
  { title: /to kill a mockingbird|go set a watchman/i, moves: ["songbird"], lines: ["don't mind me, just a small bird friend.", "sing, bird. i'll hum along."] },
  { title: /\b1984\b|nineteen eighty.four/i, moves: ["bigeye"], lines: ["someone's watching me read.", "2 + 2 = 4. i'm sticking with that."] },
  { title: /brave new world/i, moves: ["bigeye"], lines: ["everyone's happy here. suspiciously happy."] },
  { title: /handmaid'?s tale|the testaments/i, moves: ["bigeye"], lines: ["eyes everywhere. i'll whisper."] },
  { title: /animal farm/i, moves: ["bigeye"], lines: ["all leaves are equal. mine is more equal."] },
  { title: /charlotte'?s web/i, moves: ["spiderweb"], lines: ["the web says pip. the web is correct."] },
  { title: /fahrenheit 451/i, moves: ["bookrescue"], lines: ["not this book. never this book."] },
  { title: /frankenstein/i, moves: ["monster"], lines: ["it lives! and it wants a snack.", "who put bolts on my neck?"] },
  { title: /dracula|twilight|new moon|eclipse|breaking dawn|interview with the vampire|salem'?s lot/i, moves: ["vampire"], lines: ["i vant to read your book.", "not the sun! anything but the sun!"] },
  {
    title: /sherlock|study in scarlet|sign of (the )?four|hound of the baskervilles|valley of fear|adventures of sherlock/i,
    author: /arthur conan doyle|agatha christie/i,
    moves: ["sleuth"],
    lines: ["elementary. mostly.", "the butler? too obvious. the leaf? interesting."]
  },
  { title: /murder on the orient express|and then there were none|death on the nile|roger ackroyd/i, moves: ["sleuth"], lines: ["everyone's a suspect. especially you, bookmark."] },
  { title: /don quixote/i, moves: ["windmill"], lines: ["that giant is definitely a windmill. charge!"] },
  { title: /metamorphosis/i, moves: ["beetle"], lines: ["woke up a bug. called in sick."] },
  { title: /gulliver/i, moves: ["tiedown"], lines: ["tiny ropes. very tiny. very many."] },
  { title: /les mis[eé]rables/i, moves: ["barricade", "doorstop"], lines: ["up the barricade, down the chapter.", "one more chapter! one more… 300 chapters."] },
  {
    title: /war and peace|infinite jest|ulysses|in search of lost time|middlemarch|anna karenina|brothers karamazov|atlas shrugged|the count of monte cristo|shogun/i,
    moves: ["doorstop"],
    lines: ["this book weighs more than me. challenge accepted.", "a doorstop. a masterpiece. a doorstop."]
  },
  { title: /pride and prejudice|sense and sensibility|\bemma\b|persuasion|mansfield park|northanger abbey/i, author: /jane austen/i, moves: ["curtsy"], lines: ["a truly acceptable chapter, sir.", "i am quite overcome. by page count."] },
  { title: /the raven|tell.tale heart|fall of the house of usher/i, author: /edgar allan poe/i, moves: ["raven"], lines: ["quoth the raven: skip to the good part."] },
  { title: /jekyll|mr\.? hyde/i, moves: ["potion"], lines: ["one sip. two pips."] },
  { title: /time machine/i, moves: ["timemachine"], lines: ["back to the future chapter. forward to the next."] },
  { title: /treasure island/i, moves: ["treasure"], lines: ["x marks the good part.", "arr. mostly arr."] },
  { title: /twenty thousand leagues|20,?000 leagues/i, moves: ["submarine"], lines: ["something's knocking on the porthole. with eight arms."] },
  { title: /little prince|petit prince/i, moves: ["tinyplanet"], lines: ["a small planet, a big rose, a tiny pip."] },
  { title: /very hungry caterpillar/i, moves: ["caterpillar"], lines: ["ate one apple. and a book. and some more."] },
  { title: /where the wild things are/i, moves: ["wildcrown"], lines: ["rumpus time! (it's just dancing)"] },
  { title: /charlie and the chocolate factory|chocolate factory/i, moves: ["goldenticket"], lines: ["golden ticket! gold! ticket!"] },
  { title: /\bmatilda\b/i, moves: ["floatbooks"], lines: ["books, float. books: yes, pip."] },
  { title: /wuthering heights|jane eyre|great expectations|christmas carol/i, moves: ["ghost"], lines: ["something moaned on the moor. probably the wind.", "spooky. cosy. spooky-cosy."] },
  { title: /\bhamlet\b|macbeth|king lear|othello/i, author: /shakespeare/i, moves: ["skull"], lines: ["to read, or to nap? to read."] },
  // ---------------------------------------------------------------- modern
  { title: /\bdune\b|dune messiah|children of dune|god emperor of dune/i, moves: ["sandworm"], lines: ["no rhythm at all. perfect for sand.", "sand, sand, worm. keep reading."] },
  { title: /hitchhiker'?s guide|restaurant at the end|life,? the universe|so long,? and thanks|mostly harmless/i, moves: ["towel42"], lines: ["stay calm. bring a towel.", "the answer is 42. the question is lunch."] },
  { title: /\bthe martian\b/i, moves: ["potatoes"], lines: ["potatoes: planted. mars: pending."] },
  { title: /project hail mary/i, moves: ["rockfriend"], lines: ["fist bump, rock buddy.", "best space friend. no contest."] },
  { title: /ender'?s game|speaker for the dead/i, moves: ["zerog"], lines: ["the enemy's gate is… that way?"] },
  { title: /jurassic park|the lost world/i, moves: ["trexripple"], lines: ["the water's rippling. that's fine. that's fine."] },
  { title: /^jaws\b|\bjaws\b/i, moves: ["sharkfin"], lines: ["that fin's getting closer. feet up."] },
  { title: /^it$|^it:|stephen king'?s it/i, author: /stephen king/i, moves: ["redballoon"], lines: ["that balloon is not invited."] },
  { title: /the shining|maze runner|labyrinth/i, moves: ["hedgemaze"], lines: ["a hedge maze. of course it's a hedge maze."] },
  { title: /life of pi/i, moves: ["tigerboat"], lines: ["good kitty. big kitty. good big kitty."] },
  { title: /kite runner/i, moves: ["kite"], lines: ["the kite's winning. hold on!"] },
  { title: /midnight library|the book thief|inkheart|shadow of the wind|name of the wind/i, moves: ["floatbooks"], lines: ["a library that never ends. my dream.", "every book is a door. this one squeaks."] }
];

const pick = <T,>(items: T[], seed: number) => items[Math.abs(seed) % items.length];

/** Pip's nod for a book, or null when the book isn't one of these. */
export const nodFor = (book: { title?: string | null; author?: string | null }, seed = Date.now()) => {
  const title = book.title ?? "";
  const author = book.author ?? "";
  const nod = NODS.find((entry) => (entry.title && entry.title.test(title)) || (entry.author && author && entry.author.test(author)));
  if (!nod) {
    return null;
  }
  return { move: pick(nod.moves, seed), line: pick(nod.lines, Math.floor(seed / 7)) };
};

/** How many books Pip has a scene for (for the docs and the Pip tab). */
export const NOD_COUNT = NODS.length;
