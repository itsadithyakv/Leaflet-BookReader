/**
 * Well-known series, for books that do not say which series they are in.
 *
 * Most EPUBs from a shop or Calibre carry their series, and titles like
 * "Leviathan Wakes (The Expanse, #1)" name theirs; but "Harry Potter and the
 * Chamber of Secrets" does not, and nothing in "Catching Fire" says it follows
 * "The Hunger Games". This list fills that gap for the series people most
 * often own whole, and gives the reading order and the full count, so a
 * series can say which books are missing.
 *
 * A book matches when its title is one of the titles here (compared without
 * case, punctuation or a leading "The"; a subtitle or bracketed note on the book
 * is ignored) and its author's surname is one of `authors`. An entry of several
 * titles is one book published under different names (UK and US editions).
 * Order is the order the series is usually numbered in.
 */
export type KnownSeries = {
  name: string;
  /** Surnames, lower case, as `authorKey` makes them. */
  authors: string[];
  /** Other names the series goes by, so a book that names it differently joins. */
  aliases?: string[];
  books: Array<string | string[]>;
};

export const KNOWN_SERIES: KnownSeries[] = [
  {
    name: "Harry Potter",
    authors: ["rowling"],
    books: [
      ["Harry Potter and the Philosopher's Stone", "Harry Potter and the Sorcerer's Stone"],
      "Harry Potter and the Chamber of Secrets",
      "Harry Potter and the Prisoner of Azkaban",
      "Harry Potter and the Goblet of Fire",
      "Harry Potter and the Order of the Phoenix",
      "Harry Potter and the Half-Blood Prince",
      "Harry Potter and the Deathly Hallows"
    ]
  },
  {
    name: "The Lord of the Rings",
    authors: ["tolkien"],
    books: ["The Fellowship of the Ring", "The Two Towers", "The Return of the King"]
  },
  {
    name: "The Hunger Games",
    authors: ["collins"],
    books: [
      "The Hunger Games",
      "Catching Fire",
      "Mockingjay",
      "The Ballad of Songbirds and Snakes",
      "Sunrise on the Reaping"
    ]
  },
  {
    name: "Percy Jackson and the Olympians",
    authors: ["riordan"],
    aliases: ["Percy Jackson"],
    books: [
      "The Lightning Thief",
      "The Sea of Monsters",
      "The Titan's Curse",
      "The Battle of the Labyrinth",
      "The Last Olympian",
      "The Chalice of the Gods",
      "Wrath of the Triple Goddess"
    ]
  },
  {
    name: "The Heroes of Olympus",
    authors: ["riordan"],
    books: ["The Lost Hero", "The Son of Neptune", "The Mark of Athena", "The House of Hades", "The Blood of Olympus"]
  },
  {
    name: "The Kane Chronicles",
    authors: ["riordan"],
    books: ["The Red Pyramid", "The Throne of Fire", "The Serpent's Shadow"]
  },
  {
    name: "A Song of Ice and Fire",
    authors: ["martin"],
    books: ["A Game of Thrones", "A Clash of Kings", "A Storm of Swords", "A Feast for Crows", "A Dance with Dragons"]
  },
  {
    name: "The Chronicles of Narnia",
    authors: ["lewis"],
    aliases: ["Narnia"],
    books: [
      "The Magician's Nephew",
      "The Lion, the Witch and the Wardrobe",
      "The Horse and His Boy",
      "Prince Caspian",
      "The Voyage of the Dawn Treader",
      "The Silver Chair",
      "The Last Battle"
    ]
  },
  {
    name: "Dune",
    authors: ["herbert"],
    aliases: ["Dune Chronicles"],
    books: [
      "Dune",
      "Dune Messiah",
      "Children of Dune",
      "God Emperor of Dune",
      "Heretics of Dune",
      "Chapterhouse: Dune"
    ]
  },
  {
    name: "Twilight",
    authors: ["meyer"],
    aliases: ["The Twilight Saga"],
    books: ["Twilight", "New Moon", "Eclipse", "Breaking Dawn", "Midnight Sun"]
  },
  {
    name: "Divergent",
    authors: ["roth"],
    books: ["Divergent", "Insurgent", "Allegiant"]
  },
  {
    name: "Mistborn",
    authors: ["sanderson"],
    books: [
      "The Final Empire",
      "The Well of Ascension",
      "The Hero of Ages",
      "The Alloy of Law",
      "Shadows of Self",
      "The Bands of Mourning",
      "The Lost Metal"
    ]
  },
  {
    name: "The Stormlight Archive",
    authors: ["sanderson"],
    aliases: ["Stormlight"],
    books: ["The Way of Kings", "Words of Radiance", "Oathbringer", "Rhythm of War", "Wind and Truth"]
  },
  {
    name: "The Wheel of Time",
    authors: ["jordan", "sanderson"],
    books: [
      "The Eye of the World",
      "The Great Hunt",
      "The Dragon Reborn",
      "The Shadow Rising",
      "The Fires of Heaven",
      "Lord of Chaos",
      "A Crown of Swords",
      "The Path of Daggers",
      "Winter's Heart",
      "Crossroads of Twilight",
      "Knife of Dreams",
      "The Gathering Storm",
      "Towers of Midnight",
      "A Memory of Light"
    ]
  },
  {
    name: "The Expanse",
    authors: ["corey"],
    books: [
      "Leviathan Wakes",
      "Caliban's War",
      "Abaddon's Gate",
      "Cibola Burn",
      "Nemesis Games",
      "Babylon's Ashes",
      "Persepolis Rising",
      "Tiamat's Wrath",
      "Leviathan Falls"
    ]
  },
  {
    name: "His Dark Materials",
    authors: ["pullman"],
    books: [["Northern Lights", "The Golden Compass"], "The Subtle Knife", "The Amber Spyglass"]
  },
  {
    name: "The Hitchhiker's Guide to the Galaxy",
    authors: ["adams"],
    books: [
      "The Hitchhiker's Guide to the Galaxy",
      "The Restaurant at the End of the Universe",
      "Life, the Universe and Everything",
      "So Long, and Thanks for All the Fish",
      "Mostly Harmless"
    ]
  },
  {
    name: "Foundation",
    authors: ["asimov"],
    books: [
      "Foundation",
      "Foundation and Empire",
      "Second Foundation",
      "Foundation's Edge",
      "Foundation and Earth",
      "Prelude to Foundation",
      "Forward the Foundation"
    ]
  },
  {
    name: "Ender's Saga",
    authors: ["card"],
    books: ["Ender's Game", "Speaker for the Dead", "Xenocide", "Children of the Mind"]
  },
  {
    name: "Remembrance of Earth's Past",
    authors: ["liu", "cixin"],
    aliases: ["The Three-Body Problem", "Three-Body"],
    books: ["The Three-Body Problem", "The Dark Forest", "Death's End"]
  },
  {
    name: "The Witcher",
    authors: ["sapkowski"],
    books: [
      "The Last Wish",
      "Sword of Destiny",
      "Blood of Elves",
      "The Time of Contempt",
      "Baptism of Fire",
      ["The Tower of the Swallow", "The Tower of Swallows"],
      "The Lady of the Lake",
      "Season of Storms"
    ]
  },
  {
    name: "The Kingkiller Chronicle",
    authors: ["rothfuss"],
    books: ["The Name of the Wind", "The Wise Man's Fear"]
  },
  {
    name: "Millennium",
    authors: ["larsson"],
    books: [
      "The Girl with the Dragon Tattoo",
      "The Girl Who Played with Fire",
      "The Girl Who Kicked the Hornets' Nest"
    ]
  },
  {
    name: "Throne of Glass",
    authors: ["maas"],
    books: [
      "Throne of Glass",
      "Crown of Midnight",
      "Heir of Fire",
      "Queen of Shadows",
      "Empire of Storms",
      "Tower of Dawn",
      "Kingdom of Ash"
    ]
  },
  {
    name: "A Court of Thorns and Roses",
    authors: ["maas"],
    books: [
      "A Court of Thorns and Roses",
      "A Court of Mist and Fury",
      "A Court of Wings and Ruin",
      "A Court of Frost and Starlight",
      "A Court of Silver Flames"
    ]
  },
  {
    name: "The Empyrean",
    authors: ["yarros"],
    books: ["Fourth Wing", "Iron Flame", "Onyx Storm"]
  },
  {
    name: "Shadow and Bone",
    authors: ["bardugo"],
    aliases: ["The Grisha", "Grisha Trilogy"],
    books: ["Shadow and Bone", "Siege and Storm", "Ruin and Rising"]
  },
  {
    name: "Six of Crows",
    authors: ["bardugo"],
    books: ["Six of Crows", "Crooked Kingdom"]
  },
  {
    name: "Red Rising",
    authors: ["brown"],
    books: ["Red Rising", "Golden Son", "Morning Star", "Iron Gold", "Dark Age", "Light Bringer"]
  },
  {
    name: "The Maze Runner",
    authors: ["dashner"],
    books: ["The Maze Runner", "The Scorch Trials", "The Death Cure"]
  },
  {
    name: "Earthsea",
    authors: ["guin"],
    aliases: ["The Earthsea Cycle"],
    books: [
      "A Wizard of Earthsea",
      "The Tombs of Atuan",
      "The Farthest Shore",
      "Tehanu",
      "Tales from Earthsea",
      "The Other Wind"
    ]
  },
  {
    name: "Anne of Green Gables",
    authors: ["montgomery"],
    books: [
      "Anne of Green Gables",
      "Anne of Avonlea",
      "Anne of the Island",
      "Anne of Windy Poplars",
      "Anne's House of Dreams",
      "Anne of Ingleside",
      "Rainbow Valley",
      "Rilla of Ingleside"
    ]
  },
  {
    name: "Sherlock Holmes",
    authors: ["doyle"],
    books: [
      "A Study in Scarlet",
      ["The Sign of the Four", "The Sign of Four"],
      "The Adventures of Sherlock Holmes",
      "The Memoirs of Sherlock Holmes",
      "The Hound of the Baskervilles",
      "The Return of Sherlock Holmes",
      "The Valley of Fear",
      "His Last Bow",
      ["The Case-Book of Sherlock Holmes", "The Casebook of Sherlock Holmes"]
    ]
  },
  {
    name: "The Inheritance Cycle",
    authors: ["paolini"],
    books: ["Eragon", "Eldest", "Brisingr", "Inheritance"]
  },
  {
    name: "The Giver Quartet",
    authors: ["lowry"],
    books: ["The Giver", "Gathering Blue", "Messenger", "Son"]
  },
  {
    name: "Outlander",
    authors: ["gabaldon"],
    books: [
      ["Outlander", "Cross Stitch"],
      "Dragonfly in Amber",
      "Voyager",
      "Drums of Autumn",
      "The Fiery Cross",
      "A Breath of Snow and Ashes",
      "An Echo in the Bone",
      "Written in My Own Heart's Blood",
      "Go Tell the Bees That I Am Gone"
    ]
  },
  {
    name: "The Dark Tower",
    authors: ["king"],
    books: [
      "The Gunslinger",
      "The Drawing of the Three",
      "The Waste Lands",
      "Wizard and Glass",
      "Wolves of the Calla",
      "Song of Susannah",
      "The Dark Tower"
    ]
  },
  {
    name: "A Series of Unfortunate Events",
    authors: ["snicket"],
    books: [
      "The Bad Beginning",
      "The Reptile Room",
      "The Wide Window",
      "The Miserable Mill",
      "The Austere Academy",
      "The Ersatz Elevator",
      "The Vile Village",
      "The Hostile Hospital",
      "The Carnivorous Carnival",
      "The Slippery Slope",
      "The Grim Grotto",
      "The Penultimate Peril",
      "The End"
    ]
  },
  {
    name: "Artemis Fowl",
    authors: ["colfer"],
    books: [
      "Artemis Fowl",
      ["The Arctic Incident", "Artemis Fowl and the Arctic Incident"],
      ["The Eternity Code", "Artemis Fowl and the Eternity Code"],
      ["The Opal Deception", "Artemis Fowl and the Opal Deception"],
      ["The Lost Colony", "Artemis Fowl and the Lost Colony"],
      ["The Time Paradox", "Artemis Fowl and the Time Paradox"],
      ["The Atlantis Complex", "Artemis Fowl and the Atlantis Complex"],
      ["The Last Guardian", "Artemis Fowl and the Last Guardian"]
    ]
  },
  {
    name: "Silo",
    authors: ["howey"],
    books: ["Wool", "Shift", "Dust"]
  },
  {
    name: "Children of Time",
    authors: ["tchaikovsky"],
    books: ["Children of Time", "Children of Ruin", "Children of Memory"]
  },
  {
    name: "Hyperion Cantos",
    authors: ["simmons"],
    books: ["Hyperion", "The Fall of Hyperion", "Endymion", "The Rise of Endymion"]
  },
  {
    name: "The Murderbot Diaries",
    authors: ["wells"],
    aliases: ["Murderbot"],
    books: [
      "All Systems Red",
      "Artificial Condition",
      "Rogue Protocol",
      "Exit Strategy",
      "Network Effect",
      "Fugitive Telemetry",
      "System Collapse"
    ]
  },
  {
    name: "The First Law",
    authors: ["abercrombie"],
    books: ["The Blade Itself", "Before They Are Hanged", "Last Argument of Kings"]
  },
  {
    name: "Bridgerton",
    authors: ["quinn"],
    books: [
      "The Duke and I",
      "The Viscount Who Loved Me",
      "An Offer from a Gentleman",
      "Romancing Mister Bridgerton",
      "To Sir Phillip, With Love",
      "When He Was Wicked",
      "It's in His Kiss",
      "On the Way to the Wedding"
    ]
  },
  {
    name: "The Southern Reach",
    authors: ["vandermeer"],
    books: ["Annihilation", "Authority", "Acceptance"]
  },
  {
    name: "The Poppy War",
    authors: ["kuang"],
    books: ["The Poppy War", "The Dragon Republic", "The Burning God"]
  },
  {
    name: "The Broken Earth",
    authors: ["jemisin"],
    books: ["The Fifth Season", "The Obelisk Gate", "The Stone Sky"]
  },
  {
    name: "The Folk of the Air",
    authors: ["black"],
    books: ["The Cruel Prince", "The Wicked King", "The Queen of Nothing"]
  }
];
