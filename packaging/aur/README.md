# AUR packaging (`opencherry-bin`)

This directory holds the `PKGBUILD` for the [AUR](https://aur.archlinux.org)
package `opencherry-bin`. It installs the published `.AppImage` release asset,
so Arch users can:

```sh
yay -S opencherry-bin     # or: paru -S opencherry-bin
```

## How publishing works

The **AUR job in `.github/workflows/release-linux.yml`** runs on a `v*` tag and:

1. reads the x86_64 AppImage `sha256` checksum from the just-published release,
2. `sed`s `pkgver` + the `sha256sums` value into this `PKGBUILD`,
3. pushes it to the AUR via `KSXGitHub/github-actions-deploy-aur`
   (which regenerates `.SRCINFO`).

The job is **gated** and does nothing unless `vars.PUBLISH_AUR == 'true'`, so it
never breaks a release before the one-time setup below is done.

## One-time maintainer setup

1. **Create the AUR package repo** (requires an AUR account):

   ```sh
   git clone ssh://aur@aur.archlinux.org/opencherry-bin.git
   # add this PKGBUILD + a generated .SRCINFO, then push once to register it
   ```

2. **SSH key for CI** — generate a dedicated keypair, add the **public** key to
   your AUR account (Account → SSH Public Key), and add the **private** key as a
   GitHub Actions repository secret named `AUR_SSH_PRIVATE_KEY`.

3. **Repository variables** (Settings → Secrets and variables → Actions →
   Variables):
   - `PUBLISH_AUR` = `true`
   - `AUR_COMMIT_USERNAME` = your AUR username
   - `AUR_COMMIT_EMAIL` = the email tied to your AUR account

After that, every `git tag vX.Y.Z` push publishes the updated package.

## Notes

- `options=('!strip')` is required — stripping corrupts an AppImage.
- `depends=('fuse2' …)` because AppImages need FUSE at runtime.
- `provides`/`conflicts` use the binary name `opencherry`.
