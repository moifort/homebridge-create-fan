# Project: homebridge-create-ceiling-fan

Homebridge plugin to control CREATE Ceiling Fans (Tuya-based) from HomeKit.

## Build & Test

```bash
npm run build    # TypeScript compilation (rimraf ./dist && tsc)
npm run lint     # ESLint
```

## Release Workflow

CI publishes to npm automatically on tag push (`v*`). Never run `npm publish` locally.

When releasing a new version:

1. Bump version in `package.json`
2. Update `CHANGELOG.md` with the new version's changes
3. Update `README.md` if the change affects configuration or usage
4. Commit: `chore(release): vX.Y.Z`
5. Tag: `git tag vX.Y.Z`
6. Push: `git push origin master --tags`
7. Create a GitHub release (`gh release create vX.Y.Z`) with the changelog entry as the release notes
