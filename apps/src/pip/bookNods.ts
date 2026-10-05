/**
 * Pip's nods to books: open one she knows and, now and then, Pip plays a
 * little scene about it (a dragon on its tail, gloves coming off in a shower
 * of sparks, an owl with a letter). The scenes live in ./books/; this decides
 * which book gets which, and what Pip says.
 *
 * Titles and authors come from a file's metadata, so they are messy: "Shatter
 * Me (Shatter Me, #1)", "SHERLOCK HOLMES: The Complete Collection", "Doyle,
 * Arthur Conan". Both are tidied first (`plainTitle`, `plainAuthor`), and an
 * entry says outright what is enough to claim a book:
 *
 * - `title`: the title alone. For names nothing else is called.
 * - `titleBy`: a title that counts only with its author, for short or common
 *   ones ("It", "Emma", "Legend", "Wonder").
 * - `author`: the writer alone, for one whose every book fits the scene.
 *
 * A title speaks before an author does, so a book with a scene of its own
 * keeps it even when its writer has a general one; among titles, the first
 * entry in the table wins. A book no entry knows may still get a generic scene
 * for its genre (`GENRE_NODS`), which never claims to know the book.
 *
 * Lines are Pip's own words, never quotes from the books, and give nothing
 * away. Scripture is left out on purpose.
 */

export type BookNod = {
  /** A name for the entry (tests and the docs point at it). */
  id: string;
  /** Scenes to pick from: ids from ./books/, or any of Pip's moves. */
  moves: string[];
  /** Pip's lines, one picked per showing. */
  lines: string[];
  /** Enough on its own. */
  title?: RegExp;
  /** A title, and the author it must come with. */
  titleBy?: [RegExp, RegExp];
  /** Enough on its own: every book by this writer. */
  author?: RegExp;
  /** How many books or series the entry stands for, when more than one. */
  n?: number;
};

/** The longest line her bubble holds in two rows (230px wide, 13px type). */
export const NOD_LINE_MAX = 60;

// ------------------------------------------------------------------ tidying

const fold = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‘’'`]/g, "")
    .replace(/×/g, " x ");

/**
 * A title as the table reads it: lower case, no accents or apostrophes, "&"
 * as "and", hyphens as spaces, and a spaced dash as the colon it stands for.
 */
export const plainTitle = (title: string | null | undefined) =>
  fold(title ?? "")
    .replace(/&/g, " and ")
    .replace(/\s[-–—]+\s/g, ": ")
    .replace(/[-–—_]/g, " ")
    .replace(/[.,!?"“”]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * An author as the table reads it. "Doyle, Arthur Conan, 1859-1930" is kept
 * both ways round ("doyle arthur conan | arthur conan doyle"), initials are
 * closed up ("J. K. Rowling" and "Rowling, J.K." both hold "jk rowling"), and
 * several writers are each read on their own.
 */
export const plainAuthor = (author: string | null | undefined) =>
  fold(author ?? "")
    .split(/[;|/&]|\band\b|\bwith\b/)
    .map((name) => {
      const parts = name
        .replace(/\b\d{4}\s*-\s*(\d{4})?/g, "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      return parts.length > 1 ? `${parts.join(" ")} | ${parts[1]} ${parts[0]}` : (parts[0] ?? "");
    })
    .filter(Boolean)
    .join(" | ")
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b([a-z]) (?=[a-z]\b)/g, "$1")
    .trim();

/** Any of these phrases, as whole words, anywhere in the title. */
const t = (...phrases: string[]) => new RegExp(`\\b(?:${phrases.join("|")})\\b`);
/**
 * The whole title is one of these names (an article before it and a subtitle,
 * a series in brackets or "a novel" after it are let through): "It: A Novel"
 * is It; "It Ends with Us" is not.
 */
const only = (...names: string[]) => new RegExp(`^(?:the |a |an )?(?:${names.join("|")})(?= ?[:(\\[/]| by |(?: a novel| the novel)?$)`);
/** A surname, or a full name, as whole words. */
const by = (...names: string[]) => new RegExp(`\\b(?:${names.join("|")})\\b`);
/** Either pattern. */
const any = (...patterns: RegExp[]) => new RegExp(patterns.map((pattern) => `(?:${pattern.source})`).join("|"));

export const NODS: readonly BookNod[] = [
  // ---------------------------------------------------------------- fantasy
  {
    id: "ice-and-fire",
    title: t("song of ice and fire", "game of thrones", "clash of kings", "storm of swords", "feast for crows", "dance with dragons", "winds of winter", "house of the dragon", "knight of the seven kingdoms"),
    titleBy: [t("fire and blood"), by("martin")],
    moves: ["dragonchase"],
    lines: ["dragon! dragon! not the leaf!", "winter's on its way. so is that dragon.", "i'd like to file a complaint about the dragons."]
  },
  { id: "hobbit", title: t("the hobbit"), moves: ["dragonchase", "ring"], lines: ["second breakfast first, then the dragon.", "is this ring… humming?", "i'm going on an adventure! (slowly)"] },
  {
    id: "lord-of-the-rings",
    title: t("lord of the rings", "fellowship of the ring", "two towers", "return of the king", "silmarillion", "unfinished tales", "children of hurin"),
    moves: ["fireeye", "ring"],
    lines: ["i feel watched. by a very big eye.", "one ring. zero thank-yous.", "that eye has seen my reading streak."]
  },
  {
    id: "harry-potter",
    title: t("harry potter", "philosophers stone", "sorcerers stone", "chamber of secrets", "prisoner of azkaban", "goblet of fire", "order of the phoenix", "half blood prince", "deathly hallows", "cursed child", "fantastic beasts", "beedle the bard", "quidditch through the ages"),
    moves: ["owlpost", "wandspell"],
    lines: ["a letter! for me! delivered by owl!", "swish and flick. mostly flick.", "i'm a wizard, apparently."]
  },
  {
    id: "eragon",
    title: t("eragon", "brisingr", "inheritance cycle", "murtagh"),
    titleBy: [only("eldest", "inheritance"), by("paolini")],
    moves: ["dragonchase"],
    lines: ["a dragon egg would be nice. a smaller dragon, please.", "a farm boy finds a blue stone. it is not a stone."]
  },
  { id: "fourth-wing", title: t("fourth wing", "iron flame", "onyx storm", "empyrean"), moves: ["dragonchase"], lines: ["dragon school sounds dangerous. i'm in.", "the dragons pick the riders. i'd wait all day."] },
  { id: "train-your-dragon", title: t("how to train your dragon"), moves: ["dragonchase"], lines: ["step one: don't get toasted. step two: pending.", "a small dragon and a smaller viking. best friends."] },
  { id: "polite-dragons", title: t("temeraire", "his majestys dragon", "priory of the orange tree", "day of fallen night"), n: 2, moves: ["dragonchase"], lines: ["this dragon has excellent manners. and fire.", "tea with a dragon. mind the cups."] },
  {
    // The author tells it from A. P. J. Abdul Kalam's memoir of the same name (below, with the memoirs).
    id: "wings-of-fire-dragons",
    title: t("dragonet prophecy"),
    titleBy: [t("wings of fire", "lost heir", "hidden kingdom", "dark secret", "brightest night"), by("sutherland")],
    moves: ["dragonchase"],
    lines: ["dragons with opinions. so many opinions.", "five dragonets and a prophecy. no pressure."]
  },
  {
    id: "narnia",
    title: t("narnia", "lion the witch", "prince caspian", "dawn treader", "silver chair", "horse and his boy", "magicians nephew"),
    titleBy: [only("last battle"), by("lewis")],
    moves: ["wardrobe"],
    lines: ["check the back of every wardrobe. every one.", "it's always winter in here. bring a scarf."]
  },
  { id: "alice", title: t("alices adventures", "alice in wonderland", "through the looking glass"), moves: ["rabbitwatch", "teaparty"], lines: ["late for something. very important something.", "tea time! the teapot disagrees."] },
  { id: "oz", title: t("wizard of oz", "wonderful wizard"), moves: ["tornado"], lines: ["home is wherever the book is.", "click click click. still here."] },
  { id: "peter-pan", title: t("peter pan", "peter and wendy"), moves: ["flyshadow"], lines: ["come back, shadow! we had plans!", "off to the island. back by bedtime."] },
  {
    id: "sanderson",
    title: t("mistborn", "final empire", "well of ascension", "hero of ages", "stormlight", "way of kings", "words of radiance", "oathbringer", "rhythm of war", "wind and truth", "elantris", "warbreaker", "alloy of law", "tress of the emerald sea"),
    author: by("brandon sanderson"),
    n: 4,
    moves: ["coinpush"],
    lines: ["push the coin, fly the pip.", "the magic has rules. i have a leaf.", "another thousand pages. he must type very fast."]
  },
  {
    id: "percy-jackson",
    title: t("percy jackson", "lightning thief", "sea of monsters", "titans curse", "battle of the labyrinth", "last olympian", "heroes of olympus", "lost hero", "son of neptune", "mark of athena", "house of hades", "blood of olympus", "trials of apollo", "chalice of the gods"),
    n: 3,
    moves: ["trident"],
    lines: ["half pip, half god of the sea.", "i've been claimed. by the splash zone.", "summer camp, but with monsters. sign me up."]
  },
  {
    id: "hunger-games",
    title: t("hunger games", "mockingjay", "ballad of songbirds", "sunrise on the reaping"),
    titleBy: [t("catching fire"), by("collins")],
    moves: ["mockingjay"],
    lines: ["the odds are in my favour. mostly.", "one more chapter. i volunteer."]
  },
  {
    id: "wheel-of-time",
    title: t("wheel of time", "eye of the world", "dragon reborn", "fires of heaven", "path of daggers", "crossroads of twilight", "knife of dreams", "towers of midnight", "memory of light"),
    titleBy: [t("great hunt", "shadow rising", "lord of chaos", "crown of swords", "winters heart", "gathering storm", "new spring"), by("robert jordan", "jordan")],
    moves: ["doorstop"],
    lines: ["fourteen books. i packed a lunch. and a tent.", "a braid, a sword, a prophecy. and thirteen more books.", "someone just tugged her braid. i felt it."]
  },
  {
    id: "witcher",
    title: t("witcher", "blood of elves", "sword of destiny"),
    titleBy: [t("last wish", "time of contempt", "baptism of fire", "tower of the swallow", "lady of the lake", "season of storms"), by("sapkowski")],
    moves: ["potion"],
    lines: ["a potion before the fight. tastes like regret.", "monsters: handled. mood: grumpy.", "two swords. i have one leaf."]
  },
  {
    id: "good-omens",
    title: t("good omens"),
    moves: ["floatbooks"],
    lines: ["an angel with a bookshop. i'd shop there.", "the end of the world is running a bit late."]
  },
  {
    id: "discworld",
    title: t("discworld", "colour of magic", "color of magic", "light fantastic", "equal rites", "wyrd sisters", "guards guards", "small gods", "going postal", "hogfather", "reaper man", "wee free men", "monstrous regiment", "thief of time", "unseen academicals", "raising steam", "men at arms", "feet of clay", "witches abroad", "lords and ladies"),
    author: by("terry pratchett", "pratchett"),
    moves: ["floatbooks", "magic"],
    lines: ["a flat world on a turtle. finally, sensible geography.", "the footnotes have footnotes. i approve.", "the luggage has legs. the luggage has teeth."]
  },
  { id: "earthsea", title: t("earthsea", "tombs of atuan", "farthest shore", "tehanu"), moves: ["wandspell", "dragonchase"], lines: ["names have power. mine is pip. be careful with it.", "a wizard, a boat, a great deal of sea."] },
  { id: "american-gods", title: t("american gods", "anansi boys"), moves: ["magic"], lines: ["coin tricks and old gods. i'm keeping my leaf close.", "a road trip. the passengers are very, very old."] },
  { id: "neverwhere", title: t("neverwhere"), moves: ["torchdark"], lines: ["there's a whole city under the city. bring a torch.", "mind the doors. some of them open onto elsewhere."] },
  { id: "coraline", title: t("coraline"), moves: ["nervous", "jumpscare"], lines: ["buttons are for coats. only for coats.", "that little door was locked for a reason."] },
  { id: "graveyard-book", title: t("graveyard book"), moves: ["ghost"], lines: ["raised by ghosts. very polite ones.", "the neighbours are quiet. and see-through."] },
  { id: "night-circus", title: t("night circus"), moves: ["magic", "mask"], lines: ["the circus arrives without warning. like my naps.", "black and white, and open only at night."] },
  { id: "howl", title: t("howls moving castle", "castle in the air", "house of many ways"), moves: ["wandspell"], lines: ["a castle that walks. a wizard who sulks.", "i'd make a deal with the fire. for toast."] },
  { id: "princess-bride", title: t("princess bride"), moves: ["mask", "heartbeat"], lines: ["true love and sword fights. skip nothing.", "i'd storm a castle for this book. a small one."] },
  {
    id: "rivers-of-london",
    title: t("rivers of london", "midnight riot", "moon over soho", "whispers under ground", "peter grant"),
    moves: ["sleuth", "wandspell"],
    lines: ["a police constable with a wand. the paperwork doubles.", "magic, but with forms to fill in."]
  },
  {
    id: "dark-materials",
    title: t("his dark materials", "golden compass", "subtle knife", "amber spyglass", "book of dust", "la belle sauvage", "secret commonwealth"),
    titleBy: [only("northern lights"), by("pullman")],
    moves: ["songbird"],
    lines: ["everyone gets an animal friend. i call the bird.", "north. further north. bring a coat."]
  },
  {
    id: "unfortunate-events",
    title: t("series of unfortunate events", "bad beginning", "reptile room", "miserable mill", "austere academy", "ersatz elevator"),
    author: by("lemony snicket"),
    moves: ["bigeye", "nervous"],
    lines: ["i was told to look away. i did not look away.", "something unfortunate is coming. i brought tissues."]
  },
  { id: "artemis-fowl", title: t("artemis fowl"), moves: ["heist"], lines: ["a twelve-year-old with a plan. i fear for the fairies.", "the gold is underground. so is the trouble."] },
  {
    id: "acotar",
    title: t("court of thorns and roses", "court of mist and fury", "court of wings and ruin", "court of frost and starlight", "court of silver flames", "acotar"),
    moves: ["thorncrown", "mask"],
    lines: ["thorns, roses, and very dramatic fae.", "a court of what now? …i'm listening.", "the fae cannot be trusted. i trust them anyway."]
  },
  {
    id: "throne-of-glass",
    title: t("throne of glass", "crown of midnight", "heir of fire", "queen of shadows", "empire of storms", "tower of dawn", "kingdom of ash", "assassins blade"),
    moves: ["mask", "thorncrown"],
    lines: ["an assassin who loves books. we'd get along.", "crowns are heavy. swords are heavier."]
  },
  {
    id: "crescent-city",
    title: t("crescent city", "house of earth and blood", "house of sky and breath", "house of flame and shadow"),
    moves: ["mask"],
    lines: ["angels, fae, and a city that never naps.", "a party girl with a sword. i'm paying attention."]
  },
  { id: "six-of-crows", title: t("six of crows", "crooked kingdom"), moves: ["heist"], lines: ["six crows, one impossible job. i'm the seventh.", "a heist! i'll hold the map. upside down."] },
  {
    id: "shadow-and-bone",
    title: t("shadow and bone", "siege and storm", "ruin and rising", "king of scars", "rule of wolves", "grishaverse"),
    moves: ["sunbathe"],
    lines: ["summoning the sun. it's a leaf thing.", "the dark bit of the map is not on my route."]
  },
  {
    id: "cruel-prince",
    title: t("cruel prince", "wicked king", "queen of nothing", "folk of the air", "stolen heir", "prisoners throne"),
    moves: ["mask", "thorncrown"],
    lines: ["faerie court manners: smile, bow, trust no one.", "everyone here is plotting. even the furniture."]
  },
  {
    id: "red-queen",
    title: t("red queen series", "red queen collection"),
    titleBy: [t("red queen", "glass sword", "kings cage", "war storm"), by("aveyard")],
    moves: ["mask"],
    lines: ["red blood, silver blood, a lot of lightning.", "a palace full of smiles. i trust none of them."]
  },
  {
    id: "caraval",
    title: t("caraval"),
    titleBy: [t("legendary", "finale", "once upon a broken heart", "ballad of never after", "curse for true love"), by("garber")],
    moves: ["mask", "magic"],
    lines: ["a game with tickets, masks and tricks. i'm in.", "nothing here is what it looks like. except me."]
  },
  { id: "ember-in-the-ashes", title: t("ember in the ashes", "torch against the night", "reaper at the gates", "sky beyond the storm"), moves: ["mask"], lines: ["silver masks, and a school i would not attend.", "sneaking about an empire. on tiptoe."] },
  {
    id: "shadowhunters",
    title: t("mortal instruments", "city of bones", "city of ashes", "city of glass", "infernal devices", "clockwork angel", "clockwork prince", "clockwork princess", "shadowhunter", "shadowhunters"),
    author: by("cassandra clare"),
    moves: ["magic"],
    lines: ["runes, demons, and a very tangled family tree.", "an institute, a stele, a lot of leather jackets."]
  },
  { id: "raven-cycle", title: t("raven boys", "dream thieves", "blue lily lily blue", "raven cycle"), moves: ["raven"], lines: ["four boys, one sleeping king, many birds.", "a psychic's daughter and a boy with a map of ley lines."] },
  { id: "blood-and-ash", title: t("from blood and ash", "kingdom of flesh and fire", "crown of gilded bones"), moves: ["mask", "thorncrown"], lines: ["a veil, a guard, a great many secrets.", "she was told not to look. she looked."] },
  { id: "divine-rivals", title: t("divine rivals", "ruthless vows"), moves: ["loveletter", "glaresmile"], lines: ["rival reporters and magic letters. i'll deliver this one.", "typing to a stranger. the stranger types back."] },
  { id: "powerless", titleBy: [only("powerless", "reckless", "fearless"), by("lauren roberts")], moves: ["choosing", "mask"], lines: ["trials, a prince, and a girl with a secret.", "everyone has a power. she has good aim."] },
  { id: "serpent-and-wings", title: t("serpent and the wings of night", "ashes and the star cursed king"), moves: ["vampire", "choosing"], lines: ["a tournament of vampires. i'll watch from here.", "one human in a room of fangs. brave."] },
  { id: "one-dark-window", title: t("one dark window", "two twisted crowns"), moves: ["mask", "thorncrown"], lines: ["mist, old cards, and a voice that isn't hers.", "a deck of cards i would not shuffle."] },
  { id: "lightlark", title: t("lightlark", "nightbane", "skyshade"), moves: ["thorncrown", "mask"], lines: ["six rulers, one island, a hundred days.", "everyone's cursed and everyone's lying. fun."] },
  { id: "violent-delights", title: t("these violent delights", "our violent ends"), moves: ["glaresmile", "mask"], lines: ["two rival heirs in old shanghai. sparks, of both kinds.", "a monster in the river, two gangs on the bank."] },
  { id: "school-good-evil", title: t("school for good and evil"), moves: ["choosing", "wandspell"], lines: ["two schools. one for each of my moods.", "best friends, sorted the wrong way round. maybe."] },
  { id: "skulduggery", title: t("skulduggery pleasant"), moves: ["skull"], lines: ["a skeleton detective. best dressed in the book.", "he's all bones and all jokes."] },
  { id: "darker-shade", title: t("darker shade of magic", "gathering of shadows", "conjuring of light"), moves: ["magic"], lines: ["four londons. i've only seen the one. in books.", "a coat with more sides than a coat should have."] },
  { id: "legends-and-lattes", title: t("legends and lattes", "bookshops and bonedust"), moves: ["coffeecups"], lines: ["an orc opens a coffee shop. low stakes, high comfort.", "swords down, kettle on."] },
  { id: "cerulean-sea", title: t("house in the cerulean sea", "somewhere beyond the sea", "under the whispering door"), moves: ["picnic"], lines: ["an island of unusual children. i'd like to visit.", "a case worker, a rule book, a change of heart."] },
  { id: "piranesi", title: t("piranesi"), moves: ["hedgemaze"], lines: ["a house of endless halls and tides. mind the statues.", "he keeps careful notes. i like him."] },
  { id: "locke-lamora", title: t("lies of locke lamora", "gentleman bastard", "red seas under red skies"), moves: ["heist", "mask"], lines: ["thieves with a plan. the plan has a plan.", "the con is elaborate. the lunch is better."] },
  { id: "first-law", title: t("blade itself", "before they are hanged", "last argument of kings", "first law"), moves: ["boxing"], lines: ["grim, muddy, and funnier than it should be.", "nobody here is a hero. everybody's interesting."] },
  { id: "malazan", title: t("malazan", "gardens of the moon", "deadhouse gates", "memories of ice"), moves: ["doorstop"], lines: ["ten huge books. see you next year.", "i don't know what's happening. i'm having a great time."] },
  { id: "farseer", title: t("assassins apprentice", "royal assassin", "assassins quest", "farseer", "liveship", "fools errand"), author: by("robin hobb"), moves: ["songbird"], lines: ["a boy, a wolf, a hard road. i'm fond of all three.", "royal secrets and a very loyal dog."] },
  { id: "redwall", title: t("redwall", "mossflower"), moves: ["picnic"], lines: ["mice with swords, and very good feasts.", "an abbey, a tapestry, a great deal of pudding."] },
  { id: "addie-larue", title: t("addie larue"), moves: ["smitten"], lines: ["three hundred years, and nobody remembers her. i will.", "a deal made after dark. read the small print."] },
  { id: "circe", titleBy: [only("circe"), by("miller")], moves: ["potion"], lines: ["a witch, an island, a great many herbs.", "the gods are dreadful company. the lions are lovely."] },
  { id: "song-of-achilles", title: t("song of achilles"), moves: ["heartbeat"], lines: ["i know how the myth goes. i'm reading anyway.", "two boys, a lyre, a long war coming."] },
  {
    id: "book-magic",
    title: t("midnight library", "book thief", "inkheart", "inkspell", "shadow of the wind", "name of the wind", "wise mans fear", "invisible library", "starless sea", "atlas six", "atlas paradox", "neverending story"),
    n: 8,
    moves: ["floatbooks"],
    lines: ["a library that never ends. my dream.", "every book is a door. this one squeaks."]
  },
  { id: "matilda", titleBy: [only("matilda"), by("dahl")], moves: ["floatbooks"], lines: ["books, float. books: yes, pip.", "a library card and a lot of nerve."] },

  // ------------------------------------------------- young adult and school
  {
    id: "shatter-me",
    title: t("shatter me"),
    titleBy: [t("unravel me", "ignite me", "restore me", "defy me", "imagine me", "believe me", "destroy me", "fracture me", "shadow me", "reveal me", "unite me", "find me", "watch me"), by("mafi")],
    moves: ["sparktouch"],
    lines: ["gloves off. sparks on.", "careful. i'm told this touch crackles.", "every other line is crossed out. i read those too."]
  },
  {
    id: "divergent",
    title: t("divergent trilogy", "divergent series"),
    titleBy: [t("divergent", "insurgent", "allegiant"), by("veronica roth", "roth")],
    moves: ["choosing"],
    lines: ["pick one thing to be? i'm at least four things.", "choosing day. i choose snacks."]
  },
  {
    id: "selection",
    title: t("selection series"),
    titleBy: [only("selection", "elite", "one", "heir", "crown"), by("kiera cass", "cass")],
    moves: ["curtsy", "heartbeat"],
    lines: ["thirty-five girls, one prince, a great many gowns.", "i'd enter. for the palace library."]
  },
  {
    id: "inheritance-games",
    title: t("inheritance games", "hawthorne legacy", "final gambit", "brothers hawthorne", "grandest game"),
    moves: ["sleuth", "heist"],
    lines: ["a mansion full of riddles. i call the library.", "every key opens something. i've tried my leaf."]
  },
  { id: "legend", titleBy: [only("legend", "prodigy", "champion", "rebel"), by("marie lu")], moves: ["speeddash", "choosing"], lines: ["the most wanted kid in the republic. good runner.", "a prodigy and a rebel. i'm rooting for both."] },
  { id: "uglies", title: t("uglies series", "uglies trilogy"), titleBy: [only("uglies", "pretties", "specials", "extras"), by("westerfeld")], moves: ["kickflip"], lines: ["a hoverboard? yes please.", "everyone gets a new face at sixteen. i'm keeping mine."] },
  { id: "giver", title: t("giver quartet"), titleBy: [only("giver", "gathering blue", "messenger"), by("lowry")], moves: ["bigeye"], lines: ["everything's the same here. i'm the green one.", "a job gets picked for you. mine would be napper."] },
  { id: "maze-runner", title: t("maze runner", "scorch trials", "death cure", "kill order", "fever code"), moves: ["hedgemaze"], lines: ["a maze. no map. excellent.", "a hedge maze. of course it's a hedge maze."] },
  { id: "lunar-chronicles", title: t("lunar chronicles"), titleBy: [only("cinder", "scarlet", "cress", "winter"), by("marissa meyer", "meyer")], moves: ["robot", "heartbeat"], lines: ["a mechanic at the ball. mind the foot.", "a fairy tale with a wrench in it."] },
  {
    id: "twilight",
    title: t("twilight saga", "breaking dawn"),
    titleBy: [only("twilight", "new moon", "eclipse", "midnight sun"), by("stephenie meyer", "meyer")],
    moves: ["vampire"],
    lines: ["he sparkles. i photosynthesise. same thing.", "team… team book."]
  },
  {
    id: "vampires",
    title: t("dracula", "interview with the vampire", "salems lot", "vampire chronicles", "carmilla", "vampire academy", "vampire diaries"),
    n: 6,
    moves: ["vampire"],
    lines: ["i vant to read your book.", "not the sun! anything but the sun!"]
  },
  { id: "heartstopper", title: t("heartstopper"), titleBy: [t("solitaire", "nick and charlie", "loveless", "radio silence"), by("oseman")], moves: ["heartbeat", "umbrella"], lines: ["two boys, some drifting leaves, a lot of blushing.", "two boys in form class. one can't stop smiling."] },
  { id: "fault-in-our-stars", title: t("fault in our stars"), moves: ["loveletter", "sob"], lines: ["i'm not crying. it's dew.", "some books are short and stay a long time."] },
  { id: "looking-for-alaska", title: t("looking for alaska"), moves: ["schoolday"], lines: ["boarding school, pranks, big questions.", "everyone gets a nickname. mine's still pip."] },
  { id: "paper-towns", title: t("paper towns"), moves: ["missingposter"], lines: ["she left clues. i'm following them. badly.", "a road trip with a map and no plan."] },
  { id: "perks", title: t("perks of being a wallflower"), moves: ["loveletter", "schoolday"], lines: ["this one's written in letters. i like that.", "standing at the edge of the dance. me too."] },
  { id: "both-die", title: t("they both die at the end", "first to die at the end"), moves: ["heartbeat"], lines: ["the title told me already. i'm reading it anyway.", "one day, lived properly. noted."] },
  { id: "good-girls-guide", title: t("good girls guide to murder", "good girl bad blood", "as good as dead"), moves: ["missingposter", "sleuth"], lines: ["a school project with a murder board. top marks.", "red string everywhere. i'm tangled."] },
  { id: "one-of-us-is-lying", title: t("one of us is lying", "one of us is next", "one of us is back"), moves: ["missingposter", "schoolday"], lines: ["five walk into detention. i'm taking notes.", "everyone has a secret. somebody has two."] },
  { id: "truly-devious", title: t("truly devious"), moves: ["sleuth", "schoolday"], lines: ["a boarding school with a very old riddle.", "tunnels, riddles, and a very cold case."] },
  { id: "we-were-liars", title: t("we were liars"), moves: ["torchdark"], lines: ["a private island, a summer, a lot left unsaid.", "a beautiful family. look closer."] },
  { id: "summer-i-turned-pretty", title: t("summer i turned pretty", "its not summer without you", "well always have summer"), moves: ["sunbathe", "heartbeat"], lines: ["a beach house and two brothers. this will be simple.", "summer! i brought a towel and opinions."] },
  { id: "to-all-the-boys", title: t("to all the boys", "ps i still love you", "always and forever lara jean"), moves: ["loveletter"], lines: ["the letters were never meant to be posted. oops.", "a hatbox of love letters. what could go wrong."] },
  { id: "eleanor-and-park", title: t("eleanor and park"), moves: ["heartbeat"], lines: ["mixtapes and a bus seat. that's all. it's enough.", "one headphone each."] },
  { id: "better-than-movies", title: t("better than the movies"), moves: ["umbrella", "glaresmile"], lines: ["she wants a film ending. the boy next door disagrees.", "she has a soundtrack for everything. so do i."] },
  { id: "bright-places", title: t("all the bright places", "five feet apart", "everything everything", "sun is also a star"), n: 4, moves: ["heartbeat", "loveletter"], lines: ["tissues: fetched. heart: bracing.", "two people and not enough time. my favourite ache."] },
  { id: "holes", titleBy: [only("holes"), by("sachar")], moves: ["treasure"], lines: ["dig a hole a day. character building, apparently.", "found: one hole. many holes, actually."] },
  { id: "wonder", titleBy: [only("wonder"), by("palacio")], moves: ["schoolday"], lines: ["choosing kind. it's a good choice.", "new school, new faces. be nice, everyone."] },
  { id: "wimpy-kid", title: t("diary of a wimpy kid"), moves: ["schoolday", "laugh"], lines: ["it's a journal, not a diary. understood.", "middle school looks exhausting."] },
  { id: "very-silly", title: t("captain underpants", "dog man", "tom gates", "big nate"), n: 4, moves: ["laugh"], lines: ["this one's very silly. i respect that.", "the pictures are doing most of the work. good pictures."] },
  { id: "warrior-cats", title: t("warrior cats", "warriors: into the wild", "warriors super edition"), author: by("erin hunter"), moves: ["catvisit"], lines: ["clan business. very serious. very whiskers.", "four clans, one forest, a lot of hissing."] },
  { id: "goosebumps", title: t("goosebumps", "fear street"), author: by("rl stine"), moves: ["jumpscare", "ghost"], lines: ["a scary one. a little scary. i'm fine.", "something's under the bed. it's me. hello."] },
  { id: "wrinkle-in-time", title: t("wrinkle in time"), moves: ["starship"], lines: ["a shortcut through space. hold my leaf.", "a shortcut through the universe. mind the fold."] },

  // ------------------------------------------------- romance and rom-coms
  {
    id: "it-ends-with-us",
    title: t("it ends with us", "it starts with us"),
    moves: ["loveletter", "sob"],
    lines: ["this one needs tissues. i brought the box.", "a flower shop and a hard choice.", "reading this one gently."]
  },
  { id: "verity", titleBy: [only("verity"), by("hoover")], moves: ["torchdark", "nervous"], lines: ["a manuscript nobody should read. so i'm reading it.", "i'm sleeping with the light on."] },
  {
    id: "colleen-hoover",
    title: t("ugly love", "november 9", "reminders of him", "regretting you", "all your perfects", "maybe someday", "heart bones"),
    author: by("colleen hoover"),
    n: 7,
    moves: ["heartbeat", "sob"],
    lines: ["my heart signed up for this. my heart has regrets.", "one more chapter. my feelings can take it.", "i was fine a page ago."]
  },
  { id: "beach-read", titleBy: [only("beach read"), by("henry")], moves: ["glaresmile", "coffeecups"], lines: ["two writers, one bet, zero chill.", "he writes sad endings. she doesn't. swap!"] },
  { id: "book-lovers", titleBy: [only("book lovers"), by("henry")], moves: ["glaresmile", "coffeecups"], lines: ["a book about people who love books. approved.", "a small town, a sharp editor, a sharper agent."] },
  { id: "people-we-meet", title: t("people we meet on vacation", "you and me on vacation"), moves: ["umbrella", "sunbathe"], lines: ["one trip every summer. just friends. sure.", "packing for a holiday i'm not on."] },
  { id: "happy-place", titleBy: [only("happy place"), by("henry")], moves: ["heartbeat", "coffeecups"], lines: ["pretending to be fine at the beach house. classic.", "one last week at the cottage. nobody says a thing."] },
  {
    id: "emily-henry",
    titleBy: [only("funny story", "great big beautiful life"), by("henry")],
    author: by("emily henry"),
    n: 2,
    moves: ["coffeecups", "glaresmile", "umbrella"],
    lines: ["banter this good should need a licence.", "they'll kiss by chapter twenty. i checked the vibes."]
  },
  { id: "hating-game", title: t("hating game"), moves: ["glaresmile"], lines: ["they hate each other. so much. suspiciously much.", "an office, a staring contest, a lift."] },
  {
    id: "love-hypothesis",
    title: t("love hypothesis", "love on the brain", "love theoretically"),
    author: by("ali hazelwood"),
    n: 3,
    moves: ["glaresmile", "coffeecups"],
    lines: ["hypothesis: they like each other. evidence: all of it.", "science! and also feelings. mostly science."]
  },
  { id: "red-white-royal-blue", title: t("red white and royal blue"), moves: ["loveletter", "glaresmile"], lines: ["a prince, a president's son, a cake incident.", "the emails. oh, the emails."] },
  { id: "spanish-love-deception", title: t("spanish love deception", "american roommate experiment"), moves: ["glaresmile", "umbrella"], lines: ["a fake date for a wedding. my interest is real.", "he's tall, he's annoying, he volunteered."] },
  { id: "icebreaker", titleBy: [only("icebreaker", "wildfire", "daydream"), by("hannah grace", "grace")], moves: ["glaresmile", "heartbeat"], lines: ["a figure skater and a hockey captain share the ice. barely.", "skates on. gloves off. hm."] },
  {
    id: "twisted",
    title: t("twisted love", "twisted games", "twisted hate", "twisted lies", "king of wrath", "king of pride"),
    author: by("ana huang"),
    n: 2,
    moves: ["umbrella", "heartbeat"],
    lines: ["brooding. so much brooding. i brought an umbrella.", "he says he doesn't care. he bought the building."]
  },
  { id: "kiss-quotient", title: t("kiss quotient", "bride test", "heart principle"), moves: ["checklist", "heartbeat"], lines: ["she made a lesson plan for love. very organised.", "the maths is sound. the heart has notes."] },
  {
    id: "bridgerton",
    title: t("bridgerton", "bridgertons", "duke and i", "viscount who loved me", "offer from a gentleman", "romancing mister bridgerton"),
    author: by("julia quinn"),
    moves: ["curtsy", "mask"],
    lines: ["the gossip this season is excellent. do go on.", "a ball, a duke, a scandal. tuesday."]
  },
  {
    id: "outlander",
    title: t("outlander", "dragonfly in amber", "drums of autumn", "fiery cross", "breath of snow and ashes", "echo in the bone"),
    titleBy: [only("voyager"), by("gabaldon")],
    moves: ["timemachine", "heartbeat"],
    lines: ["touched a standing stone. wrong century. nice kilts.", "two hundred years late for dinner."]
  },
  { id: "me-before-you", title: t("me before you"), moves: ["heartbeat", "sob"], lines: ["bumblebee tights. excellent choice.", "tissues: fetched. heart: bracing."] },
  {
    id: "nicholas-sparks",
    title: t("walk to remember"),
    titleBy: [only("notebook", "last song", "longest ride"), by("sparks")],
    author: by("nicholas sparks"),
    n: 4,
    moves: ["umbrella", "loveletter"],
    lines: ["it's raining and someone's about to kiss. i can tell.", "a love story, read aloud. i'm listening."]
  },
  {
    id: "sally-rooney",
    titleBy: [only("normal people", "conversations with friends", "beautiful world where are you", "intermezzo"), by("rooney")],
    author: by("sally rooney"),
    n: 3,
    moves: ["heartbeat", "mope"],
    lines: ["no quotation marks. lots of feelings.", "they should just talk. they will not just talk."]
  },
  { id: "one-day", titleBy: [only("one day"), by("nicholls")], moves: ["loveletter", "umbrella"], lines: ["the same day, every year. i've marked my calendar.", "twenty years of the same date. bring a calendar."] },
  { id: "bridget-jones", title: t("bridget jones", "bridget joness diary"), moves: ["checklist", "laugh"], lines: ["dear diary: chapters read, many. regrets, none.", "today: zero regrets, one book, several biscuits."] },
  { id: "crazy-rich-asians", title: t("crazy rich asians", "china rich girlfriend", "rich people problems"), moves: ["coinjar", "mask"], lines: ["so much money. so many aunties.", "meeting the family. the very, very rich family."] },
  { id: "evelyn-hugo", title: t("seven husbands of evelyn hugo"), moves: ["mask", "smitten"], lines: ["seven husbands. one very good story.", "old hollywood, a green dress, secrets."] },
  { id: "daisy-jones", title: t("daisy jones"), moves: ["airguitar"], lines: ["everyone remembers it differently. i wasn't there.", "the band is fine. the band is not fine."] },
  { id: "call-me-by-your-name", title: t("call me by your name"), moves: ["sunbathe", "heartbeat"], lines: ["one summer in italy. peaches, bicycles, sighing.", "a long, slow summer. nobody hurries."] },
  { id: "fifty-shades", title: t("fifty shades"), moves: ["nervous"], lines: ["reading this one with my leaf over my eyes.", "ahem. that is a lot of neckties."] },
  { id: "rosie-project", title: t("rosie project", "rosie effect", "rosie result"), moves: ["checklist"], lines: ["a questionnaire for finding a wife. sixteen pages.", "the plan was perfect. then rosie."] },
  { id: "eleanor-oliphant", title: t("eleanor oliphant"), moves: ["tea"], lines: ["she's completely fine. it says so on the cover.", "a kind word goes a long way. noted."] },
  { id: "flatshare", title: t("flatshare", "flat share"), moves: ["loveletter"], lines: ["two flatmates, one flat, opposite hours. notes everywhere.", "they've never met. they share a bed. it's fine."] },
  { id: "time-travelers-wife", title: t("time travelers wife", "time travellers wife"), moves: ["timemachine", "heartbeat"], lines: ["he keeps turning up at the wrong time. she waits.", "love, out of order."] },
  { id: "unhoneymooners", title: t("unhoneymooners"), author: by("christina lauren"), moves: ["glaresmile"], lines: ["a free honeymoon with the worst possible person.", "enemies, a buffet, an island. go on."] },
  { id: "things-we-never", title: t("things we never got over", "it happened one summer", "cheat sheet", "ex hex"), n: 4, moves: ["glaresmile", "coffeecups"], lines: ["grumpy meets sunshine. i know how this goes. go on.", "a small town where everybody knows by lunchtime."] },
  { id: "after", title: t("after series"), titleBy: [only("after", "after we collided", "after we fell", "after ever happy"), by("anna todd", "todd")], moves: ["glaresmile", "umbrella"], lines: ["good girl, moody boy, a great many arguments.", "they break up every forty pages. i keep count."] },
  { id: "chloe-brown", title: t("get a life chloe brown", "take a hint dani brown", "act your age eve brown"), moves: ["checklist", "heartbeat"], lines: ["a list for getting a life. item one: this book.", "step one: do something reckless. step two: him."] },
  { id: "anna-french-kiss", title: t("anna and the french kiss", "lola and the boy next door"), moves: ["coffeecups", "heartbeat"], lines: ["a year in paris. the pastries alone.", "boarding school, cinemas, a boy with good hair."] },
  {
    id: "austen",
    title: t("pride and prejudice", "sense and sensibility", "mansfield park", "northanger abbey"),
    titleBy: [only("emma", "persuasion"), by("austen")],
    author: by("jane austen"),
    n: 6,
    moves: ["curtsy"],
    lines: ["a truly acceptable chapter, sir.", "i am quite overcome. by page count."]
  },

  // --------------------------------------------------- mystery and thriller
  {
    id: "sherlock",
    title: t("sherlock", "study in scarlet", "sign of the four", "sign of four", "hound of the baskervilles", "valley of fear", "his last bow", "scandal in bohemia", "red headed league", "speckled band", "baker street"),
    author: by("conan doyle"),
    moves: ["sleuth"],
    lines: ["elementary. mostly.", "the butler? too obvious. the leaf? interesting.", "i observe. i deduce. i lose my magnifying glass."]
  },
  {
    id: "christie",
    title: t("murder on the orient express", "and then there were none", "death on the nile", "roger ackroyd", "abc murders", "mysterious affair at styles", "murder at the vicarage", "body in the library", "evil under the sun", "five little pigs", "crooked house", "peril at end house", "murder is announced", "from paddington", "poirot", "miss marple", "marple"),
    author: by("agatha christie"),
    n: 3,
    moves: ["sleuth"],
    lines: ["everyone's a suspect. especially you, bookmark.", "gather everyone in the drawing room. i have a theory.", "my moustache is imaginary. my suspicions are not."]
  },
  { id: "young-sleuths", title: t("nancy drew", "hardy boys", "enola holmes"), n: 3, moves: ["sleuth", "torchdark"], lines: ["a torch, a hunch, a hidden staircase.", "the case is afoot. so am i."] },
  {
    id: "blyton",
    title: t("famous five", "secret seven", "five on a treasure island", "faraway tree", "malory towers", "st clares", "five find outers"),
    author: by("enid blyton"),
    n: 5,
    moves: ["picnic", "torchdark"],
    lines: ["an adventure, then a picnic. the correct order.", "smugglers, a secret passage, and sandwiches."]
  },
  { id: "gone-girl", title: t("gone girl"), moves: ["missingposter"], lines: ["she's missing. i have questions for everyone.", "two sides to this story. i trust neither."] },
  { id: "girl-on-the-train", title: t("girl on the train"), moves: ["missingposter", "torchdark"], lines: ["same train, same window, something's off.", "i saw something. i think. i'm not sure."] },
  {
    id: "dragon-tattoo",
    title: t("girl with the dragon tattoo", "girl who played with fire", "girl who kicked the hornets nest", "millennium trilogy"),
    moves: ["torchdark", "sleuth"],
    lines: ["a hacker, a journalist, a very cold case.", "do not get on her bad side. i won't."]
  },
  {
    id: "dan-brown",
    title: t("da vinci code", "angels and demons", "lost symbol", "robert langdon"),
    author: by("dan brown"),
    moves: ["sleuth", "heist"],
    lines: ["a symbol! a clue! running through a museum!", "every painting is hiding something. even the bad ones."]
  },
  { id: "silent-patient", title: t("silent patient"), moves: ["torchdark"], lines: ["she won't say a word. i can't stop asking.", "a painting, a diary, a locked ward."] },
  { id: "big-little-lies", title: t("big little lies", "nine perfect strangers", "husbands secret"), author: by("liane moriarty"), n: 3, moves: ["coffeecups", "missingposter"], lines: ["school-gate gossip, but dangerous.", "everyone's smiling. everyone's fibbing."] },
  {
    id: "thursday-murder-club",
    title: t("thursday murder club", "man who died twice", "bullet that missed", "last devil to die"),
    author: by("richard osman"),
    moves: ["tea", "sleuth"],
    lines: ["four pensioners and a cold case. i'd join.", "tea, cake, murder. in that order."]
  },
  { id: "rebecca", titleBy: [only("rebecca"), by("du maurier", "maurier")], moves: ["ghost"], lines: ["a big house by the sea. it remembers things.", "the housekeeper does not like me."] },
  { id: "reacher", title: t("jack reacher", "killing floor"), author: by("lee child"), moves: ["boxing"], lines: ["no luggage, just a toothbrush. efficient.", "he walked into town. the town will regret it."] },
  {
    id: "bond",
    title: t("james bond", "casino royale", "live and let die", "moonraker", "goldfinger", "from russia with love", "thunderball", "on her majestys secret service"),
    author: by("ian fleming"),
    moves: ["heist"],
    lines: ["a tuxedo, a gadget, a villain with a lair.", "licensed to read. double-oh-leaf."]
  },
  { id: "in-cold-blood", title: t("in cold blood"), moves: ["torchdark"], lines: ["true, careful, and very quiet. reading slowly.", "a small town in kansas, set down line by line."] },
  { id: "housemaid", title: t("housemaid", "housemaids secret", "housemaid is watching"), author: by("freida mcfadden"), moves: ["torchdark", "nervous"], lines: ["nobody in this house is telling me everything.", "the job came with a room. the room has a lock."] },
  { id: "grisham", title: t("pelican brief", "time to kill", "runaway jury"), author: by("john grisham"), n: 4, moves: ["point"], lines: ["objection! to what, i don't know. but objection!", "a young lawyer, a big firm, a bad feeling."] },
  {
    id: "sheldon",
    title: t("if tomorrow comes", "master of the game", "tell me your dreams", "other side of midnight", "rage of angels"),
    author: by("sidney sheldon"),
    n: 5,
    moves: ["heist", "mask"],
    lines: ["twists on twists. i've stopped guessing. i'm lying.", "glamour, schemes, a private jet or two."]
  },
  {
    id: "archer",
    title: t("kane and abel", "not a penny more not a penny less", "clifton chronicles", "only time will tell", "prodigal daughter"),
    author: by("jeffrey archer"),
    n: 4,
    moves: ["coinjar", "heist"],
    lines: ["fortunes made, lost, made again. i'm dizzy.", "two rivals, one lifetime. pass the popcorn."]
  },
  { id: "bourne", title: t("bourne identity", "bourne supremacy", "bourne ultimatum"), moves: ["speeddash"], lines: ["he doesn't know who he is. everyone else seems to.", "passports in six names. none of them his. maybe."] },
  { id: "le-carre", title: t("tinker tailor soldier spy", "spy who came in from the cold"), author: by("le carre"), n: 2, moves: ["torchdark", "mask"], lines: ["spies in grey coats. nobody says what they mean.", "the mole is in the building. so is the tea trolley."] },
  { id: "the-shining", titleBy: [only("shining", "doctor sleep"), by("king")], moves: ["hedgemaze"], lines: ["a hedge maze. of course it's a hedge maze.", "a hotel, closed for winter. lovely. no."] },
  { id: "it", title: t("stephen kings it"), titleBy: [only("it"), by("king")], moves: ["redballoon"], lines: ["that balloon is not invited.", "we do not look in storm drains. house rule."] },
  { id: "stephen-king", title: t("pet sematary"), author: by("stephen king"), moves: ["jumpscare", "nervous"], lines: ["it's a small town in maine. run.", "i'll read it. with the lights on. all of them."] },
  { id: "secret-history", titleBy: [only("secret history"), by("tartt")], moves: ["schoolday", "mask"], lines: ["greek class got out of hand.", "six students, one professor, a very bad winter."] },
  { id: "goldfinch", titleBy: [only("goldfinch"), by("tartt")], moves: ["songbird"], lines: ["a small bird on a chain. a very long book.", "he carries the painting everywhere. i'd carry it too."] },
  { id: "ladies-detective", title: t("ladies detective agency"), moves: ["sleuth", "tea"], lines: ["bush tea and good sense solve most things.", "a little white van and a great deal of patience."] },
  { id: "desi-sleuths", title: t("byomkesh", "feluda"), n: 2, moves: ["sleuth"], lines: ["a sharp mind, a cup of tea, a case.", "the clue was there all along. i walked past it."] },
  {
    id: "poe",
    title: t("tell tale heart", "fall of the house of usher", "masque of the red death", "murders in the rue morgue"),
    titleBy: [only("raven"), by("poe")],
    author: by("edgar allan poe", "poe"),
    moves: ["raven"],
    lines: ["quoth the raven: skip to the good part.", "something's tapping. i'm not getting the door."]
  },
  { id: "shutter-island", title: t("shutter island"), moves: ["torchdark"], lines: ["an island, a storm, a missing patient. hm.", "a ferry, a fog, two marshals."] },
  { id: "where-the-crawdads", title: t("where the crawdads sing"), moves: ["songbird"], lines: ["the marsh keeps its secrets. so do i.", "a girl, a boat, a marsh full of feathers."] },

  // ---------------------------------------------------------------- classics
  { id: "moby-dick", title: t("moby dick"), moves: ["whale"], lines: ["call me pip.", "that is one big white problem."] },
  { id: "old-man-and-sea", title: t("old man and the sea"), moves: ["marlin"], lines: ["the fish is winning. the fish is winning.", "one man, one boat, one very long day."] },
  { id: "gatsby", title: t("great gatsby"), moves: ["greenlight"], lines: ["so close, that little green light.", "old sport. new chapter."] },
  { id: "mockingbird", title: t("to kill a mockingbird", "go set a watchman"), moves: ["songbird"], lines: ["don't mind me, just a small bird friend.", "sing, bird. i'll hum along."] },
  { id: "1984", title: any(only("1984"), t("nineteen eighty four")), titleBy: [t("1984"), by("orwell")], moves: ["bigeye"], lines: ["someone's watching me read.", "2 + 2 = 4. i'm sticking with that."] },
  { id: "brave-new-world", title: t("brave new world"), moves: ["bigeye"], lines: ["everyone's happy here. suspiciously happy.", "a pill for everything. i'll stick with naps."] },
  { id: "handmaids-tale", title: t("handmaids tale"), titleBy: [only("testaments"), by("atwood")], moves: ["bigeye"], lines: ["eyes everywhere. i'll whisper.", "red cloaks, white wings, quiet steps."] },
  { id: "animal-farm", title: t("animal farm"), moves: ["bigeye"], lines: ["all leaves are equal. mine is more equal.", "a farm run by its animals. what could go wrong."] },
  { id: "charlottes-web", title: t("charlottes web"), moves: ["spiderweb"], lines: ["the web says pip. the web is correct.", "a good friend and a good writer. rare."] },
  { id: "fahrenheit-451", title: t("fahrenheit 451"), moves: ["bookrescue"], lines: ["not this book. never this book.", "the firemen here start the fires. noted."] },
  { id: "frankenstein", title: t("frankenstein"), moves: ["monster"], lines: ["it lives! and it wants a snack.", "who put bolts on my neck?"] },
  { id: "don-quixote", title: t("don quixote", "don quijote"), moves: ["windmill"], lines: ["that giant is definitely a windmill. charge!", "one knight, one squire, one very patient horse."] },
  { id: "metamorphosis", title: only("metamorphosis"), titleBy: [t("metamorphosis"), by("kafka")], moves: ["beetle"], lines: ["woke up a bug. called in sick.", "the family is taking it badly. so is he."] },
  { id: "gulliver", title: t("gullivers travels", "gulliver"), moves: ["tiedown"], lines: ["tiny ropes. very tiny. very many.", "very small people, then very large ones. hard to pack for."] },
  { id: "les-miserables", title: t("les miserables"), moves: ["barricade", "doorstop"], lines: ["up the barricade, down the chapter.", "one more chapter! one more… 300 chapters."] },
  { id: "suitable-boy", title: t("suitable boy"), moves: ["doorstop", "heartbeat"], lines: ["fourteen hundred pages to find one boy. thorough.", "four families and every opinion in india."] },
  {
    id: "doorstops",
    title: t("war and peace", "infinite jest", "in search of lost time", "middlemarch", "anna karenina", "brothers karamazov", "atlas shrugged", "count of monte cristo", "shogun", "gone with the wind", "pillars of the earth", "jonathan strange", "shantaram", "ponniyin selvan", "india after gandhi"),
    titleBy: [only("ulysses"), by("joyce")],
    n: 16,
    moves: ["doorstop"],
    lines: ["this book weighs more than me. challenge accepted.", "a doorstop. a masterpiece. a doorstop."]
  },
  {
    id: "dickens",
    title: t("oliver twist", "david copperfield", "tale of two cities", "bleak house", "nicholas nickleby", "pickwick papers"),
    author: by("charles dickens"),
    n: 6,
    moves: ["doorstop"],
    lines: ["fog, orphans, and one very long sentence.", "paid by the instalment, and it shows. fondly."]
  },
  { id: "moors-and-ghosts", title: t("wuthering heights", "jane eyre", "great expectations", "christmas carol", "turn of the screw", "haunting of hill house"), n: 6, moves: ["ghost"], lines: ["something moaned on the moor. probably the wind.", "spooky. cosy. spooky-cosy."] },
  { id: "jekyll-hyde", title: t("jekyll", "mr hyde"), moves: ["potion"], lines: ["one sip. two pips.", "the doctor's not himself today."] },
  { id: "time-machine", title: only("time machine"), titleBy: [t("time machine"), by("wells")], moves: ["timemachine"], lines: ["back to the future chapter. forward to the next.", "a lever, a saddle, eight hundred thousand years."] },
  { id: "treasure-island", title: only("treasure island"), titleBy: [t("treasure island"), by("stevenson")], moves: ["treasure"], lines: ["x marks the good part.", "arr. mostly arr."] },
  { id: "twenty-thousand-leagues", title: t("twenty thousand leagues", "20000 leagues"), moves: ["submarine"], lines: ["something's knocking on the porthole. with eight arms.", "the captain has a library down here. respect."] },
  { id: "centre-of-the-earth", title: t("journey to the cent(?:er|re) of the earth", "journey to the interior of the earth"), moves: ["torchdark"], lines: ["down. further down. is it warm in here?", "a volcano is the way in. naturally."] },
  { id: "eighty-days", title: t("around the world in (?:eighty|80) days"), moves: ["lap"], lines: ["eighty days. i'd need eighty-one. naps.", "a wager, a valet, every train on earth."] },
  { id: "war-of-the-worlds", title: t("war of the worlds"), moves: ["nervous", "jumpscare"], lines: ["something landed on the common. it has three legs.", "the martians did not call ahead."] },
  { id: "little-prince", title: t("little prince", "petit prince"), moves: ["tinyplanet"], lines: ["a small planet, a big rose, a tiny pip.", "a fox, a rose, a very small planet to sweep."] },
  { id: "hungry-caterpillar", title: t("very hungry caterpillar"), moves: ["caterpillar"], lines: ["ate one apple. and a book. and some more.", "saturday was a lot. no judgement."] },
  { id: "wild-things", title: t("where the wild things are"), moves: ["wildcrown"], lines: ["rumpus time! (it's just dancing)", "sent to bed without supper. sailed off instead."] },
  { id: "chocolate-factory", title: t("chocolate factory", "great glass elevator"), moves: ["goldenticket"], lines: ["golden ticket! gold! ticket!", "a river of chocolate. do not lean over."] },
  {
    id: "dahl",
    title: t("bfg", "james and the giant peach", "fantastic mr fox", "the twits", "danny the champion of the world", "georges marvellous medicine"),
    author: by("roald dahl"),
    n: 6,
    moves: ["magic", "laugh"],
    lines: ["a giant, a peach, a fox. one author, somehow.", "grown-ups beware. this one's on the kids' side."]
  },
  {
    id: "shakespeare",
    title: t("hamlet", "macbeth", "king lear", "othello", "romeo and juliet", "midsummer nights dream", "twelfth night", "julius caesar", "merchant of venice", "much ado about nothing"),
    author: by("shakespeare"),
    n: 10,
    moves: ["skull"],
    lines: ["to read, or to nap? to read.", "five acts. everyone talks to themselves. me too."]
  },
  { id: "catcher-in-the-rye", title: t("catcher in the rye"), moves: ["mope"], lines: ["a red hunting hat and a lot of opinions.", "he's fed up with everyone. except his sister."] },
  { id: "lord-of-the-flies", title: t("lord of the flies"), moves: ["nervous"], lines: ["an island, some schoolboys, no grown-ups. it'll be fine.", "they have a shell and some rules. for now."] },
  { id: "steinbeck", title: t("of mice and men", "grapes of wrath", "east of eden"), author: by("john steinbeck"), n: 3, moves: ["read"], lines: ["dust, a long road, people holding on.", "a small dream of a small farm. i'm holding it too."] },
  {
    id: "garcia-marquez",
    title: t("hundred years of solitude", "love in the time of cholera"),
    author: by("garcia marquez"),
    n: 2,
    moves: ["floatnap"],
    lines: ["everyone has the same name. i made a chart.", "magic happens and nobody blinks. normal town."]
  },
  {
    id: "dostoevsky",
    title: t("crime and punishment", "notes from underground"),
    author: by("dostoevsky", "dostoyevsky"),
    n: 2,
    moves: ["nervous"],
    lines: ["a guilty conscience, a small room, a fever.", "everyone here needs a nap and a hug."]
  },
  { id: "dorian-gray", title: t("dorian gray"), moves: ["mask"], lines: ["the portrait's doing something odd. don't look.", "handsome forever. suspicious."] },
  { id: "earnest", title: t("importance of being earnest"), moves: ["laugh", "curtsy"], lines: ["everyone's very witty and nobody's called ernest.", "cucumber sandwiches and a made-up friend in the country."] },
  { id: "odyssey", title: t("the odyssey", "odyssey of homer"), moves: ["trident"], lines: ["ten years to get home. i'd have asked for directions.", "the sea god is in a mood again."] },
  { id: "iliad", title: t("the iliad", "iliad of homer"), moves: ["bringit"], lines: ["everyone's very angry on this beach.", "ten years outside one wall. bring a chair."] },
  { id: "little-women", title: t("little women", "good wives", "jos boys"), moves: ["loveletter", "picnic"], lines: ["four sisters, and one very good attic for writing.", "i'm a jo. everyone says they're a jo."] },
  { id: "anne-of-green-gables", title: t("anne of green gables", "anne of avonlea", "anne of the island"), moves: ["picnic"], lines: ["anne with an e. pip with one p. wait.", "red braids and a very big imagination."] },
  { id: "secret-garden", title: t("secret garden", "little princess"), n: 2, moves: ["picnic"], lines: ["a locked door, a key, a robin who knows.", "things grow when somebody looks after them. noted."] },
  { id: "black-beauty", title: t("black beauty"), moves: ["picnic"], lines: ["be kind to horses. be kind, generally.", "a horse tells it himself. gently."] },
  { id: "heidi", title: only("heidi"), titleBy: [t("heidi"), by("spyri")], moves: ["picnic"], lines: ["mountain air, goat's milk, grandfather's hut.", "she wakes up the whole mountain. in a good way."] },
  { id: "robinson-crusoe", title: t("robinson crusoe", "swiss family robinson"), n: 2, moves: ["treasure"], lines: ["one island, one castaway, one very good parrot.", "day one: build shelter. day two: make a list."] },
  { id: "jungle-book", title: t("jungle book"), moves: ["wildcrown"], lines: ["raised by wolves. good manners, considering.", "the tiger and i are not on speaking terms."] },
  { id: "pooh", title: t("winnie the pooh", "house at pooh corner"), moves: ["picnic"], lines: ["a bear, a honey pot, a thoughtful spot.", "it's eleven o'clock somewhere. snack time."] },
  { id: "wind-in-the-willows", title: t("wind in the willows"), moves: ["picnic"], lines: ["a riverbank, a picnic basket, a toad with a new hobby.", "a motor car goes by. toad's eyes go wide."] },
  { id: "paddington", title: t("paddington"), moves: ["picnic"], lines: ["a very polite bear. a very sticky sandwich.", "i keep a sandwich under my leaf. for emergencies."] },
  { id: "peter-rabbit", title: t("peter rabbit"), author: by("beatrix potter"), moves: ["picnic"], lines: ["into the garden for one radish. just one.", "the blue jacket has seen things."] },
  { id: "seuss", title: t("cat in the hat", "green eggs and ham"), author: by("dr seuss"), n: 2, moves: ["laugh", "catvisit"], lines: ["i do not rhyme. i do not chime. …oh no.", "a hat, a cat, and no grown-ups home."] },
  { id: "pippi", title: t("pippi longstocking", "pippi"), moves: ["press"], lines: ["strongest girl in the world. no notes.", "a horse on the porch, a monkey on her shoulder."] },
  { id: "little-house", title: t("little house on the prairie", "little house in the big woods"), moves: ["picnic"], lines: ["a cabin, a wagon, a very long winter.", "pa's fiddle and a very small cabin."] },
  { id: "tom-sawyer", title: t("tom sawyer", "huckleberry finn"), n: 2, moves: ["laugh"], lines: ["paint the fence? what a treat. after you.", "a raft, a river, no shoes."] },
  { id: "bedtime-books", title: t("goodnight moon", "guess how much i love you"), n: 2, moves: ["bedtime"], lines: ["goodnight, book. goodnight, bookmark.", "goodnight, leaf."] },
  { id: "calvin-and-hobbes", title: t("calvin and hobbes"), moves: ["catvisit"], lines: ["a boy and his tiger. the tiger is definitely real.", "a cardboard box can be anything. scientific fact."] },

  // ------------------------------------------- science fiction and modern
  {
    id: "dune",
    title: any(only("dune"), t("dune messiah", "children of dune", "god emperor of dune", "heretics of dune", "chapterhouse dune")),
    titleBy: [t("dune"), by("herbert")],
    moves: ["sandworm"],
    lines: ["no rhythm at all. perfect for sand.", "sand, sand, worm. keep reading."]
  },
  { id: "hitchhiker", title: t("hitchhikers guide", "restaurant at the end of the universe", "life the universe and everything", "so long and thanks", "mostly harmless"), moves: ["towel42"], lines: ["stay calm. bring a towel.", "the answer is 42. the question is lunch."] },
  { id: "martian", title: only("martian"), moves: ["potatoes"], lines: ["potatoes: planted. mars: pending.", "sol one: count the potatoes. sol two: count again."] },
  { id: "hail-mary", title: t("project hail mary"), moves: ["rockfriend"], lines: ["fist bump, rock buddy.", "best space friend. no contest."] },
  { id: "enders-game", title: t("enders game", "speaker for the dead", "enders shadow"), moves: ["zerog"], lines: ["the enemy's gate is… that way?", "battle school. the homework floats."] },
  { id: "jurassic-park", title: t("jurassic park"), titleBy: [only("lost world"), by("crichton", "conan doyle")], moves: ["trexripple"], lines: ["the water's rippling. that's fine. that's fine.", "the fences are electric. were electric."] },
  { id: "jaws", title: only("jaws"), moves: ["sharkfin"], lines: ["that fin's getting closer. feet up.", "nobody's going in the water. i'm not, anyway."] },
  { id: "life-of-pi", title: t("life of pi"), moves: ["tigerboat"], lines: ["good kitty. big kitty. good big kitty.", "227 days at sea. we take turns with the boat."] },
  { id: "kite-runner", title: t("kite runner"), moves: ["kite"], lines: ["the kite's winning. hold on!", "two boys, one kite, one city."] },
  { id: "splendid-suns", title: t("thousand splendid suns"), moves: ["read"], lines: ["two women, one city, a great deal of courage.", "reading this one with both hands."] },
  {
    id: "foundation",
    title: t("foundation trilogy", "foundation and empire", "second foundation", "foundations edge", "prelude to foundation"),
    titleBy: [only("foundation"), by("asimov")],
    moves: ["starship", "idea"],
    lines: ["maths that predicts the future. i predict a nap.", "an empire is falling. slowly. with footnotes."]
  },
  { id: "asimov-robots", title: t("i robot", "caves of steel", "naked sun", "robots of dawn"), author: by("isaac asimov", "asimov"), moves: ["robot"], lines: ["three laws. i'd add a fourth: be nice to leaves.", "beep. boop. just getting into character."] },
  { id: "three-body", title: t("three body problem", "deaths end", "remembrance of earths past"), titleBy: [only("dark forest"), by("liu")], moves: ["nervous", "starship"], lines: ["the physics is misbehaving. so is the sky.", "three suns. no forecast. good luck."] },
  { id: "neuromancer", title: t("neuromancer", "count zero", "mona lisa overdrive"), moves: ["robot"], lines: ["neon, rain, and too many cables.", "the sky is the wrong colour. everyone's fine with it."] },
  { id: "snow-crash", title: t("snow crash"), moves: ["speeddash"], lines: ["pizza delivery, but with swords.", "thirty minutes or less. no pressure."] },
  { id: "ready-player-one", title: t("ready player one", "ready player two"), moves: ["countdown"], lines: ["an easter egg hunt. the prize is everything.", "insert coin. press start."] },
  {
    id: "expanse",
    title: t("the expanse", "leviathan wakes", "calibans war", "abaddons gate", "cibola burn", "nemesis games", "babylons ashes", "persepolis rising", "tiamats wrath", "leviathan falls"),
    author: by("james sa corey"),
    moves: ["starship", "zerog"],
    lines: ["the coffee on this ship is very important.", "space is big and nobody's getting along."]
  },
  { id: "red-rising", title: t("red rising", "golden son", "iron gold", "light bringer"), author: by("pierce brown"), moves: ["choosing", "starship"], lines: ["a colour for everyone. i'm green. obviously.", "mars, but with a class system. rude."] },
  {
    id: "murderbot",
    title: t("murderbot", "all systems red", "artificial condition", "rogue protocol", "exit strategy", "network effect", "fugitive telemetry", "system collapse"),
    moves: ["robot"],
    lines: ["it just wants to watch its shows. relatable.", "security unit. social anxiety. favourite."]
  },
  { id: "station-eleven", title: t("station eleven"), moves: ["skull"], lines: ["shakespeare after the end of the world. the show goes on.", "a travelling orchestra and a comic book."] },
  { id: "klara", title: t("klara and the sun"), moves: ["sunbathe"], lines: ["she's fond of the sun. we have that in common.", "she watches everything from the shop window."] },
  { id: "never-let-me-go", title: t("never let me go"), moves: ["schoolday"], lines: ["a quiet school in the countryside. something's unsaid.", "old cassette tapes and long walks."] },
  { id: "ishiguro", title: t("remains of the day"), author: by("kazuo ishiguro", "ishiguro"), moves: ["tea"], lines: ["a butler, a long drive, things left unsaid.", "very polite. very sad. very good."] },
  { id: "vonnegut", title: t("slaughterhouse five", "cats cradle", "breakfast of champions", "sirens of titan"), author: by("kurt vonnegut", "vonnegut"), n: 4, moves: ["timemachine"], lines: ["unstuck in time. i know the feeling. mondays.", "funny, and then not, and then funny again."] },
  { id: "algernon", title: t("flowers for algernon"), moves: ["idea"], lines: ["i'm rooting for the mouse. and for charlie.", "written as progress reports. mind the spelling."] },
  { id: "androids", title: t("do androids dream", "blade runner"), moves: ["robot"], lines: ["i dream of electric leaves, mostly.", "an electric sheep on the roof. keeping up appearances."] },
  { id: "space-odyssey", title: t("space odyssey"), moves: ["zerog", "bigeye"], lines: ["the computer is very calm. too calm.", "a black slab and a great many questions."] },
  { id: "children-of-time", title: t("children of time", "children of ruin"), moves: ["spiderweb"], lines: ["the spiders are doing very well for themselves.", "eight legs, big plans."] },
  { id: "wayfarers", title: t("long way to a small angry planet", "closed and common orbit", "psalm for the wild built"), author: by("becky chambers"), moves: ["starship", "tea"], lines: ["a ship full of people being kind. more of this.", "the crew bickers over breakfast. home."] },
  { id: "space-operas", title: t("hyperion", "old mans war", "starship troopers", "illuminae", "ancillary justice", "skyward"), n: 6, moves: ["starship"], lines: ["space. so much of it. i brought a book.", "strap in. the stars are about to go stripy."] },
  { id: "dark-tower", title: t("dark tower"), titleBy: [t("gunslinger", "drawing of the three", "waste lands", "wizard and glass"), by("king")], moves: ["speeddash"], lines: ["a long walk to a tall tower.", "a long road, a tall tower, no shortcuts."] },

  // ------------------------------------------- self-help and non-fiction
  { id: "alchemist", title: only("alchemist"), author: by("paulo coelho", "coelho"), moves: ["treasure"], lines: ["follow the omens. mine all point to the fridge.", "a shepherd, a dream, a long walk across the sand."] },
  { id: "sapiens", title: t("sapiens", "homo deus", "21 lessons for the 21st century"), author: by("yuval noah harari", "harari"), n: 3, moves: ["idea"], lines: ["seventy thousand years in one book. i skimmed nothing.", "apparently wheat tricked us. i always suspected plants."] },
  { id: "atomic-habits", title: t("atomic habits"), moves: ["checklist", "coinjar"], lines: ["one percent better. today's percent: this chapter.", "tiny habits. i'm tiny. it suits me."] },
  { id: "subtle-art", title: t("subtle art of not giving"), moves: ["sunbathe"], lines: ["caring about less. starting with this bookmark.", "a short list of things worth minding. i'm on it."] },
  { id: "rich-dad", title: t("rich dad poor dad", "rich dads"), moves: ["coinjar"], lines: ["two dads, two lessons. i have a jar of seeds.", "assets, liabilities. my leaf is an asset."] },
  { id: "think-and-grow-rich", title: t("think and grow rich"), moves: ["coinjar", "idea"], lines: ["thinking: done. growing: daily. rich: pending.", "step one: want it. step two: write it down."] },
  { id: "psychology-of-money", title: t("psychology of money"), moves: ["coinjar"], lines: ["money is mostly feelings. i have many. feelings.", "enough is a number. mine is one sandwich."] },
  {
    id: "money-books",
    title: t("intelligent investor", "richest man in babylon", "i will teach you to be rich", "zero to one", "lean startup", "shoe dog", "millionaire next door", "total money makeover"),
    n: 8,
    moves: ["coinjar", "idea"],
    lines: ["noted: save early, be patient, snack often.", "the jar fills one seed at a time."]
  },
  { id: "ikigai", title: t("ikigai"), moves: ["tea", "tree"], lines: ["a reason to get up in the morning. mine's breakfast.", "slow down. sip tea. live long. understood."] },
  { id: "seven-habits", title: t("7 habits", "seven habits"), moves: ["checklist"], lines: ["seven habits. i have two. reading and napping.", "seven of them. i'm working on number one."] },
  { id: "win-friends", title: t("how to win friends"), moves: ["welcome"], lines: ["step one: smile. step two: remember names. hello, you.", "i asked the bookmark about its day. it's working."] },
  { id: "calm-books", title: t("power of now", "monk who sold his ferrari", "four agreements", "courage to be disliked", "daily stoic", "untethered soul"), n: 6, moves: ["tree"], lines: ["breathing in. breathing out. turning the page.", "sold the car, kept the calm."] },
  { id: "meditations", titleBy: [only("meditations"), by("marcus aurelius", "aurelius")], moves: ["tree"], lines: ["an emperor's notes to self. good notes.", "written in a tent, between battles. tidy mind."] },
  { id: "deep-work", title: t("deep work", "digital minimalism", "indistractable", "stolen focus"), n: 4, moves: ["lockin"], lines: ["phone away. door shut. book open.", "ninety quiet minutes. starting… now."] },
  { id: "five-am-club", title: t("5 am club", "miracle morning"), n: 2, moves: ["yawn", "alarm"], lines: ["five a.m.? in the morning? on purpose?", "the birds aren't even up. the birds have sense."] },
  { id: "fast-and-slow", title: t("thinking fast and slow"), moves: ["idea"], lines: ["my fast brain says snack. my slow brain agrees.", "i was sure. then i thought about it."] },
  { id: "subconscious-mind", title: t("power of your subconscious mind", "power of positive thinking", "you can win", "magic of thinking big"), n: 4, moves: ["idea", "bringit"], lines: ["thinking good thoughts. about lunch, mostly.", "i can do it. i said so. that's how it works."] },
  { id: "laws-of-power", title: t("48 laws of power", "laws of human nature", "art of seduction"), author: by("robert greene"), n: 3, moves: ["mask"], lines: ["forty-eight laws. i'm on law one: read the book.", "everyone at court is smiling. watch the hands."] },
  { id: "art-of-war", title: t("art of war"), moves: ["bringit"], lines: ["know yourself, know the terrain. i know the shelf.", "the best battle is the one you nap through."] },
  { id: "gladwell", title: t("outliers", "tipping point", "david and goliath", "talking to strangers"), author: by("malcolm gladwell", "gladwell"), n: 4, moves: ["idea"], lines: ["ten thousand hours. i'm at four. hours, not thousand.", "it turns out the small thing was the big thing."] },
  { id: "tidying-up", title: t("life changing magic of tidying", "goodbye things"), n: 2, moves: ["checklist"], lines: ["everything in its place. my place is on this book.", "thank you, old bookmark. off you go."] },
  { id: "eat-that-frog", title: t("eat that frog", "getting things done", "essentialism", "make your bed", "do epic shit"), n: 5, moves: ["checklist"], lines: ["the frog is the hardest task. the frog is not lunch.", "one thing at a time. this thing: a chapter."] },
  { id: "who-moved-my-cheese", title: t("who moved my cheese"), moves: ["hedgemaze"], lines: ["the cheese moved. so i moved. simple.", "new cheese is out there. shoes on."] },
  { id: "cant-hurt-me", title: t("cant hurt me", "never finished"), n: 2, moves: ["bringit", "jog"], lines: ["one more page. then one more. i'm very tough.", "tired is a feeling. the page is still there."] },
  { id: "tuesdays-with-morrie", title: t("tuesdays with morrie", "last lecture", "when breath becomes air"), n: 3, moves: ["tea"], lines: ["reading this one slowly. it deserves it.", "an old teacher and a last class."] },
  { id: "educated", titleBy: [only("educated"), by("westover")], moves: ["read"], lines: ["she fought for every book. i'm holding mine tighter.", "a mountain, a junkyard, a library card."] },
  { id: "becoming", titleBy: [only("becoming"), by("obama")], moves: ["read", "kudos"], lines: ["a life, told plainly and well.", "the south side of chicago, and everything after."] },
  { id: "anne-frank", title: t("diary of a young girl", "diary of anne frank", "anne frank"), moves: ["read"], lines: ["reading this one quietly.", "a diary that outlasted everything. i'm listening."] },
  { id: "search-for-meaning", title: t("mans search for meaning"), moves: ["read"], lines: ["a hard book that leaves you steadier.", "short, heavy, and worth every page."] },
  { id: "malala", title: t("i am malala"), moves: ["schoolday"], lines: ["she wanted to go to school. so she changed things.", "she kept going to class. that's the whole brave thing."] },
  { id: "long-walk", title: t("long walk to freedom", "experiments with truth", "discovery of india"), n: 3, moves: ["read"], lines: ["plain words, a big life.", "a long road, walked on purpose."] },
  { id: "born-a-crime", title: t("born a crime"), moves: ["laugh"], lines: ["funny, sharp, and his mum is the hero.", "six languages and a very fast pair of legs."] },
  { id: "isaacson", titleBy: [only("steve jobs", "elon musk", "einstein", "leonardo da vinci"), by("isaacson")], n: 4, moves: ["idea"], lines: ["a big idea and a bigger temper. taking notes.", "brilliant, difficult, never dull."] },
  {
    // Told from the dragon series of the same name by its author (the series is up with the dragons).
    id: "kalam",
    title: t("wings of fire: an autobiography", "wings of fire an autobiography", "ignited minds", "india 2020"),
    titleBy: [t("wings of fire", "turning points", "my journey"), by("kalam")],
    author: by("abdul kalam", "apj abdul kalam"),
    n: 3,
    moves: ["blastoff"],
    lines: ["from a small town to the launch pad. go on, sir.", "rockets, hard work, and a great deal of heart."]
  },
  {
    id: "hawking",
    title: t("brief history of time", "universe in a nutshell", "brief answers to the big questions", "astrophysics for people in a hurry", "short history of nearly everything"),
    titleBy: [only("cosmos"), by("sagan")],
    author: by("stephen hawking", "hawking"),
    n: 5,
    moves: ["zerog", "idea"],
    lines: ["black holes, explained to a leaf. i nearly got it.", "the universe is very big. i'm starting with a page."]
  },
  { id: "feynman", title: t("surely youre joking"), moves: ["laugh", "idea"], lines: ["a physicist who picks locks for fun. my kind of scientist.", "bongo drums and safe-cracking. physics too."] },

  // ---------------------------------------------------- read across India
  {
    id: "chetan-bhagat",
    title: t("five point someone", "2 states", "two states", "half girlfriend", "3 mistakes of my life", "three mistakes of my life", "one night (?:@|at) the call cent(?:er|re)", "revolution 2020", "one indian girl", "girl in room 105", "400 days"),
    author: by("chetan bhagat"),
    n: 10,
    moves: ["schoolday", "coffeecups"],
    lines: ["college, exams, love, chaos. in that order.", "the grades are low. the spirits are high.", "hostel maggi at midnight. now i'm hungry."]
  },
  {
    id: "desi-romance",
    title: t("i too had a love story", "life is what you make it", "everyone has a story"),
    author: by("durjoy datta", "ravinder singh", "preeti shenoy", "savi sharma", "nikita singh", "sudeep nagarkar"),
    n: 6,
    moves: ["coffeecups", "umbrella", "heartbeat"],
    lines: ["a love story from just down the road.", "chai, rain, feelings. the full set."]
  },
  {
    id: "meluha",
    title: t("immortals of meluha", "secret of the nagas", "oath of the vayuputras", "shiva trilogy", "scion of ikshvaku", "ram chandra series"),
    author: by("amish tripathi", "amish"),
    n: 2,
    moves: ["speeddash", "read"],
    lines: ["an old legend, told like a thriller.", "a mountain chief walks into an empire.", "tidy streets, big secrets."]
  },
  { id: "sanghi", title: t("chanakyas chant", "krishna key", "rozabal line"), author: by("ashwin sanghi"), n: 3, moves: ["sleuth", "heist"], lines: ["ancient secrets, modern chases.", "a symbol, a secret, a chase across the map."] },
  { id: "palace-of-illusions", title: t("palace of illusions", "forest of enchantments", "mistress of spices"), author: by("divakaruni"), n: 3, moves: ["mask", "thorncrown"], lines: ["an old epic, told by the one who lived it.", "a palace where nothing is quite what it seems."] },
  { id: "white-tiger", titleBy: [only("white tiger"), by("adiga")], moves: ["twist"], lines: ["a driver, a plan, a very sharp tongue.", "from the back seat to the front. don't ask how."] },
  { id: "small-things", title: t("god of small things"), moves: ["read"], lines: ["kerala, pickles, a river. small things, big ache.", "twins, a river, a summer that changed things."] },
  { id: "midnights-children", title: t("midnights children"), moves: ["alarm"], lines: ["born on the stroke of midnight. punctual.", "a nose that knows things. a whole country in it."] },
  { id: "train-to-pakistan", title: t("train to pakistan"), moves: ["read"], lines: ["a village, a railway line, a hard summer. reading quietly.", "the trains kept time, until they didn't."] },
  {
    id: "narayan",
    title: t("malgudi", "swami and friends", "bachelor of arts", "man eater of malgudi"),
    titleBy: [only("guide"), by("narayan")],
    author: by("rk narayan"),
    n: 3,
    moves: ["schoolday", "picnic"],
    lines: ["a small town that's on no map. i've been.", "swami has a plan. the plan involves no homework."]
  },
  { id: "ruskin-bond", title: t("blue umbrella", "room on the roof"), author: by("ruskin bond"), n: 2, moves: ["picnic", "catvisit"], lines: ["the hills, the rain, a quiet story. perfect.", "a small town in the mountains. i'd move there."] },
  { id: "sudha-murty", title: t("wise and otherwise", "grandmas bag of stories", "how i taught my grandmother to read"), author: by("sudha murty", "sudha murthy"), n: 3, moves: ["tea", "picnic"], lines: ["a grandmother's story. sit down, it's a good one.", "simple words. they stay."] },
  { id: "lahiri", title: t("the namesake", "interpreter of maladies"), author: by("jhumpa lahiri"), n: 2, moves: ["tea"], lines: ["names, trains, two homes at once.", "a suitcase of spices and a very cold winter."] },
  { id: "tagore", title: t("gitanjali", "kabuliwala", "gora"), author: by("rabindranath tagore", "tagore"), n: 2, moves: ["songbird"], lines: ["songs, mostly. even the prose.", "a songbook that won a nobel. hum along."] },
  { id: "old-fables", title: t("panchatantra", "akbar and birbal", "akbar birbal", "tenali raman", "tinkle", "amar chitra katha", "vikram and betal", "aesops fables"), n: 6, moves: ["idea", "picnic"], lines: ["an old story with a clever answer. my favourite kind.", "the crow, the fox, the lesson. never trust the fox."] },

  // ------------------------------------------------------ manga and comics
  { id: "one-piece", title: t("one piece"), moves: ["strawhat"], lines: ["the hat stays on. that's the rule.", "a thousand chapters. i packed snacks for the voyage."] },
  { id: "naruto", title: t("naruto", "boruto"), moves: ["speeddash"], lines: ["running with my arms back. it's faster. probably.", "a village hidden in the leaves. i'm a local."] },
  { id: "attack-on-titan", title: t("attack on titan", "shingeki no kyojin"), moves: ["jumpscare", "speeddash"], lines: ["that wall is big. whatever's behind it is bigger.", "i'd like to stay inside the walls, thank you."] },
  { id: "demon-slayer", title: t("demon slayer", "kimetsu no yaiba"), moves: ["speeddash"], lines: ["breathe in. breathe out. swing.", "a box on his back, and someone precious in it."] },
  { id: "death-note", title: t("death note"), moves: ["nervous"], lines: ["a notebook i will not be writing in.", "do not lend that notebook to anyone."] },
  { id: "hero-academia", title: t("my hero academia", "boku no hero academia"), moves: ["speeddash", "schoolday"], lines: ["a school for heroes. homework: saving people.", "everyone has a quirk. mine is the leaf."] },
  { id: "jujutsu-kaisen", title: t("jujutsu kaisen"), moves: ["speeddash", "jumpscare"], lines: ["curses everywhere. keep your hands to yourself.", "do not eat the finger. simple rule."] },
  { id: "solo-leveling", title: t("solo leveling", "only i level up"), moves: ["levelup"], lines: ["level up. level up again. and again.", "the weakest hunter. give it a chapter."] },
  { id: "spy-family", title: t("spy x family", "spy family"), moves: ["mask", "picnic"], lines: ["a spy, an assassin, a little telepath. nice family.", "everyone's keeping a secret. dinner's at six."] },
  { id: "dragon-ball", title: t("dragon ball"), moves: ["speeddash", "bringit"], lines: ["powering up. this may take three chapters.", "seven of them and you get a wish. i'd wish for eight."] },
  { id: "one-punch-man", title: t("one punch man"), moves: ["boxing"], lines: ["one punch. that's the whole fight.", "bald, bored, unbeatable. off to the supermarket sale."] },
  { id: "fullmetal", title: t("fullmetal alchemist"), moves: ["potion"], lines: ["a fair trade: one chapter for one snack.", "two brothers, one suit of armour, a long road."] },
  { id: "haikyu", title: t("haikyu", "haikyuu", "slam dunk", "blue lock", "kurokos basketball"), n: 4, moves: ["bringit"], lines: ["the ball must not touch the floor. nor must my leaf.", "the short one can fly. i believe it."] },
  { id: "chainsaw-man", title: t("chainsaw man", "tokyo ghoul"), n: 2, moves: ["jumpscare"], lines: ["a rough one. i'm reading from behind the bookmark.", "he wants toast with jam. relatable."] },
  { id: "hunter-x-hunter", title: t("hunter x hunter", "bleach vol", "bleach volume", "fairy tail", "black clover"), n: 4, moves: ["speeddash"], lines: ["a new power every chapter. i'm still on leaf.", "the exam alone takes a year. worth it."] },
  { id: "doraemon", title: t("doraemon"), moves: ["magic"], lines: ["a pocket with everything in it. i want one.", "a robot cat from the future. he's scared of mice."] },
  { id: "detective-conan", title: t("detective conan"), moves: ["sleuth"], lines: ["a very small detective. i feel seen.", "a bow tie, big glasses, a case every week."] },
  { id: "frieren", title: t("frieren"), moves: ["magic", "picnic"], lines: ["an elf with all the time in the world. no rush.", "ten years is a blink. she's learning."] },
  { id: "apothecary-diaries", title: t("apothecary diaries"), moves: ["potion", "sleuth"], lines: ["she'd rather taste the poison. for science.", "freckles, herbs, and a nose for trouble."] },
  { id: "slime", title: t("reincarnated as a slime"), moves: ["melt"], lines: ["a small round hero. i relate.", "eat it, learn it. simple system."] },
  { id: "omniscient-reader", title: t("omniscient reader", "omniscient readers viewpoint"), moves: ["read"], lines: ["a reader who already knows the story. living the dream.", "he read the whole thing. the only one who did."] },
  { id: "sword-art-online", title: t("sword art online", "beginning after the end", "tower of god", "mushoku tensei", "re:zero", "rezero"), n: 5, moves: ["levelup", "speeddash"], lines: ["a whole new world, and it has a stat sheet.", "log in. level up. don't log out."] },
  { id: "sailor-moon", title: t("sailor moon", "cardcaptor sakura"), n: 2, moves: ["magic"], lines: ["a transformation! it takes a while. worth it.", "a tiara, a wand, a talking cat. standard kit."] },
  { id: "lore-olympus", title: t("lore olympus"), moves: ["heartbeat"], lines: ["the gods are on their phones. it's going badly. sweetly.", "pink, blue, and extremely awkward."] },
  { id: "tintin", title: t("tintin"), moves: ["blastoff", "speeddash"], lines: ["a reporter, a dog, a captain with a vocabulary.", "blistering— no, that's his line."] },
  { id: "asterix", title: t("asterix"), moves: ["potion"], lines: ["one sip of potion and the romans are in trouble.", "a tiny village, a big empire, no contest."] },
  { id: "garfield", title: t("garfield"), moves: ["catvisit"], lines: ["mondays. we don't speak of mondays.", "lasagne. the answer is lasagne."] },
  { id: "sandman", titleBy: [t("sandman"), by("gaiman")], moves: ["floatnap"], lines: ["the lord of dreams. i'll be napping. for research.", "seven siblings, all of them trouble."] },
  { id: "gaiman", title: t("ocean at the end of the lane"), author: by("neil gaiman"), moves: ["magic", "torchdark"], lines: ["something old and odd is just out of sight.", "a story that feels like it was always there."] }
];

// ------------------------------------------------------------ by its genre

/** A kind of book she has a generic scene for. Wider than the house's moods (./genre.ts), read the same way. */
export type NodGenre = "comics" | "horror" | "mystery" | "fantasy" | "scifi" | "romance" | "thriller" | "poetry" | "humour" | "biography" | "selfhelp" | "historical" | "children" | "ya";

/** In the order they win when one genre string says two things ("Romantic comedy" is the romance). */
const GENRE_SAYS: ReadonlyArray<[NodGenre, RegExp]> = [
  ["comics", /\bmanga\b|\bmanhwa\b|\bmanhua\b|\bcomics?\b|\bgraphic novel|\blight novel|\bwebtoon/],
  ["horror", /\bhorror|\bgothic|\bghost|\bhaunt|\bvampir|\bzombie|\boccult|\bmacabre/],
  ["mystery", /\bmyster|\bdetective|\bcrime\b|\bwhodun|\bnoir\b|\bsleuth/],
  ["fantasy", /\bfantas|\bfairy ?tale|\bsword|\bsorcer|\bdragon|\bwizard/],
  ["scifi", /\bscience[ -]fiction|\bsci[ -]?fi\b|\bspace opera|\bcyberpunk|\bdystopi|\btime travel/],
  ["romance", /\bromance\b|\blove stor|\bromantic|\bchick[ -]?lit|\brom[ -]?com/],
  ["thriller", /\bthrill|\bsuspense|\bespionage|\bspy\b|\bspies\b/],
  ["poetry", /\bpoetry|\bpoems?\b|\bverse\b/],
  ["humour", /\bhumou?r|\bcomedy|\bcomic (fiction|novel)|\bsatire/],
  ["biography", /\bbiograph|\bautobiograph|\bmemoir/],
  ["selfhelp", /\bself[ -]?help|\bself[ -]improvement|\bpersonal (development|growth|finance)|\bproductivity|\bbusiness|\bmotivation/],
  ["historical", /\bhistorical|\bhistory\b|\bregency|\bvictorian/]
];
/** Who a book is for says less than what it is: these speak only when nothing above does. */
const GENRE_HINTS: ReadonlyArray<[NodGenre, RegExp]> = [
  ["children", /\bchildren|\bjuvenile|\bpicture books?\b|\bmiddle[ -]grade|\bkids\b/],
  ["ya", /\byoung[ -]adult|\bya\b|\bteen/]
];

const firstSaid = (genres: readonly string[], table: ReadonlyArray<[NodGenre, RegExp]>): NodGenre | null => {
  // The genre listed first speaks first, as it does for the house's moods.
  for (const genre of genres) {
    const text = genre.toLowerCase();
    for (const [kind, pattern] of table) if (pattern.test(text)) return kind;
  }
  return null;
};

/** The kind of book its free-form genres make it, or null for one that is none of these. */
export const nodGenre = (genres: readonly unknown[] | null | undefined): NodGenre | null => {
  const named = (genres ?? []).filter((genre): genre is string => typeof genre === "string" && genre.trim().length > 0);
  return firstSaid(named, GENRE_SAYS) ?? firstSaid(named, GENRE_HINTS);
};

/**
 * What a book she has never heard of still gets, from its genre alone. The
 * lines are about the kind of book, never about this one: she does not
 * pretend to know it.
 */
export const GENRE_NODS: Readonly<Record<NodGenre, { moves: string[]; lines: string[] }>> = {
  romance: { moves: ["loveletter", "heartbeat", "umbrella", "coffeecups"], lines: ["a love story. i'm invested.", "will they? won't they? i can't look.", "somebody's about to fall for somebody. i can tell."] },
  mystery: { moves: ["sleuth", "missingposter"], lines: ["a mystery. i suspect everyone.", "clues! i'm taking notes.", "i have a theory. it changes every chapter."] },
  thriller: { moves: ["torchdark", "nervous"], lines: ["a thriller. i'm reading with one eye shut.", "don't go in there. …they're going in there.", "my leaf is on edge."] },
  horror: { moves: ["jumpscare", "ghost"], lines: ["a scary one. i'll be behind the bookmark.", "what was that noise? …it was me.", "lights on. all of them."] },
  fantasy: { moves: ["magic", "dragonchase"], lines: ["a quest! i packed snacks.", "there's a map at the front. always a good sign.", "magic's afoot. so am i."] },
  scifi: { moves: ["starship", "zerog"], lines: ["space. so much of it.", "the future! it has gadgets.", "strap in. i've found the big red button."] },
  historical: { moves: ["curtsy"], lines: ["the past. everyone has better hats.", "candles, carriages, long letters. lovely."] },
  humour: { moves: ["laugh"], lines: ["a funny one. i snorted. twice.", "i'm not laughing. my leaf is."] },
  poetry: { moves: ["songbird", "smitten"], lines: ["poems. short lines, big feelings.", "reading this one out loud. quietly."] },
  biography: { moves: ["read", "idea"], lines: ["a real life. the footnotes are true.", "somebody lived all this. i'm impressed."] },
  selfhelp: { moves: ["checklist", "idea"], lines: ["taking notes. i'll be a better leaf by friday.", "step one: read the book. doing it."] },
  ya: { moves: ["schoolday", "choosing"], lines: ["big feelings. bigger choices.", "everyone's sixteen and everything matters."] },
  children: { moves: ["picnic"], lines: ["a gentle one. my favourite kind.", "this one's best read aloud."] },
  comics: { moves: ["speeddash", "bringit"], lines: ["panels! pictures! pow!", "reading this one fast. it's the speed lines."] }
};

// ------------------------------------------------------------------ choosing

const pick = <T,>(items: readonly T[], seed: number) => items[Math.abs(seed) % items.length];

type NodBook = { title?: string | null; author?: string | null; genres?: readonly unknown[] | null };

const titled = (entry: BookNod, title: string, author: string) =>
  Boolean(entry.title?.test(title)) || Boolean(entry.titleBy && author && entry.titleBy[0].test(title) && entry.titleBy[1].test(author));

/** The diary asks about the same few books for every day it writes. */
const found = new Map<string, BookNod | null>();

/** The entry that claims a book: by its title first, then by its writer. */
export const nodEntryFor = (book: NodBook): BookNod | null => {
  const key = `${book.title ?? ""}\u0000${book.author ?? ""}`;
  const known = found.get(key);
  if (known !== undefined) {
    return known;
  }
  const title = plainTitle(book.title);
  const author = plainAuthor(book.author);
  const entry =
    (title ? NODS.find((nod) => titled(nod, title, author)) : undefined) ??
    (author ? NODS.find((nod) => nod.author?.test(author)) : undefined) ??
    null;
  if (found.size > 400) {
    found.clear();
  }
  found.set(key, entry);
  return entry;
};

export type Nod = {
  move: string;
  line: string;
  /** True for a book she knows; false for a scene that only its genre earned. */
  known: boolean;
};

/**
 * Pip's nod for a book, or null when she has nothing for it. A book the table
 * knows always gets its own; one it does not gets its genre's, when the caller
 * passes `genres` (the diary does not: it only quotes her on books she knows).
 */
export const nodFor = (book: NodBook, seed = Date.now()): Nod | null => {
  const entry = nodEntryFor(book);
  const genre = entry ? null : nodGenre(book.genres);
  const nod = entry ?? (genre ? GENRE_NODS[genre] : null);
  if (!nod) {
    return null;
  }
  return { move: pick(nod.moves, seed), line: pick(nod.lines, Math.floor(seed / 7)), known: Boolean(entry) };
};

/**
 * How often a nod plays. A book she knows: always the first time it is
 * opened, then about one open in four, and now and then in her idle time
 * while it is the book being read. A genre's scene is rarer on every count,
 * so it stays a small surprise and the real ones stay the treat.
 */
export const NOD_ODDS = {
  known: { first: 1, again: 0.25, idle: 0.12 },
  genre: { first: 0.5, again: 0.1, idle: 0.05 }
} as const;

/** The odds that apply to a nod. */
export const nodOdds = (nod: Pick<Nod, "known">) => NOD_ODDS[nod.known ? "known" : "genre"];

/** How many books and series Pip has a scene for (an entry may stand for several). */
export const NOD_COUNT = NODS.reduce((sum, nod) => sum + (nod.n ?? 1), 0);
