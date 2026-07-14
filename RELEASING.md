# Releasing GhostPilot

GhostPilot ships as a tagged-but-not-uploaded release — users who want a
stable line clone the repo and check out a `vX.Y.Z` tag. The DMG in
`release/` is built locally on demand (`pnpm dist`) and is not currently
published as a GitHub Release asset.

## Pre-flight

- Working tree clean (`git status` shows no uncommitted changes)
- All tests green:
  ```bash
  pnpm typecheck
  pnpm test:unit
  pnpm test:integration
  ```
- `README.md` + `CHANGELOG.md` reflect the new version
- `assets/notices.json` up to date if `dependencies` changed
  (`pnpm assets:licenses`)

## Cut a release

1. **Bump `version` in `package.json`** following semver (see guidance
   below). Stage it.
2. **Update `CHANGELOG.md`**: move everything currently under
   `## [Unreleased]` into a new `## [X.Y.Z] — YYYY-MM-DD` section, then
   leave an empty `## [Unreleased]` at the top for the next cycle.
3. **Commit** the bump + changelog together:
   ```bash
   git add package.json CHANGELOG.md
   git commit -m "release: vX.Y.Z — <short description>"
   ```
4. **Annotated tag** on that commit:
   ```bash
   git tag -a vX.Y.Z -m "GhostPilot vX.Y.Z — <short description>"
   ```
5. **Push** both the commit and the tag in one go:
   ```bash
   git push origin main --tags
   ```
6. **Verify** the tag landed on GitHub:
   ```bash
   git ls-remote --tags origin | grep vX.Y.Z
   ```
   Then visit `https://github.com/tlejay/ghostpilot/releases/tag/vX.Y.Z`.

## Optional — formal GitHub Release object

If you want a richer landing page (release notes rendered, downloadable
assets) instead of the bare tag page, create a Release after pushing:

```bash
gh release create vX.Y.Z \
    --title "GhostPilot vX.Y.Z" \
    --notes-from-tag
```

Attach the locally built DMG with `gh release upload vX.Y.Z release/*.dmg`
if you want users to grab a prebuilt binary. Otherwise the tag alone is
enough — users clone + `pnpm install && pnpm build`.

## Semver guidance

GhostPilot's public contract is its **MCP tool surface** — the set of
registered tools and their input/output schemas. Versioning is judged
against that, not against internal refactors.

- **PATCH** (`vX.Y.Z+1`) — Bug fixes, internal refactors, doc-only
  changes. No tool added, removed, or schema-changed.
- **MINOR** (`vX.Y+1.0`) — New MCP tools, new optional input fields, new
  config env vars. Backwards compatible: existing callers keep working
  with no edits.
- **MAJOR** (`vX+1.0.0`) — Breaking changes to the tool surface:
  tool renamed, tool removed, required-field added to an existing
  schema, response shape changed in a non-additive way. Bump major and
  call it out at the top of the CHANGELOG section.

When unsure, **prefer minor over patch** — readers should be able to
trust that `vX.Y.Z` → `vX.Y.Z+1` introduces no new surface.

## Why we tag

- Pinning: `cd ghostpilot && git checkout v0.4.0 && pnpm install && pnpm dev`
  reproduces the exact tool surface from that release.
- Bisecting: `git bisect` between two tags narrows regressions fast.
- Rollback: a Mint/mbt-store-bot workflow that breaks on `main` can be
  unblocked by checking out the last green tag while the bug is fixed.

## Tag/commit hygiene

- Tags are **annotated** (`git tag -a`), never lightweight, so they carry
  their own message + date.
- The release commit touches only `package.json` + `CHANGELOG.md`
  (and `RELEASING.md` when this doc itself changes). No feature work
  rides in a release commit.
- Never re-point an existing tag. If a tag turns out to be broken, cut
  the next patch instead.
