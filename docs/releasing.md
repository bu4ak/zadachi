# Releasing Zadachi

Use `master` as the default branch on GitHub. Prepare releases from `master`.

1. Set the same version in `manifest.json` and `package.json`, refresh `package-lock.json`, and record the minimum Obsidian version in `versions.json`.
2. With Node.js 24, run `npm ci`, `npm test`, and `npm run build` from a clean checkout. Smoke-test the build in a separate vault with sample tasks.
3. Tag the verified commit with the exact version, for example `1.0.2`. Wait for `check` and `attest-release` to pass in GitHub Actions.
4. Create a GitHub Release for that tag. Attach `main.js`, `manifest.json`, and `styles.css` from the `zadachi-release` artifact. Use those exact files so their digests match the attestations.
5. Submit to the Obsidian community directory separately, after the public release is available and compatibility is verified.

Keep sample media in `docs/media/` and keep personal vault data, local settings, and generated `main.js` out of Git.

[Obsidian plugin release guide](https://docs.obsidian.md/plugins/releasing/submit-plugin)
