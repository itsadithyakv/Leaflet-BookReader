import { beforeAll, describe, expect, it } from "vitest";
import { LIB, SKINS, loadBookScenes, renderFrame, resolve } from "./core";
import { GENRE_NODS, NODS, NOD_COUNT, NOD_LINE_MAX, NOD_ODDS, nodEntryFor, nodFor, nodGenre, nodOdds, plainAuthor, plainTitle, type NodGenre } from "./bookNods";
import { genreMood } from "./genre";

const idFor = (title: string, author: string | null = null) => nodEntryFor({ title, author })?.id ?? null;

/** Titles as a library holds them (file metadata, boxed sets, catalogue-style authors) and the entry each must reach. */
const HITS: Array<[title: string, author: string | null, id: string]> = [
  // The books the owner asked for by name.
  ["Shatter Me", "Tahereh Mafi", "shatter-me"],
  ["Shatter Me (Shatter Me, #1)", null, "shatter-me"],
  ["SHATTER ME", "MAFI, TAHEREH", "shatter-me"],
  ["Unravel Me (Shatter Me, #2)", "Tahereh Mafi", "shatter-me"],
  ["Ignite Me", "Tahereh Mafi", "shatter-me"],
  ["Restore Me", "Mafi, Tahereh", "shatter-me"],
  ["Defy Me", "Tahereh Mafi", "shatter-me"],
  ["Imagine Me", "Tahereh Mafi", "shatter-me"],
  ["Shatter Me Series 6-Book Box Set", "Tahereh Mafi", "shatter-me"],
  ["shatter_me", null, "shatter-me"],
  ["The Adventures of Sherlock Holmes", "Arthur Conan Doyle", "sherlock"],
  ["SHERLOCK HOLMES: The Complete Collection", null, "sherlock"],
  ["The Memoirs of Sherlock Holmes", "Doyle, Arthur Conan", "sherlock"],
  ["The Return of Sherlock Holmes", "Sir Arthur Conan Doyle", "sherlock"],
  ["The Case-Book of Sherlock Holmes", "A. Conan Doyle", "sherlock"],
  ["His Last Bow", "Arthur Conan Doyle", "sherlock"],
  ["A Study in Scarlet", null, "sherlock"],
  ["The Sign of the Four", null, "sherlock"],
  ["The Sign of Four", null, "sherlock"],
  ["The Hound of the Baskervilles", "Doyle, Arthur Conan, 1859-1930", "sherlock"],
  ["The Valley of Fear", "Arthur Conan Doyle", "sherlock"],
  ["The Complete Works", "Doyle, Arthur Conan", "sherlock"],
  ["Complete Stories", "Conan Doyle, Arthur", "sherlock"],
  ["A Scandal in Bohemia", null, "sherlock"],
  ["The Complete Stories (Illustrated)", "Arthur Conan Doyle; Sidney Paget", "sherlock"],
  // Fantasy.
  ["A Game of Thrones", "George R. R. Martin", "ice-and-fire"],
  ["A Clash of Kings (A Song of Ice and Fire, #2)", "George R.R. Martin", "ice-and-fire"],
  ["Fire & Blood", "Martin, George R. R.", "ice-and-fire"],
  ["The Hobbit, or There and Back Again", "J.R.R. Tolkien", "hobbit"],
  ["The Fellowship of the Ring", "J. R. R. Tolkien", "lord-of-the-rings"],
  ["The Lord of the Rings: The Two Towers", null, "lord-of-the-rings"],
  ["Harry Potter and the Philosopher’s Stone", "J.K. Rowling", "harry-potter"],
  ["Harry Potter and the Half-Blood Prince", "Rowling, J. K.", "harry-potter"],
  ["Harry Potter: The Complete Collection (1-7)", null, "harry-potter"],
  ["Eragon", "Christopher Paolini", "eragon"],
  ["Eldest", "Christopher Paolini", "eragon"],
  ["Fourth Wing", "Rebecca Yarros", "fourth-wing"],
  ["Iron Flame (The Empyrean, #2)", "Rebecca Yarros", "fourth-wing"],
  ["The Dragonet Prophecy (Wings of Fire, #1)", "Tui T. Sutherland", "wings-of-fire-dragons"],
  ["Wings of Fire", "Tui T. Sutherland", "wings-of-fire-dragons"],
  ["The Lion, the Witch and the Wardrobe", "C. S. Lewis", "narnia"],
  ["The Chronicles of Narnia", "C.S. Lewis", "narnia"],
  ["Alice's Adventures in Wonderland", "Lewis Carroll", "alice"],
  ["Mistborn: The Final Empire", "Brandon Sanderson", "sanderson"],
  ["Tress of the Emerald Sea", "Sanderson, Brandon", "sanderson"],
  ["Yumi and the Nightmare Painter", "Brandon Sanderson", "sanderson"],
  ["Percy Jackson and the Lightning Thief", "Rick Riordan", "percy-jackson"],
  ["The Hunger Games", "Suzanne Collins", "hunger-games"],
  ["Catching Fire", "Suzanne Collins", "hunger-games"],
  ["The Eye of the World", "Robert Jordan", "wheel-of-time"],
  ["The Gathering Storm", "Robert Jordan & Brandon Sanderson", "wheel-of-time"],
  ["The Last Wish", "Andrzej Sapkowski", "witcher"],
  ["The Witcher: Blood of Elves", null, "witcher"],
  ["Good Omens", "Terry Pratchett & Neil Gaiman", "good-omens"],
  ["Guards! Guards!", "Terry Pratchett", "discworld"],
  ["Mort", "Terry Pratchett", "discworld"],
  ["A Wizard of Earthsea", "Ursula K. Le Guin", "earthsea"],
  ["American Gods", "Neil Gaiman", "american-gods"],
  ["Neverwhere", "Neil Gaiman", "neverwhere"],
  ["The Graveyard Book", "Neil Gaiman", "graveyard-book"],
  ["Stardust", "Neil Gaiman", "gaiman"],
  ["The Night Circus", "Erin Morgenstern", "night-circus"],
  ["Howl’s Moving Castle", "Diana Wynne Jones", "howl"],
  ["The Princess Bride", "William Goldman", "princess-bride"],
  ["Rivers of London", "Ben Aaronovitch", "rivers-of-london"],
  ["Northern Lights", "Philip Pullman", "dark-materials"],
  ["The Golden Compass (His Dark Materials, #1)", null, "dark-materials"],
  ["The Bad Beginning", "Lemony Snicket", "unfortunate-events"],
  ["Artemis Fowl", "Eoin Colfer", "artemis-fowl"],
  ["A Court of Thorns and Roses", "Sarah J. Maas", "acotar"],
  ["A Court of Mist and Fury (A Court of Thorns and Roses, #2)", "Sarah J. Maas", "acotar"],
  ["Throne of Glass", "Sarah J. Maas", "throne-of-glass"],
  ["Six of Crows", "Leigh Bardugo", "six-of-crows"],
  ["Shadow and Bone", "Leigh Bardugo", "shadow-and-bone"],
  ["The Cruel Prince (The Folk of the Air, #1)", "Holly Black", "cruel-prince"],
  ["Red Queen", "Victoria Aveyard", "red-queen"],
  ["Caraval", "Stephanie Garber", "caraval"],
  ["An Ember in the Ashes", "Sabaa Tahir", "ember-in-the-ashes"],
  ["City of Bones", "Cassandra Clare", "shadowhunters"],
  ["Divine Rivals", "Rebecca Ross", "divine-rivals"],
  ["Legends & Lattes", "Travis Baldree", "legends-and-lattes"],
  ["The Midnight Library", "Matt Haig", "book-magic"],
  ["Matilda", "Roald Dahl", "matilda"],
  // Young adult.
  ["Divergent", "Veronica Roth", "divergent"],
  ["Divergent (Divergent, #1)", "Roth, Veronica", "divergent"],
  ["The Selection", "Kiera Cass", "selection"],
  ["The Inheritance Games", "Jennifer Lynn Barnes", "inheritance-games"],
  ["Legend", "Marie Lu", "legend"],
  ["Uglies", "Scott Westerfeld", "uglies"],
  ["The Giver", "Lois Lowry", "giver"],
  ["The Maze Runner", "James Dashner", "maze-runner"],
  ["Twilight", "Stephenie Meyer", "twilight"],
  ["New Moon (The Twilight Saga, Book 2)", "Stephenie Meyer", "twilight"],
  ["Eclipse", "Stephenie Meyer", "twilight"],
  ["Dracula", "Bram Stoker", "vampires"],
  ["Heartstopper: Volume One", "Alice Oseman", "heartstopper"],
  ["The Fault in Our Stars", "John Green", "fault-in-our-stars"],
  ["Looking for Alaska", "John Green", "looking-for-alaska"],
  ["The Perks of Being a Wallflower", "Stephen Chbosky", "perks"],
  ["They Both Die at the End", "Adam Silvera", "both-die"],
  ["A Good Girl's Guide to Murder", "Holly Jackson", "good-girls-guide"],
  ["The Summer I Turned Pretty", "Jenny Han", "summer-i-turned-pretty"],
  ["To All the Boys I've Loved Before", "Jenny Han", "to-all-the-boys"],
  ["Holes", "Louis Sachar", "holes"],
  ["Wonder", "R. J. Palacio", "wonder"],
  ["Diary of a Wimpy Kid: Rodrick Rules", "Jeff Kinney", "wimpy-kid"],
  ["Into the Wild (Warriors, #1)", "Erin Hunter", "warrior-cats"],
  ["Goosebumps: Welcome to Dead House", "R. L. Stine", "goosebumps"],
  // Romance.
  ["It Ends with Us", "Colleen Hoover", "it-ends-with-us"],
  ["It Starts with Us: A Novel", "Colleen Hoover", "it-ends-with-us"],
  ["Ugly Love", "Colleen Hoover", "colleen-hoover"],
  ["Verity", "Colleen Hoover", "verity"],
  ["Hopeless", "Hoover, Colleen", "colleen-hoover"],
  ["Beach Read", "Emily Henry", "beach-read"],
  ["Book Lovers", "Emily Henry", "book-lovers"],
  ["People We Meet on Vacation", "Emily Henry", "people-we-meet"],
  ["Happy Place", "Emily Henry", "happy-place"],
  ["Funny Story", "Emily Henry", "emily-henry"],
  ["The Hating Game", "Sally Thorne", "hating-game"],
  ["The Love Hypothesis", "Ali Hazelwood", "love-hypothesis"],
  ["Red, White & Royal Blue", "Casey McQuiston", "red-white-royal-blue"],
  ["The Spanish Love Deception", "Elena Armas", "spanish-love-deception"],
  ["Icebreaker", "Hannah Grace", "icebreaker"],
  ["Twisted Love (Twisted, #1)", "Ana Huang", "twisted"],
  ["The Kiss Quotient", "Helen Hoang", "kiss-quotient"],
  ["Bridgerton: The Duke and I", "Julia Quinn", "bridgerton"],
  ["Outlander", "Diana Gabaldon", "outlander"],
  ["Me Before You", "Jojo Moyes", "me-before-you"],
  ["The Notebook", "Nicholas Sparks", "nicholas-sparks"],
  ["Normal People", "Sally Rooney", "sally-rooney"],
  ["One Day", "David Nicholls", "one-day"],
  ["Bridget Jones's Diary", "Helen Fielding", "bridget-jones"],
  ["Crazy Rich Asians", "Kevin Kwan", "crazy-rich-asians"],
  ["The Seven Husbands of Evelyn Hugo", "Taylor Jenkins Reid", "evelyn-hugo"],
  ["Daisy Jones & The Six", "Taylor Jenkins Reid", "daisy-jones"],
  ["Call Me by Your Name", "André Aciman", "call-me-by-your-name"],
  ["Fifty Shades of Grey", "E L James", "fifty-shades"],
  ["The Rosie Project", "Graeme Simsion", "rosie-project"],
  ["Eleanor Oliphant Is Completely Fine", "Gail Honeyman", "eleanor-oliphant"],
  ["Pride and Prejudice", null, "austen"],
  ["Emma", "Jane Austen", "austen"],
  ["Persuasion (Penguin Classics)", "Austen, Jane", "austen"],
  ["Lady Susan", "Jane Austen", "austen"],
  // Mystery and thriller.
  ["Murder on the Orient Express", "Agatha Christie", "christie"],
  ["4.50 from Paddington", "Agatha Christie", "christie"],
  ["4:50 from Paddington (Miss Marple)", null, "christie"],
  ["The Pale Horse", "Christie, Agatha", "christie"],
  ["Nancy Drew: The Secret of the Old Clock", "Carolyn Keene", "young-sleuths"],
  ["The Hardy Boys: The Tower Treasure", null, "young-sleuths"],
  ["Five on a Treasure Island", "Enid Blyton", "blyton"],
  ["The Secret Seven", "Enid Blyton", "blyton"],
  ["Gone Girl", "Gillian Flynn", "gone-girl"],
  ["The Girl on the Train", "Paula Hawkins", "girl-on-the-train"],
  ["The Girl with the Dragon Tattoo", "Stieg Larsson", "dragon-tattoo"],
  ["The Da Vinci Code", "Dan Brown", "dan-brown"],
  ["Angels & Demons", "Dan Brown", "dan-brown"],
  ["Inferno", "Dan Brown", "dan-brown"],
  ["The Silent Patient", "Alex Michaelides", "silent-patient"],
  ["Big Little Lies", "Liane Moriarty", "big-little-lies"],
  ["The Thursday Murder Club", "Richard Osman", "thursday-murder-club"],
  ["Rebecca", "Daphne du Maurier", "rebecca"],
  ["Killing Floor (Jack Reacher, #1)", "Lee Child", "reacher"],
  ["Casino Royale", "Ian Fleming", "bond"],
  ["In Cold Blood", "Truman Capote", "in-cold-blood"],
  ["If Tomorrow Comes", "Sidney Sheldon", "sheldon"],
  ["Kane and Abel", "Jeffrey Archer", "archer"],
  ["It", "Stephen King", "it"],
  ["It: A Novel", "King, Stephen", "it"],
  ["The Shining", "Stephen King", "the-shining"],
  ["Misery", "Stephen King", "stephen-king"],
  ["The Raven", "Edgar Allan Poe", "poe"],
  // Classics and children's.
  ["Moby-Dick; or, The Whale", "Herman Melville", "moby-dick"],
  ["1984", "George Orwell", "1984"],
  ["Nineteen Eighty-Four", null, "1984"],
  ["Les Misérables", "Victor Hugo", "les-miserables"],
  ["A Suitable Boy", "Vikram Seth", "suitable-boy"],
  ["War and Peace", "Leo Tolstoy", "doorstops"],
  ["Ulysses", "James Joyce", "doorstops"],
  ["Oliver Twist", "Charles Dickens", "dickens"],
  ["Great Expectations", "Charles Dickens", "moors-and-ghosts"],
  ["The Strange Case of Dr. Jekyll and Mr. Hyde", "Robert Louis Stevenson", "jekyll-hyde"],
  ["The Time Machine", "H. G. Wells", "time-machine"],
  ["Treasure Island", "Robert Louis Stevenson", "treasure-island"],
  ["Journey to the Centre of the Earth", "Jules Verne", "centre-of-the-earth"],
  ["Around the World in 80 Days", "Jules Verne", "eighty-days"],
  ["Around the World in Eighty Days", "Jules Verne", "eighty-days"],
  ["The War of the Worlds", "H.G. Wells", "war-of-the-worlds"],
  ["Hamlet", "William Shakespeare", "shakespeare"],
  ["The Catcher in the Rye", "J. D. Salinger", "catcher-in-the-rye"],
  ["Lord of the Flies", "William Golding", "lord-of-the-flies"],
  ["Of Mice and Men", "John Steinbeck", "steinbeck"],
  ["The Grapes of Wrath", "John Steinbeck", "steinbeck"],
  ["One Hundred Years of Solitude", "Gabriel García Márquez", "garcia-marquez"],
  ["Crime and Punishment", "Fyodor Dostoevsky", "dostoevsky"],
  ["The Brothers Karamazov", "Fyodor Dostoevsky", "doorstops"],
  ["The Picture of Dorian Gray", "Oscar Wilde", "dorian-gray"],
  ["The Odyssey", "Homer", "odyssey"],
  ["The Iliad", "Homer", "iliad"],
  ["Little Women", "Louisa May Alcott", "little-women"],
  ["Anne of Green Gables", "L. M. Montgomery", "anne-of-green-gables"],
  ["The Secret Garden", "Frances Hodgson Burnett", "secret-garden"],
  ["Black Beauty", "Anna Sewell", "black-beauty"],
  ["Heidi", "Johanna Spyri", "heidi"],
  ["Robinson Crusoe", "Daniel Defoe", "robinson-crusoe"],
  ["The Jungle Book", "Rudyard Kipling", "jungle-book"],
  ["Winnie-the-Pooh", "A. A. Milne", "pooh"],
  ["The Wind in the Willows", "Kenneth Grahame", "wind-in-the-willows"],
  ["A Bear Called Paddington", "Michael Bond", "paddington"],
  ["The Tale of Peter Rabbit", "Beatrix Potter", "peter-rabbit"],
  // Science fiction and modern.
  ["Dune", "Frank Herbert", "dune"],
  ["Dune (Dune Chronicles, #1)", null, "dune"],
  ["Frank Herbert's Dune Saga Collection", "Frank Herbert", "dune"],
  ["Dune Messiah", null, "dune"],
  ["The Hitchhiker's Guide to the Galaxy", "Douglas Adams", "hitchhiker"],
  ["The Martian", "Andy Weir", "martian"],
  ["The Martian: A Novel", null, "martian"],
  ["Project Hail Mary", "Andy Weir", "hail-mary"],
  ["Jurassic Park", "Michael Crichton", "jurassic-park"],
  ["The Lost World", "Arthur Conan Doyle", "jurassic-park"],
  ["Foundation", "Isaac Asimov", "foundation"],
  ["I, Robot", "Isaac Asimov", "asimov-robots"],
  ["The Three-Body Problem", "Cixin Liu", "three-body"],
  ["Neuromancer", "William Gibson", "neuromancer"],
  ["Ready Player One", "Ernest Cline", "ready-player-one"],
  ["Snow Crash", "Neal Stephenson", "snow-crash"],
  ["Leviathan Wakes (The Expanse, #1)", "James S. A. Corey", "expanse"],
  ["Red Rising", "Pierce Brown", "red-rising"],
  ["All Systems Red (The Murderbot Diaries, #1)", "Martha Wells", "murderbot"],
  ["Station Eleven", "Emily St. John Mandel", "station-eleven"],
  ["Never Let Me Go", "Kazuo Ishiguro", "never-let-me-go"],
  ["Klara and the Sun", "Kazuo Ishiguro", "klara"],
  ["Slaughterhouse-Five", "Kurt Vonnegut", "vonnegut"],
  ["Flowers for Algernon", "Daniel Keyes", "algernon"],
  ["Do Androids Dream of Electric Sheep?", "Philip K. Dick", "androids"],
  // Non-fiction.
  ["The Alchemist", "Paulo Coelho", "alchemist"],
  ["Sapiens: A Brief History of Humankind", "Yuval Noah Harari", "sapiens"],
  ["Atomic Habits: An Easy & Proven Way to Build Good Habits & Break Bad Ones", "James Clear", "atomic-habits"],
  ["The Subtle Art of Not Giving a F*ck", "Mark Manson", "subtle-art"],
  ["Rich Dad Poor Dad", "Robert T. Kiyosaki", "rich-dad"],
  ["Think and Grow Rich", "Napoleon Hill", "think-and-grow-rich"],
  ["Ikigai: The Japanese Secret to a Long and Happy Life", "Héctor García", "ikigai"],
  ["The Psychology of Money", "Morgan Housel", "psychology-of-money"],
  ["Educated", "Tara Westover", "educated"],
  ["Becoming", "Michelle Obama", "becoming"],
  ["The Diary of a Young Girl", "Anne Frank", "anne-frank"],
  ["Man's Search for Meaning", "Viktor E. Frankl", "search-for-meaning"],
  ["Wings of Fire: An Autobiography", null, "kalam"],
  ["Wings of Fire", "A. P. J. Abdul Kalam", "kalam"],
  ["Wings of Fire", "Kalam, A.P.J. Abdul; Tiwari, Arun", "kalam"],
  ["A Brief History of Time", "Stephen Hawking", "hawking"],
  // Read across India.
  ["Five Point Someone", "Chetan Bhagat", "chetan-bhagat"],
  ["2 States: The Story of My Marriage", "Chetan Bhagat", "chetan-bhagat"],
  ["One Night @ the Call Center", null, "chetan-bhagat"],
  ["The Immortals of Meluha (Shiva Trilogy, #1)", "Amish Tripathi", "meluha"],
  ["The Palace of Illusions", "Chitra Banerjee Divakaruni", "palace-of-illusions"],
  ["The White Tiger", "Aravind Adiga", "white-tiger"],
  ["The God of Small Things", "Arundhati Roy", "small-things"],
  ["Midnight's Children", "Salman Rushdie", "midnights-children"],
  ["Malgudi Days", "R. K. Narayan", "narayan"],
  ["The Guide", "R.K. Narayan", "narayan"],
  ["Train to Pakistan", "Khushwant Singh", "train-to-pakistan"],
  // Manga.
  ["One Piece, Vol. 1: Romance Dawn", "Eiichiro Oda", "one-piece"],
  ["Naruto, Vol. 27", "Masashi Kishimoto", "naruto"],
  ["Attack on Titan 1", "Hajime Isayama", "attack-on-titan"],
  ["Demon Slayer: Kimetsu no Yaiba, Vol. 3", "Koyoharu Gotouge", "demon-slayer"],
  ["Death Note, Vol. 1: Boredom", "Tsugumi Ohba", "death-note"],
  ["My Hero Academia, Vol. 1", "Kohei Horikoshi", "hero-academia"],
  ["Jujutsu Kaisen, Vol. 0", "Gege Akutami", "jujutsu-kaisen"],
  ["Solo Leveling, Vol. 1", "Chugong", "solo-leveling"],
  ["SPY×FAMILY 1", "Tatsuya Endo", "spy-family"],
  ["Spy x Family, Vol. 2", null, "spy-family"]
];

/** Books no entry may claim: look-alikes, cookbooks, textbooks, and short titles without their author. */
const MISSES: Array<[title: string, author: string | null]> = [
  ["Dunedin: A History", "A. H. Reed"],
  ["It Works", "RHJ"],
  ["It", null],
  ["It", "Alexa Chung"],
  ["Emma", null],
  ["Emma", "Alexander McCall Smith"],
  ["Emma's War", "Deborah Scroggins"],
  ["Persuasion: The Art of Influence", "Robert Cialdini"],
  ["Eclipse", "John Banville"],
  ["Eclipse: The Celestial Phenomenon", null],
  ["New Moon Rising", "Eugenia Price"],
  ["Twilight of the Idols", "Friedrich Nietzsche"],
  ["Legend", "David Gemmell"],
  ["Legends of the Fall", "Jim Harrison"],
  ["Wonder", null],
  ["Wonder Woman: Warbringer", "Leigh Bardugo"],
  ["Wonderland", "Joyce Carol Oates"],
  ["Holes", null],
  ["Black Holes and Time Warps", "Kip Thorne"],
  ["Uglies", null],
  ["Verity", "Lisa Carter"],
  ["One Day", "Gene Weingarten"],
  ["One Day in the Life of Ivan Denisovich", "Aleksandr Solzhenitsyn"],
  ["Normal People Don't Live Like This", "Dylan Landis"],
  ["Educated", null],
  ["Becoming", "Laura Jane Williams"],
  ["Becoming a Supple Leopard", "Kelly Starrett"],
  ["Foundation", "Mercedes Lackey"],
  ["Foundations of Analog and Digital Electronic Circuits", "Anant Agarwal"],
  ["The Martian Chronicles", "Ray Bradbury"],
  ["Jaws of Life", "Laura Leffler"],
  ["Catching Fire: How Cooking Made Us Human", "Richard Wrangham"],
  ["Fire and Blood: A History of Mexico", "T. R. Fehrenbach"],
  ["The Red Queen: Sex and the Evolution of Human Nature", "Matt Ridley"],
  ["Divergent Mind", "Jenara Nerenberg"],
  ["The Gathering Storm", "Winston S. Churchill"],
  ["The Lady of the Lake", "Walter Scott"],
  ["The Last Battle", "Cornelius Ryan"],
  ["Northern Lights", "Tim O'Brien"],
  ["Night Watch", "Sarah Waters"],
  ["Wings of Fire", null],
  ["Wings of Fire", "Dale Brown"],
  ["The Guide", "Peter Heller"],
  ["Rebecca", "Ferenc Molnár"],
  ["The Secret History of the World", "Jonathan Black"],
  ["The Notebook", "Agota Kristof"],
  ["The Selection Process", null],
  ["The Heir", "Vita Sackville-West"],
  ["Scarlet", "Stephen R. Lawhead"],
  ["Winter", "Ali Smith"],
  ["Icebreaker", "Lian Tanner"],
  ["After", "Bruce Greyson"],
  ["Circe and the Cyclops", null],
  ["Inferno", "Dante Alighieri"],
  ["The Lost World of the Kalahari", "Laurens van der Post"],
  ["Treasure Islands: Tax Havens", "Nicholas Shaxson"],
  ["The White Tiger", "Robert Stuart Nathan"],
  ["Cosmos", "Witold Gombrowicz"],
  ["Meditations on First Philosophy", "René Descartes"],
  ["Steve Jobs", "Karen Blumenthal"],
  ["The Joy of Cooking", "Irma S. Rombauer"],
  ["Salt, Fat, Acid, Heat", "Samin Nosrat"],
  ["Indian Vegetarian Cookery", "Jack Santa Maria"],
  ["Introduction to Algorithms", "Thomas H. Cormen"],
  ["Calculus: Early Transcendentals", "James Stewart"],
  ["Organic Chemistry", "Morrison and Boyd"],
  ["Concepts of Physics", "H. C. Verma"],
  ["Gray's Anatomy", "Henry Gray"],
  ["The C Programming Language", "Brian W. Kernighan; Dennis M. Ritchie"],
  ["Clean Code", "Robert C. Martin"],
  ["Oxford English Dictionary", null],
  ["A History of Modern India", "Bipan Chandra"],
  ["Lonely Planet India", null],
  ["The Elements of Style", "William Strunk Jr."],
  ["Middlesex", "Jeffrey Eugenides"],
  ["Untitled", null],
  ["", ""],
  ["document(3).epub", null]
];

/** A specific entry and the general one that must not swallow it (and the other way round). */
const PAIRS: Array<[title: string, author: string | null, wins: string, over: string]> = [
  ["Murder on the Orient Express", "Agatha Christie", "christie", "sherlock"],
  ["4.50 from Paddington", "Agatha Christie", "christie", "paddington"],
  ["It", "Stephen King", "it", "stephen-king"],
  ["The Shining", "Stephen King", "the-shining", "stephen-king"],
  ["The Gunslinger", "Stephen King", "dark-tower", "stephen-king"],
  ["Verity", "Colleen Hoover", "verity", "colleen-hoover"],
  ["It Ends with Us", "Colleen Hoover", "it-ends-with-us", "colleen-hoover"],
  ["It Ends with Us", "Colleen Hoover", "it-ends-with-us", "it"],
  ["Beach Read", "Emily Henry", "beach-read", "emily-henry"],
  ["Good Omens", "Terry Pratchett", "good-omens", "discworld"],
  ["Good Omens", "Neil Gaiman", "good-omens", "gaiman"],
  ["Coraline", "Neil Gaiman", "coraline", "gaiman"],
  ["The Sandman, Vol. 1: Preludes & Nocturnes", "Neil Gaiman", "sandman", "gaiman"],
  ["The Gathering Storm (Wheel of Time, #12)", "Brandon Sanderson", "wheel-of-time", "sanderson"],
  ["Skyward", "Brandon Sanderson", "space-operas", "sanderson"],
  ["The Lost World", "Arthur Conan Doyle", "jurassic-park", "sherlock"],
  ["Five on a Treasure Island", "Enid Blyton", "blyton", "treasure-island"],
  ["Wings of Fire", "A.P.J. Abdul Kalam", "kalam", "wings-of-fire-dragons"],
  ["Wings of Fire: The Dragonet Prophecy", "Tui T. Sutherland", "wings-of-fire-dragons", "kalam"],
  ["The Brothers Karamazov", "Fyodor Dostoevsky", "doorstops", "dostoevsky"],
  ["Great Expectations", "Charles Dickens", "moors-and-ghosts", "dickens"],
  ["Matilda", "Roald Dahl", "matilda", "dahl"],
  ["Charlie and the Chocolate Factory", "Roald Dahl", "chocolate-factory", "dahl"],
  ["Klara and the Sun", "Kazuo Ishiguro", "klara", "ishiguro"],
  ["Foundation and Empire", "Isaac Asimov", "foundation", "asimov-robots"],
  ["Twilight", "Stephenie Meyer", "twilight", "vampires"],
  ["Cinder", "Marissa Meyer", "lunar-chronicles", "twilight"],
  ["The Guide", "R. K. Narayan", "narayan", "hitchhiker"],
  ["A Suitable Boy", "Vikram Seth", "suitable-boy", "doorstops"],
  ["Emma", "Jane Austen", "austen", "bridgerton"]
];

describe("the table of Pip's book nods", () => {
  beforeAll(() => loadBookScenes());

  it("names only moves that exist", () => {
    const moves = new Set(LIB.map((move: { id: string }) => move.id));
    for (const nod of NODS) {
      expect(nod.moves.length, nod.id).toBeGreaterThan(0);
      for (const move of nod.moves) expect(moves.has(move), `${nod.id} plays ${move}`).toBe(true);
    }
  });

  it("gives every entry a name of its own, something to match on, and at least one line", () => {
    const ids = new Set<string>();
    for (const nod of NODS) {
      expect(ids.has(nod.id), nod.id).toBe(false);
      ids.add(nod.id);
      expect(nod.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(Boolean(nod.title || nod.titleBy || nod.author), nod.id).toBe(true);
      expect(nod.lines.length, nod.id).toBeGreaterThan(0);
      expect(new Set(nod.lines).size, nod.id).toBe(nod.lines.length);
      if (nod.n !== undefined) expect(Number.isInteger(nod.n) && nod.n > 1, nod.id).toBe(true);
    }
  });

  it("keeps every line in her voice and inside her bubble", () => {
    for (const nod of NODS) {
      for (const line of nod.lines) {
        expect(line.length, line).toBeLessThanOrEqual(NOD_LINE_MAX);
        expect(line.length, line).toBeGreaterThan(5);
        // Lower case, as she writes. Nothing she would have to shout.
        expect(line, nod.id).toBe(line.toLowerCase());
        expect(line.trim(), nod.id).toBe(line);
      }
    }
  });

  it("writes its patterns for a tidied title: lower case, no flags, no apostrophes", () => {
    for (const nod of NODS) {
      for (const pattern of [nod.title, nod.titleBy?.[0], nod.titleBy?.[1], nod.author]) {
        if (!pattern) continue;
        expect(pattern.flags, nod.id).toBe("");
        expect(pattern.source, nod.id).toBe(pattern.source.toLowerCase());
        expect(pattern.source, nod.id).not.toMatch(/['’&]/);
      }
    }
  });

  it("counts books and series, not rows", () => {
    expect(NODS.length).toBeGreaterThanOrEqual(240);
    expect(NOD_COUNT).toBeGreaterThanOrEqual(NODS.length);
    expect(NOD_COUNT).toBe(NODS.reduce((sum, nod) => sum + (nod.n ?? 1), 0));
    // An entry cannot stand for more books than it names (one per title it lists, one per writer it claims).
    for (const nod of NODS) {
      const named = [nod.title, nod.titleBy?.[0]].reduce((sum, pattern) => sum + (pattern ? pattern.source.split("|").length : 0), 0) + (nod.author ? nod.author.source.split("|").length : 0);
      expect(nod.n ?? 1, nod.id).toBeLessThanOrEqual(named);
    }
  });
});

describe("tidying what a file's metadata holds", () => {
  it("reads a title past its case, accents, apostrophes and dashes", () => {
    expect(plainTitle("Harry Potter and the Philosopher’s Stone")).toBe("harry potter and the philosophers stone");
    expect(plainTitle("Les Misérables")).toBe("les miserables");
    expect(plainTitle("Red, White & Royal Blue")).toBe("red white and royal blue");
    expect(plainTitle("Moby-Dick; or, The Whale")).toBe("moby dick; or the whale");
    expect(plainTitle("Legend - Marie Lu")).toBe("legend: marie lu");
    expect(plainTitle("  SHATTER_ME  ")).toBe("shatter me");
    expect(plainTitle("SPY×FAMILY 1")).toBe("spy x family 1");
    expect(plainTitle(null)).toBe("");
  });

  it("reads an author whichever way round it is written", () => {
    for (const author of ["Arthur Conan Doyle", "Sir Arthur Conan Doyle", "Doyle, Arthur Conan", "DOYLE, ARTHUR CONAN", "Doyle, Arthur Conan, 1859-1930", "Doyle, Arthur Conan, Sir, 1859-1930", "A. Conan Doyle", "Conan Doyle, Arthur", "Arthur Conan Doyle; Sidney Paget"]) {
      expect(plainAuthor(author), author).toMatch(/\bconan doyle\b/);
    }
    for (const author of ["J.K. Rowling", "J. K. Rowling", "Rowling, J. K.", "Rowling, J.K.", "JK Rowling"]) {
      expect(plainAuthor(author), author).toMatch(/\bjk rowling\b/);
    }
    expect(plainAuthor("George R. R. Martin")).toBe("george rr martin");
    expect(plainAuthor("Gabriel García Márquez")).toBe("gabriel garcia marquez");
    expect(plainAuthor("Terry Pratchett & Neil Gaiman")).toMatch(/terry pratchett \| neil gaiman/);
    expect(plainAuthor("A.P.J. Abdul Kalam")).toBe("apj abdul kalam");
    expect(plainAuthor(undefined)).toBe("");
  });
});

describe("which book gets which nod", () => {
  it("has enough cases to mean something", () => {
    expect(HITS.length).toBeGreaterThanOrEqual(150);
    expect(MISSES.length).toBeGreaterThanOrEqual(60);
    expect(PAIRS.length).toBeGreaterThanOrEqual(20);
  });

  it.each(HITS)("%s (%s) is %s", (title, author, id) => {
    expect(idFor(title, author)).toBe(id);
  });

  it.each(MISSES)("%s (%s) is nobody's", (title, author) => {
    expect(idFor(title, author)).toBeNull();
  });

  it.each(PAIRS)("%s (%s) is %s, not %s", (title, author, wins, over) => {
    expect(NODS.some((nod) => nod.id === over), over).toBe(true);
    expect(idFor(title, author)).toBe(wins);
  });

  it("lets a title speak before an author, wherever the two entries sit in the table", () => {
    // Christie's own entry comes before Paddington's; Gaiman's general one comes after Coraline's and Sandman's.
    const at = (id: string) => NODS.findIndex((nod) => nod.id === id);
    expect(at("gaiman")).toBeGreaterThan(at("coraline"));
    expect(idFor("Coraline", "Neil Gaiman")).toBe("coraline");
    // Sanderson is claimed as a writer far above the space operas, and the title still wins.
    expect(at("sanderson")).toBeLessThan(at("space-operas"));
    expect(idFor("Skyward", "Brandon Sanderson")).toBe("space-operas");
  });

  it("does not let a short title through without its author", () => {
    for (const title of ["It", "Emma", "Persuasion", "Legend", "Wonder", "Holes", "Verity", "One Day", "Normal People", "Educated", "Becoming", "Foundation", "Eclipse", "New Moon", "Twilight", "Uglies", "Rebecca", "The Notebook", "Circe"]) {
      expect(idFor(title, null), title).toBeNull();
      expect(idFor(title, "Somebody Else"), title).toBeNull();
    }
  });

  it("claims every book by a writer whose books all fit, and no more than that", () => {
    expect(idFor("Sparkling Cyanide", "Agatha Christie")).toBe("christie");
    expect(idFor("The Lost Symbol", "Dan Brown")).toBe("dan-brown");
    // Tahereh Mafi wrote other things; only the series gets the sparks.
    expect(idFor("A Very Large Expanse of Sea", "Tahereh Mafi")).toBeNull();
    expect(idFor("Letters from Father Christmas", "J. R. R. Tolkien")).toBeNull();
    expect(idFor("Fevre Dream", "George R. R. Martin")).toBeNull();
  });
});

describe("nodFor", () => {
  it("is null for a book she does not know", () => {
    expect(nodFor({ title: "Introduction to Algorithms", author: "Thomas H. Cormen" })).toBeNull();
    expect(nodFor({ title: null, author: null })).toBeNull();
    expect(nodFor({})).toBeNull();
  });

  it("picks a scene and a line of the entry, the same ones for the same seed", () => {
    const entry = NODS.find((nod) => nod.id === "harry-potter")!;
    for (let seed = 0; seed < 40; seed++) {
      const nod = nodFor({ title: "Harry Potter and the Goblet of Fire", author: "J.K. Rowling" }, seed)!;
      expect(entry.moves).toContain(nod.move);
      expect(entry.lines).toContain(nod.line);
      expect(nodFor({ title: "Harry Potter and the Goblet of Fire", author: "J.K. Rowling" }, seed)).toEqual(nod);
    }
    // The diary's seed is a day number times seven: a week of days walks through her lines.
    const lines = new Set([0, 1, 2].map((day) => nodFor({ title: "The Hobbit" }, day * 7)!.line));
    expect(lines.size).toBe(3);
  });
});

describe("the genre fallback", () => {
  beforeAll(() => loadBookScenes());

  it("reads a book's free-form genres", () => {
    const says: Array<[string[], NodGenre | null]> = [
      [["Romance"], "romance"],
      [["Contemporary Romance", "Fiction"], "romance"],
      [["Romantic comedy"], "romance"],
      [["Chick lit"], "romance"],
      [["Fiction", "Rom-com"], "romance"],
      [["Detective and mystery stories"], "mystery"],
      [["Crime thriller"], "mystery"],
      [["Thrillers"], "thriller"],
      [["Psychological suspense"], "thriller"],
      [["Horror"], "horror"],
      [["Gothic mystery"], "horror"],
      [["Epic fantasy"], "fantasy"],
      [["Science Fiction"], "scifi"],
      [["Historical fiction"], "historical"],
      [["Historical mystery"], "mystery"],
      [["Regency romance"], "romance"],
      [["Humor"], "humour"],
      [["Humour & Satire"], "humour"],
      [["Poetry"], "poetry"],
      [["Biography & Autobiography"], "biography"],
      [["Memoir"], "biography"],
      [["Self-Help"], "selfhelp"],
      [["Business & Economics"], "selfhelp"],
      [["Personal development"], "selfhelp"],
      [["Young Adult"], "ya"],
      [["YA", "Fiction"], "ya"],
      [["Juvenile Fiction"], "children"],
      [["Children's books"], "children"],
      [["Manga"], "comics"],
      [["Comics & Graphic Novels"], "comics"],
      [["Light novel"], "comics"],
      // What a book is beats who it is for, wherever each is listed.
      [["Young Adult", "Fantasy"], "fantasy"],
      [["Juvenile Fiction", "Mystery"], "mystery"],
      [["Young adult romance"], "romance"],
      // And none of them.
      [["Fiction"], null],
      [["Literary"], null],
      [["Cooking"], null],
      [["Crimea"], null],
      [[], null]
    ];
    for (const [genres, kind] of says) expect(nodGenre(genres), genres.join(", ")).toBe(kind);
    expect(nodGenre(null)).toBeNull();
    expect(nodGenre([4, null, { name: "Romance" }] as unknown[])).toBeNull();
  });

  it("agrees with the house's moods on the five they share", () => {
    for (const genre of ["Horror", "Ghost stories", "Mystery", "Noir", "Fantasy", "Fairy tales", "Science fiction", "Space opera", "Romance", "Love stories", "Paranormal romance", "Dark fantasy"]) {
      expect(nodGenre([genre]), genre).toBe(genreMood([genre]));
    }
  });

  it("gives a book she has never heard of its genre's scene, and says so", () => {
    const book = { title: "Lattes and Second Chances", author: "Priya Nair", genres: ["Romance"] };
    expect(nodEntryFor(book)).toBeNull();
    for (let seed = 0; seed < 30; seed++) {
      const nod = nodFor(book, seed)!;
      expect(nod.known).toBe(false);
      expect(GENRE_NODS.romance.moves).toContain(nod.move);
      expect(GENRE_NODS.romance.lines).toContain(nod.line);
    }
    // Without genres (the diary's call) there is nothing to go on.
    expect(nodFor({ title: book.title, author: book.author })).toBeNull();
    expect(nodFor({ ...book, genres: ["Fiction"] })).toBeNull();
    expect(nodFor({ ...book, genres: null })).toBeNull();
  });

  it("never beats a real nod", () => {
    for (const genres of [["Romance"], ["Horror"], ["Manga"], ["Self-Help"], []]) {
      for (let seed = 0; seed < 10; seed++) {
        const nod = nodFor({ title: "Shatter Me", author: "Tahereh Mafi", genres }, seed)!;
        expect(nod.known).toBe(true);
        expect(NODS.find((entry) => entry.id === "shatter-me")!.lines).toContain(nod.line);
      }
    }
    expect(nodFor({ title: "The Adventures of Sherlock Holmes", author: "Arthur Conan Doyle", genres: ["Romance"] })!.move).toBe("sleuth");
  });

  it("has moves that exist and lines that claim no book", () => {
    const moves = new Set(LIB.map((move: { id: string }) => move.id));
    const every = NODS.flatMap((nod) => nod.lines);
    for (const [kind, nod] of Object.entries(GENRE_NODS)) {
      expect(nod.moves.length, kind).toBeGreaterThan(0);
      expect(nod.lines.length, kind).toBeGreaterThanOrEqual(2);
      for (const move of nod.moves) expect(moves.has(move), `${kind} plays ${move}`).toBe(true);
      for (const line of nod.lines) {
        expect(line.length, line).toBeLessThanOrEqual(NOD_LINE_MAX);
        expect(line, kind).toBe(line.toLowerCase());
        // Not a line any real book has: the diary could not tell them apart.
        expect(every, line).not.toContain(line);
      }
    }
  });

  it("plays less often than a real nod, on every count", () => {
    for (const when of ["first", "again", "idle"] as const) {
      expect(NOD_ODDS.genre[when]).toBeLessThan(NOD_ODDS.known[when]);
      expect(NOD_ODDS.genre[when]).toBeGreaterThan(0);
    }
    expect(NOD_ODDS.known.first).toBe(1);
    expect(nodOdds({ known: true })).toBe(NOD_ODDS.known);
    expect(nodOdds({ known: false })).toBe(NOD_ODDS.genre);
  });
});

describe("the scenes themselves", () => {
  beforeAll(async () => {
    // The engine draws into an ImageData; outside a browser a plain one will do.
    (globalThis as { ImageData?: unknown }).ImageData ??= class {
      data: Uint8ClampedArray;
      constructor(public width: number, public height: number) {
        this.data = new Uint8ClampedArray(width * height * 4);
      }
    };
    await loadBookScenes();
  });

  const scenes = () => LIB.filter((move: { cat: string }) => move.cat === "Books");

  it("are 71: the 51 there were and 20 for what people read now", () => {
    const ids = scenes().map((move: { id: string }) => move.id);
    expect(ids.length).toBe(71);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ["loveletter", "heartbeat", "umbrella", "coffeecups", "glaresmile", "sparktouch", "mask", "thorncrown", "heist", "choosing", "torchdark", "missingposter", "checklist", "coinjar", "speeddash", "strawhat", "schoolday", "starship", "picnic", "catvisit"]) {
      expect(ids, id).toContain(id);
    }
  });

  it("are all used by some book or genre", () => {
    const used = new Set([...NODS.flatMap((nod) => nod.moves), ...Object.values(GENRE_NODS).flatMap((nod) => nod.moves)]);
    for (const scene of scenes()) expect(used.has(scene.id), scene.id).toBe(true);
  });

  it("draw every frame of their loop, the same way twice, in any skin", () => {
    const skins = [SKINS[0], SKINS[SKINS.length - 1]];
    for (const scene of scenes()) {
      expect([48, 60, 64, 72], scene.id).toContain(scene.loop);
      expect(scene.poster, scene.id).toBeLessThan(scene.loop);
      for (const skin of skins) {
        // Every frame in the plain skin; every fourth in the last one on the rack.
        for (let f = 0; f < scene.loop; f += skin === skins[0] ? 1 : 4) {
          const frame = renderFrame(scene, f, resolve(skin, f));
          let drawn = 0;
          for (let i = 3; i < frame.data.length; i += 4) if (frame.data[i] > 0) drawn++;
          expect(drawn, `${scene.id} frame ${f}`).toBeGreaterThan(0);
        }
      }
      const once = renderFrame(scene, scene.poster, resolve(SKINS[0], scene.poster)).data;
      const again = renderFrame(scene, scene.poster, resolve(SKINS[0], scene.poster)).data;
      expect(Array.from(again), scene.id).toEqual(Array.from(once));
    }
  }, 30_000);
});
