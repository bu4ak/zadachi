# Releasing Zadachi

1. Set the same version in `manifest.json` and `package.json`; refresh `package-lock.json`. Update `versions.json` if the minimum Obsidian version changes.
2. With Node.js 24, run `npm ci`, `npm test`, and `npm run build` from a clean checkout. Smoke-test the build in a separate vault with sample tasks.
3. Tag the verified commit with the exact version, for example `1.0.0`. The GitHub Actions workflow checks the tag and saves a `zadachi-release` artifact with the individual files and an install ZIP. It does not publish a release.
4. When ready, create a GitHub Release for that tag. Attach `main.js`, `manifest.json`, and `styles.css` as separate files. Also attach `zadachi-1.0.0.zip` for manual installation. It contains the same files and `LICENSE` inside a `zadachi/` folder. Update the download names in both READMEs for future releases.
5. Submit to the Obsidian community directory separately, after the public release is available and compatibility is verified.

Keep sample media in `docs/media/` and keep personal vault data, local settings, and generated `main.js` out of Git.

[Obsidian plugin release guide](https://docs.obsidian.md/plugins/releasing/submit-plugin)
