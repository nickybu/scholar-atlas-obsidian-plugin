# Scholar Atlas

Keep track of the researchers you know: where they work and live now, the
institutions they've moved through, and what they're publishing. Add someone
by name, ORCID or OpenAlex ID, and Scholar Atlas fills in their note from
[OpenAlex](https://openalex.org) and [ORCID](https://orcid.org).

Each person is an ordinary note with properties, so you can build your own
views with Bases, Dataview or search: who lives in the city you're visiting,
who you met at a conference, who moved where.

## Features

- **Add person**: type a name, plus an ORCID or OpenAlex ID, where you met
  and a photo if you have them. A note is created from your template and
  filled in.
- **Current and previous institutions, city and country**, from the person's
  ORCID employment history and the affiliations on their papers. Each is a
  link to its own note, so the graph shows who works where.
- **Collaborators**: who they publish with, the institutions, companies and
  countries they work with, and their likely PI. Clicking a collaborator who
  has no note yet creates one and fills it in.
- **Methods and model systems** they work with, read from their papers'
  titles, abstracts and MeSH terms.
- **Website, LinkedIn and public email** from their ORCID record.
- **Latest papers** in each note, from OpenAlex, or from ORCID for people
  OpenAlex doesn't know.
- **Profile card** at the top of each person note: their photo, where they
  are, their lab, methods, model systems and where you met, drawn live from
  their properties.
- **Photos**: paste, drop or link a photo of someone. It's saved in your
  vault and shown on their profile card, and Bases cards can use it as their
  cover image.
- **Research feed**: one note with everyone's recent papers (the last 90 days
  by default). A paper by several people you know is listed once, with all
  of them.
- **No ID? No problem**: as you type a name in **Add person**, the closest
  OpenAlex matches appear for you to pick from. If you add someone without
  picking, their note lists the matches instead.
- **Your edits are safe**: only empty properties are filled. Anything you
  typed stays.

## Getting started

1. Install and enable **Scholar Atlas** in **Settings → Community plugins**.
2. Run **Scholar Atlas: Add person** from the command palette, or select the
   person icon in the ribbon.
3. Enter their name. After a short pause, the closest OpenAlex authors by
   that name are listed under it, with their institutions and number of
   works. If one is them, select **Use** and their OpenAlex ID (and ORCID,
   if OpenAlex knows it) is filled in. Optionally also give:
   - their ORCID or OpenAlex ID yourself (the IDs or the full orcid.org /
     openalex.org links both work);
   - **Met at**: an event note, suggested from your events folder;
   - a **photo**, in any of the ways described in [Photos](#photos).

The note is created in your people folder (`People/` by default) and opened.
If you choose people by tag instead (see [Which notes are people](#which-notes-are-people)),
it goes where Obsidian puts new notes and gets your people tag.
Add anything else the plugin can't know by hand.

### When there's no ID

If none of the matches in the dialog is the person, or you're not sure yet,
add them with both IDs blank. The note's papers section then lists the three
closest OpenAlex authors by name. If the note's `institutions` property is
filled in, matches from that institution come first. Paste the right ID into
the `openalex` property and run **Update this person**.

If none of them is the person:

- **Find their ORCID** (on orcid.org, their lab page or a recent paper) and
  put it in `orcid`. If OpenAlex knows that ORCID, the OpenAlex ID is filled
  in. If not, their profile and papers come from ORCID.
- Otherwise, write `none` in `openalex`. This stops the suggestions. Without
  an ORCID, everything else is yours to fill in.

OpenAlex sometimes splits one person into several author profiles, e.g. one
per spelling of their name. Pick the one with the most works and recent
papers. If `openalex` holds an ID OpenAlex doesn't know, for example a typo,
the papers section says so.

## Commands

| Command | What it does |
|---|---|
| Add person | Create a person note from your template, with where you met and a photo if given, fill it in and open it |
| Update this person | Look the open person up again from scratch. Only offered on person notes. An empty note, or one without properties, is started from your template first |
| Set photo | Add or replace the open person's photo (see [Photos](#photos)) |
| Update all people | Bring everyone's papers up to date and fill any empty properties, skipping what can't have changed |
| Update all people and refresh locations | Look everyone up again from scratch, and overwrite city, country and both institution lists, for when people move |

Every command except **Set photo** also rebuilds the research feed. A notice
shows progress, and only one update runs at a time: a command run while
another is updating is refused with a notice, and a collaborator clicked
while one is updating is looked up as soon as it finishes.

### Built for big, growing vaults

**Update all people** stays quick however many people you add:

- **Batched lookups.** Everyone's OpenAlex records come from a few batched
  requests, up to 100 people per request.
- **Only what changed:**
  - A person's papers are only fetched again when OpenAlex's count of their
    works has changed.
  - Each ORCID record is checked at most once a week. The **Check ORCID
    records every** setting changes this.
  - People still waiting for you to pick an OpenAlex ID aren't searched
    again.
  - People marked `only_update_papers` are never looked up on ORCID.

  So a repeat run over 1,000 people takes a few seconds and about a dozen
  requests. **Update this person** and **refresh locations** always look
  everything up.
- **Paced requests.** Up to 8 people are updated at once, with requests
  spaced to stay under OpenAlex's and ORCID's rate limits.
- **Light on your vault.** IDs are read from Obsidian's in-memory index
  rather than the notes. The research feed only re-reads notes that changed.
  Nothing runs at startup, and nothing is fetched in the background.

If OpenAlex or ORCID can't be reached, the update stops after a few seconds
instead of trying every person in turn. Notes already updated keep their
changes. A rejected API key stops it immediately. A problem with one person's
lookup only skips that person.

Lookups take a moment, so anything you type into a note while it's being
updated is respected: properties are only filled if they're still empty
when the results arrive.

## Person notes

Scholar Atlas reads and writes these properties. The built-in template has
them all. If you use your own template, include the ones you want filled.

| Property | Filled from |
|---|---|
| `orcid` | You, or the person's OpenAlex profile |
| `openalex` | You, or looked up from their ORCID. `none` means they're not on OpenAlex |
| `institutions` | Where they work now: ORCID jobs with no end date, else OpenAlex's last known institutions, else the institution on their newest paper |
| `city`, `country` | The same source as `institutions`, so they agree. If the ORCID address gives a state or province where the city should be ("ON", "CA"), the institution's own location is used instead |
| `previous_institutions` | Ended ORCID jobs and other institutions on their papers, most recent first |
| `website`, `linkedin`, `email` | Links and public email on their ORCID record. Social profiles such as Bluesky, X and GitHub are skipped |
| `photo` | You, with **Set photo** or **Add person**. Never looked up automatically |
| `events` | **Add person**'s *Met at* field adds a link to the event note. Otherwise yours |
| `lab` | When empty, a link to their likely PI (see [Collaborators](#collaborators)). Otherwise yours |
| `methods`, `model_systems` | Their papers (see [Methods and model systems](#methods-and-model-systems)) |
| `only_update_papers` | You: a checkbox. See [People whose details are done](#people-whose-details-are-done) |

Other properties are never touched, so add your own freely.

`institutions`, `previous_institutions`, `city` and `country` are links to
[place notes](#places). Places you've typed as plain text are turned into
links on the next update.

Papers are written between two markers in the note:

```markdown
<!-- papers:start -->
<!-- papers:end -->
```

The markers and the papers heading are added to the end of the note if
missing. The collaborators section (`<!-- collaborators:start -->` /
`<!-- collaborators:end -->`) works the same way. The plugin updates what's
between the markers, but never removes anything you write there: see
[Your writing is never removed](#your-writing-is-never-removed).

### Places

Each institution, city and country gets a note in your places folder
(`Places/Institutions`, `Places/Cities`, `Places/Countries` by default):

- **Institution notes** have `type` (education, company, facility…), links to
  their `city` and `country`, `location` coordinates, and `ror` and
  `openalex` IDs.
- **City notes** link to their country and have `location`.
- **Country notes** have their `country_code`.
- **Each place note lists its people** with a base: who's there now, who was
  there before, and who has worked with it.

Place notes are only created when missing. After that, only their empty
properties are filled, so your edits and notes in them stay. Two cities with
the same name get the country added, e.g. "Cambridge (United States)". Map
plugins can use the `location` coordinates.

In the graph view, a person's local graph shows their institutions, city,
country, collaborators and PI. To tell them apart, add colour groups in the
graph settings, e.g. `path:People`, `path:Places/Institutions`,
`path:Places/Cities` and `path:Places/Countries`.

### Collaborators

A person's latest 50 papers, fetched in the same request as their paper
list, give a **Collaborators** section:

- **Co-authors**, by number of papers together (top 15). OpenAlex sometimes
  splits one person into several profiles, e.g. "Jorge F. Mejías" and
  "Mejias Jorge F.", so profiles with the same name are merged. Papers with
  over 50 authors are left out, because consortium papers say little about
  who someone works with.
- **Companies** they've published with.
- **Institutions** they've published with on at least two papers, not
  counting their own or umbrella organisations like CNRS or the Max Planck
  Society.
- **Countries** they've published with.

Everyone and everything is a link:
- Co-authors with a note link to it.
- Anyone else links to a note in your people folder that doesn't exist yet.
  **Click it and the note is created and filled in**, just like **Add
  person**. If an update is running at the time, the note is filled in as
  soon as it finishes. Should a note ever be left empty, open it and run
  **Update this person**: it gets the template and is looked up.
- Institutions, companies and countries work the same way with place notes.

**Their likely PI** is the person who's most often last author on their
papers, on at least two papers and at least 40% of those led by someone
else. When `lab` is empty, it's set to a link to that person.

Collaborators, the PI and the research tags below are worked out again
whenever their papers are fetched again.

### Methods and model systems

`methods` (e.g. "Two-photon imaging", "Computational modelling") and
`model_systems` (e.g. "Mouse", "Zebrafish") come from the titles, abstracts
and MeSH terms of their latest papers. They use a vocabulary of 108 terms
from [neuro-labs-explorer](https://github.com/nickybu/neuro-labs-explorer).
A term needs at least two papers, or one if they have fewer than three, and
each update adds up to 8 of each, most frequent first. Terms are only ever
added: ones you typed, or that were found before, are never removed, so you
can add your own freely.

### Photos

Scholar Atlas never looks for photos itself. You choose one, either when
adding the person or later by opening their note and running **Set photo**.
Then do one of these:

- **Paste** an image anywhere in the dialog (copy it from their lab page
  first).
- **Drop** an image file onto it.
- **Choose** an image from your files.
- **Enter the image's address.** The address of the image itself works; the
  address of the page it's on doesn't.

Large photos are scaled down to 512 px on the longest side (or twice the
photo width, if that's bigger) and saved as JPEG, so a phone photo adds tens
of kilobytes to your vault rather than megabytes. GIFs, SVGs and images that
are already small are kept as they are.

The image is saved in your photos folder (`Photos` by default) as
`<person's name>.<ext>`, numbered if that name is taken. If you clear the
**Photos folder** setting, photos follow Obsidian's **Files and links**
attachment settings instead. `photo` is set to a link to the image, and the
photo appears on their [profile card](#profile-card).

You can also paste a link like `[[Ada.jpg]]` or an image URL into `photo`
yourself. Replacing a photo never deletes the old image file.

To show faces in a Bases cards view, set its image property to `photo`
(`image: note.photo` in the `.base` file).

### Profile card

Each person note starts with a card. It shows their photo, current
institutions, city and country, lab, methods, model systems and where you
met. Places, the lab and events are clickable links.

The card is a `scholar-atlas` code block, between `<!-- card:start -->` and
`<!-- card:end -->`, that the plugin draws from the note's current
properties. It updates as soon as you change a property and never writes
to the note. Without the plugin, for example in another app, it shows as an
empty code block. The photo width is a setting.

### People whose details are done

Tick `only_update_papers` on someone whose details you're happy with, or whose
empty properties will never be filled (many people have no public email, for
example). From then on:

- **Update all people** only keeps their papers up to date. Their profile
  isn't looked up again, so they cost no ORCID request.
- **Refresh locations** doesn't touch them either.
- **Update this person** still looks everything up, for when they move. You
  can also untick the box.

One exception: for someone who's on ORCID but not OpenAlex, their papers come
from their ORCID record, so that's still fetched (at most every few days) for
their papers alone.

### Your writing is never removed

Scholar Atlas never deletes anything you write, in any note.

- **Your own text** outside the plugin's sections is never touched.
- **Inside the plugin's sections** (papers, collaborators, profile card, and
  the research feed's list), each section carries a hidden signature: a
  short fingerprint of every line the plugin wrote, in an Obsidian comment
  (`%%sa:…%%`). When a section is updated, lines that still match are
  replaced. Lines you added, or plugin lines you edited (say, a corrected
  title), are moved to just below the section and kept for good. Sections
  written by earlier versions have no signature, so any line that isn't
  exactly in the plugin's format is kept the same way.
- **Research feed note:** only its marked list is updated. Anything you add
  above or below it, including properties, stays.
- **Properties** are only filled when empty. City and country are filled as
  a pair, only when both are empty, so a city you typed is never mixed with
  a looked-up country.
- **`methods` and `model_systems`** are only ever added to.
- **Notes it creates** (people, places) are only filled in while empty;
  after that, only their empty properties are filled.

The one deliberate exception is **Update all people and refresh locations**,
for when someone moves:
- It replaces `city` and `country`.
- It updates `institutions`, but institutions that are no longer current,
  including ones you typed, move to `previous_institutions` rather than
  disappearing.
- It never blanks a property it found nothing for.

Obsidian itself drops comments (`# …`) inside the properties block whenever
a plugin updates properties. Keep notes about a person in the body of their
note rather than as comments among the properties.

### Good to know

- The city is where the person's institution is, not necessarily where they
  live. It changes when they update ORCID or publish under a new affiliation.
- `previous_institutions` includes every institution on their papers, so
  short visits can show up. Delete them by hand. They stay deleted until you
  refresh locations.
- If someone's ORCID still lists an old job as current, ORCID wins over
  OpenAlex.

## Settings

| Setting | Default | |
|---|---|---|
| People folder | `People` | Person notes: notes in this folder and its subfolders. New people are created here |
| People tags | — | Person notes: notes with any of these tags, e.g. `person, scientist` |
| With both a folder and tags | In the folder, or tagged | Or: in the folder, and tagged |
| Person template | `Templates/Person.md` | Used by **Add person**. If it doesn't exist, the built-in template is used |
| Events folder | `Events` | Event notes, suggested in **Add person**'s *Met at* field |
| Event tags | — | Event notes: notes with any of these tags |
| With both a folder and tags (events) | In the folder, or tagged | Or: in the folder, and tagged |
| Places folder | `Places` | Institution, city and country notes go in its `Institutions`, `Cities` and `Countries` subfolders |
| Photos folder | `Photos` | Where people's photos are saved. Empty: follow Obsidian's attachment settings |
| Research feed note | `Research feed.md` | Rebuilt after every update |
| Papers per person | 10 | |
| Research feed window | 90 days | |
| Photo width | 200 px | Width of the photo on profile cards |
| Check ORCID records every | 7 days | How often **Update all people** looks at each ORCID record. 0 checks every time |
| Contact email | — | Optional. Sent to OpenAlex with each request, which gets faster, more reliable service |
| API key | — | Optional OpenAlex API key, kept in Obsidian's keychain (see below) |

### Which notes are people

People (and events) can be chosen by folder, by tags, or both:

- **Folder only** (the default, `People`): every note in the folder and its
  subfolders.
- **Tags only**: clear the folder and set tags such as `person`. Any note
  with one of those tags counts, wherever it is. Nested tags count too, so
  `#person/pi` matches `person`.
- **Both**: choose whether a note needs to be in the folder *or* tagged, or
  in the folder *and* tagged. The second picks out some notes in a shared
  folder.

The tags fields suggest your vault's tags as you type. Under each section,
**Matching notes** shows how many notes are selected right now, with a few
of their names, so you can see the effect of a change straight away (it
updates a moment after you stop typing).

New people (from **Add person** or by clicking a collaborator) go in the
people folder, or where Obsidian puts new notes if there's none. They're
given the first people tag, so they count as people however you've set it
up.

Place notes created from now on list people using the same rule. Place notes
created earlier keep the rule from when they were made, which is a `base`
block you can edit.

### Your API key stays on your device

The OpenAlex API key is kept in Obsidian's keychain. The keychain isn't
synced. Plugin settings only store the secret's *name*, so they're safe to
sync or share. On each device, add the key once with the same secret name.
Until you do, that device works without a key.

## Privacy and network use

Scholar Atlas only contacts the network when you run one of its commands,
type a name in the **Add person** dialog (to list matches), or click a
collaborator, institution or country that doesn't have a note yet (to fill
the new note in). There's no telemetry or analytics, and
nothing is sent in the background, and nothing is written without a
command. Profile cards are drawn from properties already in your vault.

It talks to two free, public scholarly APIs:

| Service | What is sent |
|---|---|
| [OpenAlex](https://openalex.org) ([privacy policy](https://openalex.org/OpenAlex_privacy_policy.pdf)) | ORCID and OpenAlex IDs from your notes, and institution IDs. The name typed in **Add person**, and the note name of people with no ID, to search for matches. Your contact email and API key, if you set them |
| [ORCID public API](https://pub.orcid.org) ([privacy policy](https://info.orcid.org/privacy-policy/)) | ORCID IDs from your notes |

When you give a photo by its address, that one address is downloaded.
If you put a web address in `photo` yourself rather than saving the image,
Obsidian loads it from that site whenever it shows the note. No other note
content is sent anywhere.

**Files:**
- **Reads:** notes in your people, events and places folders, your person
  template, and the research feed note.
- **Writes:**
  - the properties above, and the papers, collaborators and card sections,
    in person notes (a person note without properties gets the template's
    when you run **Update this person** on it);
  - new person notes from **Add person** or clicking a collaborator;
  - place notes in your places folder;
  - photos you add, in your photos folder;
  - the research feed note.
- **Nothing outside your vault** is read or written.

Scholar Atlas is free. OpenAlex and ORCID are free to use. An OpenAlex API key
is optional.

## Development

```sh
npm install
npm run dev            # rebuild main.js on every change
npm run build          # type-check and production build
npm test               # unit tests (Node 22.18+)
npm run lint           # ESLint with Obsidian's review rules
npm run install-vault -- "/path/to/vault"   # copy the build into a vault to try it
```

Source is in `src/`:

| File | Contents |
|---|---|
| `main.ts` | Plugin lifecycle and commands |
| `people.ts` | Reading and writing person notes and the feed, and click-to-create |
| `places.ts` | Institution, city and country notes |
| `sources.ts` | OpenAlex and ORCID requests |
| `profile.ts`, `papers.ts`, `photo.ts`, `card.ts`, `connections.ts`, `selector.ts`, `tagging.ts`, `countries.ts` | Pure logic and markdown rendering |
| `vocab.ts` | Methods and model-systems vocabulary, generated from neuro-labs-explorer by `scripts/generate-vocab.py` |
| `shrink-photo.ts` | Scaling photos down before saving |
| `settings.ts`, `add-person-modal.ts`, `set-photo-modal.ts`, `photo-picker.ts`, `card-view.ts`, `tag-suggest.ts` | UI (styles in `styles.css`) |

Tests are in `test/`:
- **Unit tests** cover the pure modules.
- **`people.test.ts`** runs the plugin's note updates end to end against an
  in-memory fake of the Obsidian API (`fake-obsidian.ts`, loaded via
  `register.mjs`). It uses made-up OpenAlex and ORCID responses
  (`fixtures.ts`), so it needs no network.

### Releasing

1. Run `npm version patch` (or `minor` / `major`). This bumps `package.json`,
   `manifest.json` and `versions.json`, commits and tags.
2. Run `git push --follow-tags`.
3. The release workflow builds, tests and lints. It then creates a **draft**
   GitHub release with `main.js`, `manifest.json` and `styles.css` attached,
   plus build provenance attestations.
4. Review the draft on GitHub and publish it.

## License

[MIT](LICENSE)
