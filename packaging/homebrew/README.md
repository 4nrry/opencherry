# Homebrew packaging (Cask)

`opencherry.rb` is a Homebrew **Cask** (OpenCherry is a GUI `.dmg` app, not a
CLI). Once the tap is set up, macOS users can:

```sh
brew install --cask 4nrry/tap/opencherry
```

## How publishing works

The **Homebrew job in `.github/workflows/release-macos.yml`** runs on a `v*` tag
(after both `.dmg` builds finish) and:

1. reads the per-arch `.dmg` `sha256` checksums from the published release,
2. `sed`s `version` + both `sha256` values into a copy of `opencherry.rb`,
3. pushes the rendered cask to `Casks/opencherry.rb` in the tap repo.

The job is **gated** and does nothing unless `vars.PUBLISH_HOMEBREW == 'true'`,
so it never breaks a release before the one-time setup below is done.

## One-time maintainer setup

1. **Create a public tap repo** named `4nrry/homebrew-tap` with a `Casks/`
   directory. (The `homebrew-` prefix is what lets `brew tap 4nrry/tap` resolve
   it.)

2. **Token for CI** — create a fine-grained Personal Access Token with
   `Contents: read and write` scoped to `4nrry/homebrew-tap`, and add it as a
   GitHub Actions repository secret named `HOMEBREW_TAP_TOKEN`.

3. **Repository variable**: `PUBLISH_HOMEBREW` = `true`.

After that, every `git tag vX.Y.Z` push updates the cask.

## Notes

- The app is **unsigned and not notarized**. The cask does **not** silently
  disable Gatekeeper quarantine; instead its `caveats` tell users to right-click
  → Open (or run `xattr -dr com.apple.quarantine …`) on first launch.
- Verify the `.app` bundle name (`app "opencherry.app"`) and the `.dmg` arch
  suffix (`_x64` vs `_x86_64`) against a real macOS build before the first tag —
  Tauri derives both from `productName` (lowercase `opencherry`).
