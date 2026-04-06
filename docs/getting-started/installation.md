# Installation and updates

Clawterm ships pre-built binaries for macOS (Apple Silicon and Intel) and Windows (x64). Linux users can build from source.

## macOS

One-liner installer (downloads the latest DMG, verifies the SHA-256 checksum against the release's `SHA256SUMS.txt`, copies `Clawterm.app` into `/Applications`, and clears the quarantine flag):

```bash
curl -fsSL https://raw.githubusercontent.com/clawterm/clawterm/main/install.sh | bash
```

If you'd rather install by hand, download the right DMG for your Mac from the [latest release](https://github.com/clawterm/clawterm/releases/latest):

- Apple Silicon → `Clawterm_<version>_aarch64.dmg`
- Intel → `Clawterm_<version>_x64.dmg`

Mount the DMG and drag `Clawterm.app` into `/Applications`.

> **Gatekeeper note:** Clawterm is not yet Apple-notarized. If macOS refuses to launch it, clear the quarantine flag once:
>
> ```bash
> xattr -cr /Applications/Clawterm.app
> ```
>
> Tracking issue: [#378](https://github.com/clawterm/clawterm/issues/378).

## Windows

```powershell
irm https://raw.githubusercontent.com/clawterm/clawterm/main/install.ps1 | iex
```

The script downloads the latest `Clawterm_<version>_x64-setup.exe`, verifies the SHA-256 checksum, and runs the installer.

You can also download the installer manually from the [latest release](https://github.com/clawterm/clawterm/releases/latest).

> **SmartScreen note:** Clawterm is not yet Authenticode-signed. Windows may show a SmartScreen warning the first time you run the installer. Click **More info → Run anyway**. Tracking issue: [#379](https://github.com/clawterm/clawterm/issues/379).

## Linux (build from source)

There is no pre-built Linux binary yet. To build it yourself:

```bash
git clone https://github.com/clawterm/clawterm.git
cd clawterm
npm install
npm run tauri build
```

Requirements:

- [Rust](https://rustup.rs/)
- [Node.js](https://nodejs.org/) 18+
- Tauri system dependencies — see the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/) for your distro

The built binary lands in `src-tauri/target/release/`.

## Verifying checksums manually

Every release publishes a `SHA256SUMS.txt` alongside the binaries. To verify a download by hand:

**macOS / Linux:**

```bash
shasum -a 256 -c SHA256SUMS.txt --ignore-missing
```

**Windows (PowerShell):**

```powershell
Get-FileHash -Algorithm SHA256 .\Clawterm_1.1.1_x64-setup.exe
# Compare the hash against the matching line in SHA256SUMS.txt
```

The one-liner installers above do this automatically and abort on mismatch.

## Updates

Clawterm checks for updates automatically once an hour by default. When a new version is available, a dialog appears with the release notes and an **Install** button.

Update behaviour is controlled by the `updates` section in `config.json` — see [configuration.md → updates](../reference/configuration.md#updates) for the full schema. Summary:

- `updates.autoCheck` — turn auto-checking on or off
- `updates.checkIntervalMs` — how often to poll (5 minutes to 24 hours)
- `updates.autoInstall` — silently install updates without prompting

You can also trigger a manual update check from the settings page.

### Re-running the install script

Running the same one-liner again performs an in-place upgrade:

```bash
curl -fsSL https://raw.githubusercontent.com/clawterm/clawterm/main/install.sh | bash
```

If the installed version already matches the latest release, the script exits without doing any work.

## Uninstalling

**macOS:**

```bash
curl -fsSL https://raw.githubusercontent.com/clawterm/clawterm/main/install.sh | bash -s -- --uninstall
```

This removes `/Applications/Clawterm.app` and prompts before deleting `~/.config/clawterm` (so your config survives unless you say otherwise).

**Windows:**

```powershell
irm https://raw.githubusercontent.com/clawterm/clawterm/main/install.ps1 | iex -ArgumentList '--uninstall'
```

Or uninstall from **Settings → Apps** like any other Windows app. The config at `%APPDATA%\clawterm` is left in place unless you remove it manually.

**Manual cleanup paths:**

| Platform | App | Config |
| --- | --- | --- |
| macOS | `/Applications/Clawterm.app` | `~/.config/clawterm/` |
| Windows | Uninstalled via Add/Remove Programs | `%APPDATA%\clawterm\` |
| Linux | Wherever you put the binary | `~/.config/clawterm/` |
