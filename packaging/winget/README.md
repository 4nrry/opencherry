# winget packaging (Windows Package Manager)

OpenCherry can be published to [winget](https://learn.microsoft.com/windows/package-manager/).
Packages are YAML manifests submitted as pull requests to
[`microsoft/winget-pkgs`](https://github.com/microsoft/winget-pkgs); an automated
check validates each PR (including running the installer in Windows Sandbox).

Once published, Windows users can:

```powershell
winget install 4nrry.OpenCherry
```

## How publishing works

The **`publish-winget` job in `.github/workflows/release-windows.yml`** runs on a
`v*` tag and uses [`vedantmgoyal9/winget-releaser`](https://github.com/vedantmgoyal9/winget-releaser)
(Komac under the hood) to generate the manifest from the release's `.exe` and open
a PR to `microsoft/winget-pkgs`.

The job is **gated** and does nothing unless `vars.PUBLISH_WINGET == 'true'`, so it
never breaks a release before the one-time setup below is done.

> The installer is **unsigned**. winget accepts unsigned packages, but Windows
> SmartScreen warns on first run (already noted in the README).

## One-time maintainer setup

1. **First version must exist in winget before automation works** — `winget-releaser`
   only *updates* an existing package. Submit the first version manually from a
   Windows machine:

   ```powershell
   winget install wingetcreate
   wingetcreate new https://github.com/4nrry/opencherry/releases/download/v0.0.1/opencherry_0.0.1_x64-setup.exe
   # fill the prompts (publisher 4nrry, name OpenCherry, license AGPL-3.0-or-later);
   # it computes the SHA-256 and detects InstallerType=nullsoft (NSIS).
   # add --submit (with a GitHub token) to open the PR to microsoft/winget-pkgs.
   ```

   This registers the `PackageIdentifier` `4nrry.OpenCherry`. Wait for the PR to
   be validated and merged.

2. **Fork** `microsoft/winget-pkgs` under the `4nrry` account (the action pushes to
   your fork and opens the PR). If the fork lives under a different account, set the
   `fork-user` input on the job.

3. **Token** — create a **classic** Personal Access Token with `public_repo` scope
   (fine-grained PATs are not supported) and add it as the repository secret
   `WINGET_TOKEN`.

4. **Repository variable**: `PUBLISH_WINGET` = `true`.

After that, every `git tag vX.Y.Z` push opens an update PR to winget-pkgs.

## Notes

- `PackageIdentifier` follows `Publisher.Package` → `4nrry.OpenCherry`.
- `installers-regex: '\.exe$'` matches the NSIS installer (and skips the `.sha256`).
- `release-tag` is pinned to the pushed tag so the job resolves the right release
  even though it runs from a tag-push (not a `release` event).
