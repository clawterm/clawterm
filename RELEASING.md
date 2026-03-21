# Releasing

## Version Numbering

We use [semver](https://semver.org/): patch for bug fixes, minor for features, major for breaking changes.

## How to Release

1. Add your changes under `## [Unreleased]` in `CHANGELOG.md`
2. Run the release script:
   ```bash
   node scripts/release.mjs patch   # bug fix (0.9.1 → 0.9.2)
   node scripts/release.mjs minor   # new feature (0.9.1 → 0.10.0)
   node scripts/release.mjs major   # breaking change (0.9.1 → 1.0.0)
   ```
3. Wait for [GitHub Actions](https://github.com/clawterm/clawterm/actions) to build and publish

The script handles everything: version bumping, CHANGELOG formatting, lock files, code formatting, preflight checks, tagging, and pushing. If preflight fails, it resets the commit so you can fix and re-run.

## Code Signing

### macOS (Apple)

The release workflow signs and notarizes macOS builds when these repository secrets are set:

| Secret | Description |
|--------|-------------|
| `APPLE_CERTIFICATE` | Base64-encoded `.p12` certificate |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the `.p12` file |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Name (TEAM_ID)` |
| `APPLE_ID` | Apple ID email |
| `APPLE_PASSWORD` | App-specific password from appleid.apple.com |
| `APPLE_TEAM_ID` | 10-character team identifier |

### Windows (Authenticode)

The release workflow signs Windows NSIS installers when these repository secrets are set:

| Secret | Description |
|--------|-------------|
| `WINDOWS_CERTIFICATE` | Base64-encoded `.pfx` certificate |
| `WINDOWS_CERTIFICATE_PASSWORD` | Password for the `.pfx` file |

Without these secrets, builds still work but are unsigned on both platforms.
