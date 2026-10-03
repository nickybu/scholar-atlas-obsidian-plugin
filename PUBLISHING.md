# Before publishing

A checklist for the first submission to the Obsidian community directory.
Nothing here has been published yet.

## Fill in

- [ ] `LICENSE`: replace `YOUR NAME` in the copyright line.
- [ ] `manifest.json`: replace `"author": "YOUR NAME"`. Optionally add
      `"authorUrl"` (e.g. your GitHub profile) and `"fundingUrl"`.
- [ ] `README.md`: optionally add a screenshot or GIF of adding a person.

## Check

- [ ] `npm run build && npm test && npm run lint` all pass with no warnings.
- [ ] Try the build in a real vault (`npm run install-vault -- "/path/to/vault"`):
  - [ ] Add a person by name only, by ORCID, and by OpenAlex ID.
  - [ ] Update this person, update all, and refresh locations.
  - [ ] Write `openalex: none` on someone with no ORCID.
  - [ ] Set photo: paste, drop, choose a file, and use an image link. Then
        clear `photo` and type a link into it by hand. The embed should follow.
  - [ ] Add person with *Met at* (pick a suggestion, and type a new name) and
        a photo. Check the preview, **Remove photo**, and that Enter in the
        link field uses the link rather than adding the person.
  - [ ] Check a large phone photo is saved at about 512 px and under 200 KB.
  - [ ] Turn off Wi-Fi and run **Update all people**: it should stop within
        a few seconds with a clear message.
  - [ ] Run **Update all people** twice: the second run should take a
        second or two and change nothing.
  - [ ] Place notes: check their **People** base views list the right people
        (here now, here before, collaborators, lives here).
  - [ ] Click a co-author with no note, then an institution and a country:
        each note should be created and filled in.
  - [ ] Profile card: it renders at the top of a person note in reading view
        and Live Preview, with the photo, and updates as soon as you change a
        property.
  - [ ] Graph view: a person's local graph shows their institutions, city,
        country, collaborators and PI.
  - [ ] In the vault's People base, check the **Visiting** and **Local to this
        event** views still work now that `city` is a link.
  - [ ] Turn off "Show existing files only" in the graph to see collaborators
        and places without notes yet.
  - [ ] Settings: change the people folder, template and feed note. Set the
        API key secret.
  - [ ] Check mobile if possible. `isDesktopOnly` is `false`, and only
        Obsidian's own APIs are used.
- [ ] `manifest.json` `version` matches `versions.json` and `package.json`.
- [ ] The `id` (`scholar-atlas`) is final: it can never change after
      publishing.

## Release and submit

1. Commit and push to `main` (or the repo's default branch). The directory
   reads `manifest.json` from the HEAD of the default branch.
2. Run `npm version <x.y.z>` (or `patch` / `minor`), then
   `git push --follow-tags`. The release workflow creates a draft release
   with `main.js`, `manifest.json` and `styles.css` attached and build
   attestations.
3. Review and publish the draft release on GitHub.
4. Sign in at [community.obsidian.md](https://community.obsidian.md), link your
   GitHub account, and add the plugin.
5. Fix anything the automated review flags, then publish a new release with
   a higher version.
6. Mark it as **Free** in the directory listing.
