# Releases and automatic updates

The Windows app updates itself from **GitHub Releases** of `kritay1818/adaptive` (public repo). The app contains no token.

## Publishing a version

1. Raise `version` in `package.json` (for example `0.1.3`) and commit.
2. `git tag v0.1.3 && git push origin v0.1.3`

The tag must equal `v` + the `package.json` version (the workflow fails otherwise). The workflow
(`.github/workflows/release-windows.yml`) runs the tests, builds, and publishes a normal (not draft) release with:

- `ADActive-Setup-<version>.exe` – the installer (this is what auto-update installs)
- `ADActive-Setup-<version>.exe.blockmap` – lets the updater download only the changed parts
- `latest.yml` – the update feed the app reads (version, file name, hash)
- `ADActive-<version>-portable.exe` – portable build, for manual download

It uses the built-in `GITHUB_TOKEN`. No personal token and no secret is needed. Do not delete `latest.yml` or the
blockmap from a release, and do not publish a release as draft or pre-release: the app ignores those.

## How the app behaves

- Checks ~20 s after start and every 6 hours; downloads in the background (`src/updater.cjs`).
- When ready, the chat window shows "גרסה חדשה מוכנה — להפעיל מחדש?" (הפעלה מחדש עכשיו / אחר כך).
  It never restarts on its own, and neither the question nor the restart is allowed while a task, a connection check or an
  approval card is in progress. "אחר כך" installs the update on the next normal quit.
- The "⋯" menu shows the version and "בדיקת עדכונים".
- Failures (offline, GitHub down) are logged to the diagnostics log; the user sees them only under "פרטים טכניים" after a
  manual check. They never block the app.
- The portable exe cannot replace itself, so it does not auto-update. Dev runs (`npm start`) do not check.

## Code signing (not set up yet)

Until a certificate exists the installer is **unsigned**: Windows SmartScreen may warn on install and on update.
The place to add it:

1. Repository secrets `WIN_CSC_LINK` (base64 `.pfx` or https URL) and `WIN_CSC_KEY_PASSWORD`. The workflow already signs
   automatically when `WIN_CSC_LINK` exists (see the "CODE SIGNING" comment in the workflow for the Azure Trusted Signing option).
2. After the first signed release, add the certificate's subject name to `package.json` →
   `build.win.signtoolOptions.publisherName` (for Azure: `build.win.azureSignOptions.publisherName`). The updater then
   refuses updates not signed by that publisher. **Do not add it while releases are unsigned**: updates would be rejected.
