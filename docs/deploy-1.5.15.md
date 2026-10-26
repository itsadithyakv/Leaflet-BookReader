# Deploying 1.5.15's server — the run sheet

1.5.13 and 1.5.14 changed nothing in `server/`. Deploy from an export of the
`v1.5.15` tag, never from a working tree.

**Which server is live decides what this deploy carries:**
- **1.5.11's**, deployed 2026-10-23. As far as the handbook knows, this is
  the one live: 1.5.12's deploy had not been reported done. Then this deploy
  also carries everything in [deploy-1.5.12.md](deploy-1.5.12.md):
  - active readers, error reports, announcements and the admin overview;
  - sync capacity.
  
  Run that sheet's checks too. Its privacy-policy prerequisite is met:
  `main` was pushed at `v1.5.12`, which republished the site.
- **1.5.12's:** only what is below.

Nothing here needs a new secret, an npm package or a change to
`/etc/leaflet-api.env`. The server makes its new indexes itself at start, and
brings the profiles up to date before it listens (below).

**Deploy the server first, then ship the app.** The app works against either
server, and every older app works against this one:

- **1.5.15's app on the old server:** the People tab searches by the start of
  the handle (as today), shows Following as the whole list at once, and says
  "More arrives with the next server update." where browse, suggestions and
  Followers would be. No errors or toasts. A reader's page shows "Kudos · this
  week" (the old server keeps no month).
- **Older apps on this server:** unchanged. Search answers up to 20 instead of
  10, also by name; a locked card has two more fields (`followState`,
  `followsYou`), which they ignore.

## What changed

| File | What |
| --- | --- |
| `server/src/people.js` (new) | Search words (`nameWords`: the folded words of the name, the handle and its parts), how two readers stand (`followState`, `followsYou`), kudos this month, the start-up backfills, and the suggestions kept per reader in memory. |
| `server/src/followCounts.js` (new) | `followerCount` and `followingCount` kept on the profile: every follow made or removed goes through here. |
| `server/src/routes/people.js` (new) | `GET /v1/people?sort=active\|most\|new&before=` (every public reader, 20 a page by cursor), `GET /v1/people/suggested` (up to 10, with why), `GET /v1/people/me/followers` and `/following` (paged, with counts). |
| `server/src/routes/community.js` | Search by the start of any word of a name or handle, up to 20, blocks hidden both ways; the profile gains `followState`, `followsYou` (locked cards too) and `kudosThisMonth`, and reads its counts from the profile instead of counting `follows` twice per view; follow, unfollow and accept count; kudos counts the month. |
| `server/src/routes/social.js` | A profile save writes `nameWords` when the name or handle changes (and only then). |
| `server/src/routes/moderation.js` | A block removes the two follows one at a time, so both counts move. |
| `server/src/community.js` | Accepting every request on going public counts the follows; deleting an account or a profile counts its follows out of everyone else's. |
| `server/src/db.js` | Indexes: on `profiles` `people_search`, `people_active`, `people_new` (all partial: profiles with a handle); on `follows` `followers` (`{followeeId, _id: -1}`, which replaces and drops `followee`) and `following` (`{followerId, _id: -1}`). |
| `server/src/rateLimit.js` | `people`: 120 / 5 min per account (per IP signed out) for browse, suggestions and the two lists. Search keeps `search` (120 / 5 min per IP). |
| `server/src/index.js`, `src/app.js` | The backfills at start; the new routes mounted. |
| `server/test/people.test.js` (new), `community.test.js`, `social2.test.js` | Tests. Not deployed. |

What it costs Atlas (M0): every new query is indexed, paged at 20 (21 read)
and capped. A profile view is two `countDocuments` on `follows` cheaper than
before. A browse page is one indexed read of 21 small profiles, plus three
tiny queries for follow state and one for blocks when signed in. Suggestions
are a handful of indexed queries per reader, at most once in ten minutes. The
five new indexes are small (three cover profiles with a handle; two cover the
follows); together well under a megabyte at today's size.

## Before

1. On this PC, in `server\`: `npm test` against a local MongoDB. It should end
   `fail 0` (330 tests on 2026-10-26).
2. Atlas → the cluster → **Metrics**: note **Network** and **Data Size** for
   the last 7 days, to compare a week on.

## Deploy

From `server\deploy\` on this PC (PowerShell), from an export of the tag:

```powershell
.\deploy.ps1 -Host 129.154.40.208 -KeyPath "<your key>"
```

The unit, the Caddyfile and `/etc/leaflet-api.env` are unchanged.

## The backfills (automatic, at the first start)

Before the server listens, it logs one line:

```
[leaflet] people: {"nameWords":N,"followCounts":M,"kudosMonth":K}
```

- `nameWords`: profiles given their search words, 500 at a time. At every
  start; after the first it is 0 (it only fills profiles that have none).
- `followCounts`: how many counts were set from the `follows` rows. **Once**:
  marked in `meta` as `backfill:followCounts`, and `null` at later starts.
- `kudosMonth`: profiles given this month's kudos from the kudos kept (three
  weeks of them). **Once**: `backfill:kudosMonth`, `null` later.

If the line says `people: could not bring the profiles up to date`, the server
still starts; the next start tries again (nothing is marked until it worked).

## Check it

Connect to the VM:

```powershell
ssh -i "<your key>" ubuntu@129.154.40.208
```

Then, on the VM:

```bash
systemctl status leaflet-api
```

```bash
sudo journalctl -u leaflet-api -n 50 --no-pager | grep -E "people|Leaflet API|error"
```

Expect `active (running)`, the `[leaflet] people: {…}` line with numbers, and
`Leaflet API on http://127.0.0.1:8787`, with no Mongo errors.

From anywhere: `https://leafletapp.duckdns.org/health` → `{"ok":true}`.

In Atlas → Browse Collections:

- `meta`: two documents, `backfill:followCounts` and `backfill:kudosMonth`.
- `profiles`, any one with a handle: `nameWords`, `followerCount`,
  `followingCount`.
- `profiles` → Indexes: `people_search`, `people_active`, `people_new`;
  `follows` → Indexes: `followers`, `following` (and no `followee`).

In the app (1.5.15), signed in:

- Social → **People**: suggestions (if you read books others posted about, or
  follow readers who follow others), then "Active this week" with "Show more";
  "Most read" and "New" change the order.
- Search a word from the middle of a name ("lovelace"), and a handle.
- Followers / Following show counts that match your profile page's.
- Follow someone and unfollow them: your Following count moves by one, and
  theirs (on their page) by one.
- A reader's page: "Follows you" where they do; "Kudos · N this month" and the (i).
- Profile picture menu → **View my profile** opens your page.

## If something is wrong

Deploy the previous server the same way: export `v1.5.14` (the code that runs
now) into a scratch folder (`git archive v1.5.14 server | tar -x -C <folder>`)
and run its `deploy.ps1`. There is no migration to undo:

- the new profile fields (`nameWords`, `followerCount`, `followingCount`,
  `kudosMonthKey`, `kudosMonthCount`) and the `meta` markers are ignored by
  the older code;
- the older server recreates its `followee` index at start; the five new
  indexes stay and cost a little on each write. To drop them, in Atlas's
  shell: `db.profiles.dropIndex("people_search")`, likewise `people_active`,
  `people_new`, and `db.follows.dropIndex("followers")`, `("following")`;
- 1.5.15's app falls back as described at the top.

**Coming back to 1.5.15 after a rollback:** the older server neither counts
follows nor kudos on the profile, so recount before (or right after)
redeploying, in Atlas's shell:

```
db.meta.deleteMany({ _id: { $in: ["backfill:followCounts", "backfill:kudosMonth"] } })
```

and restart the service (the next start counts again). Search words written
by the older server's saves are filled in at the next start by themselves.

## What the privacy policy needs

Nothing new is collected or shown to anyone who could not see it before:
public profiles were already listed on the public board and readable by
handle. Two things worth a sentence in the "Community" part of the policy, if
it lists what a public profile shows:

- "Public profiles can be browsed and searched by name in the app."
- Suggestions can tell you that a public reader you follow follows someone
  ("Followed by @theo").
