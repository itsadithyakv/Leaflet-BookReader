/**
 * The community guidelines, as the app shows them before a reader first
 * posts where everyone can read. The same rules, at more length, are in
 * docs/legal/community-guidelines.md, which is what the privacy policy and
 * the Store listing point to: keep the two saying the same thing.
 */
export const GUIDELINES: Array<{ rule: string; more: string }> = [
  { rule: "Talk about books.", more: "Reviews, quotes, questions and theories. Not adverts, not links to downloads, not anything for sale." },
  { rule: "Be kind to the reader, hard on the book.", more: "Disagree as much as you like with what someone thinks of a book. No insults, harassment or hate, about anyone." },
  { rule: "Mark your spoilers.", more: "Say how far into the book a thread goes. Leaflet keeps it covered for readers who are not there yet." },
  { rule: "Quote a little, not a lot.", more: "A few lines to show what you mean. Whole pages belong to the author." },
  { rule: "Nothing unlawful, sexual or violent for its own sake.", more: "It is removed, and the account is suspended." },
  { rule: "One account, yours.", more: "No pretending to be someone else, and no second accounts to pad a community or pile on reports." }
];

/** What happens to what breaks them, in one line each: under the rules in the dialog. */
export const CONSEQUENCES = [
  "Anyone can report a post, a thread, a reply, a community or a reader.",
  "What several readers report is hidden until it has been looked at.",
  "You can block any reader: you stop seeing each other."
];

export const REPORT_REASONS = [
  { id: "spam", label: "Spam or advertising" },
  { id: "harassment", label: "Harassment or insults" },
  { id: "hate", label: "Hate" },
  { id: "sexual", label: "Sexual or violent content" },
  { id: "spoiler", label: "A spoiler that is not marked" },
  { id: "other", label: "Something else" }
] as const;
