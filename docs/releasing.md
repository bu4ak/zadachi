# Releasing Zadachi

Use `master` as the default branch on GitHub. Prepare releases from `master`.

1. Set the same version in `manifest.json` and `package.json`, refresh `package-lock.json`, and record the minimum Obsidian version in `versions.json`.
2. With Node.js 24, run `npm ci`, `npm test`, and `npm run build` from a clean checkout. Smoke-test the build in a separate vault with sample tasks.
3. Merge the pull request into `master`. Tag the merged commit with the exact manifest version, for example `1.0.3`, and push the tag.
4. GitHub Actions tests and builds the tagged commit, attests its output, and publishes a GitHub Release with `main.js`, `manifest.json`, and `styles.css`.
5. Check the published release and its review status in the Obsidian community directory.

Keep sample media in `docs/media/` and keep personal vault data, local settings, and generated `main.js` out of Git.

[Obsidian plugin release guide](https://docs.obsidian.md/plugins/releasing/submit-plugin)
