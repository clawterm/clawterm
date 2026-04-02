#!/usr/bin/env node
/**
 * Automated release pipeline for Clawterm.
 *
 * Usage:
 *   node scripts/release.mjs patch   # 0.9.1 → 0.9.2
 *   node scripts/release.mjs minor   # 0.9.1 → 0.10.0
 *   node scripts/release.mjs major   # 0.9.1 → 1.0.0
 *   node scripts/release.mjs 1.2.3   # set explicit version
 *
 * What it does (in order):
 *   1. Validates clean git working tree and main branch
 *   2. Validates CHANGELOG [Unreleased] section has content
 *   3. Bumps version in package.json, Cargo.toml, tauri.conf.json
 *   4. Moves [Unreleased] content into new version section with today's date
 *   5. Updates CHANGELOG compare links
 *   6. Runs npm install (update package-lock.json)
 *   7. Runs cargo check in src-tauri (update Cargo.lock)
 *   8. Runs npm run format
 *   9. Runs preflight checks (lint, format, test, typecheck) — BEFORE commit
 *  10. Commits all changes
 *  11. Tags the release (idempotent — skips if tag exists)
 *  12. Pushes to origin with tags (idempotent — skips if already pushed)
 *
 * If preflight fails, no commit exists — just fix and re-run.
 */

import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

// ── Helpers ────────────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  return execSync(cmd, { stdio: "inherit", ...opts });
}

function runCapture(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

function die(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

function today() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ── Version helpers ────────────────────────────────────────────────────────

const VERSION_FILES = [
  { path: "package.json", pattern: /"version":\s*"[^"]+"/, template: (v) => `"version": "${v}"` },
  {
    path: "src-tauri/Cargo.toml",
    pattern: /^version\s*=\s*"[^"]+"/m,
    template: (v) => `version = "${v}"`,
  },
  {
    path: "src-tauri/tauri.conf.json",
    pattern: /"version":\s*"[^"]+"/,
    template: (v) => `"version": "${v}"`,
  },
];

function currentVersion() {
  return JSON.parse(readFileSync("package.json", "utf8")).version;
}

function increment(version, part) {
  const [major, minor, patch] = version.split(".").map(Number);
  switch (part) {
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "major":
      return `${major + 1}.0.0`;
    default:
      throw new Error(`Unknown increment: ${part}`);
  }
}

function bumpVersionFiles(newVersion) {
  for (const file of VERSION_FILES) {
    const content = readFileSync(file.path, "utf8");
    const updated = content.replace(file.pattern, file.template(newVersion));
    if (updated === content) {
      die(`No version match in ${file.path}`);
    }
    writeFileSync(file.path, updated);
    console.log(`  ✓ ${file.path}`);
  }
}

// ── CHANGELOG helpers ──────────────────────────────────────────────────────

function updateChangelog(oldVersion, newVersion) {
  let content = readFileSync("CHANGELOG.md", "utf8");

  // Extract [Unreleased] content (between ## [Unreleased] and the next ## [...])
  const unreleasedMatch = content.match(
    /## \[Unreleased\]\s*\n([\s\S]*?)(?=\n## \[)/,
  );
  const unreleasedContent = unreleasedMatch ? unreleasedMatch[1].trim() : "";

  if (!unreleasedContent) {
    die(
      "CHANGELOG [Unreleased] section is empty.\nWrite your changelog entry under ## [Unreleased] before releasing.",
    );
  }

  // Replace [Unreleased] section: keep the header, clear the content, insert new version section
  content = content.replace(
    /## \[Unreleased\]\s*\n[\s\S]*?(?=\n## \[)/,
    `## [Unreleased]\n\n## [${newVersion}] - ${today()}\n\n${unreleasedContent}\n\n`,
  );

  // Update compare links at the bottom
  // Update [Unreleased] link to compare from new version
  content = content.replace(
    /\[Unreleased\]:\s*https:\/\/github\.com\/[^/]+\/[^/]+\/compare\/v[^.]+\.[^.]+\.[^.]+\.\.\.HEAD/,
    `[Unreleased]: https://github.com/clawterm/clawterm/compare/v${newVersion}...HEAD`,
  );

  // Add new version compare link after [Unreleased] link
  const newLink = `[${newVersion}]: https://github.com/clawterm/clawterm/compare/v${oldVersion}...v${newVersion}`;
  content = content.replace(
    /(\[Unreleased\]:.*\n)/,
    `$1${newLink}\n`,
  );

  writeFileSync("CHANGELOG.md", content);
  console.log("  ✓ CHANGELOG.md");
}

// ── Main ───────────────────────────────────────────────────────────────────

const arg = process.argv[2];
if (!arg) {
  console.error(
    "Usage: node scripts/release.mjs <patch|minor|major|X.Y.Z>",
  );
  process.exit(1);
}

const oldVersion = currentVersion();
const newVersion = /^\d+\.\d+\.\d+$/.test(arg) ? arg : increment(oldVersion, arg);

console.log(`\nReleasing ${oldVersion} → ${newVersion}\n`);

// ── Step 1: Validate git state ─────────────────────────────────────────────

console.log("Validating git state...");

const branch = runCapture("git branch --show-current");
if (branch !== "main") {
  die(`Must be on main branch (currently on "${branch}")`);
}

const status = runCapture("git status --porcelain");
const dirtyFiles = status
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);
const nonChangelogDirty = dirtyFiles.filter(
  (l) => !l.endsWith("CHANGELOG.md"),
);
if (nonChangelogDirty.length > 0) {
  die(
    `Working tree has uncommitted changes (besides CHANGELOG.md):\n${nonChangelogDirty.join("\n")}`,
  );
}

console.log("  ✓ Working tree clean (CHANGELOG.md edits OK)\n");

// ── Step 2: Validate CHANGELOG has unreleased content ──────────────────────

console.log("Checking CHANGELOG...");

const changelogContent = readFileSync("CHANGELOG.md", "utf8");
const unreleasedCheck = changelogContent.match(
  /## \[Unreleased\]\s*\n([\s\S]*?)(?=\n## \[)/,
);
if (!unreleasedCheck || !unreleasedCheck[1].trim()) {
  die(
    "CHANGELOG [Unreleased] section is empty.\nWrite your changelog entry under ## [Unreleased] before releasing.",
  );
}
console.log("  ✓ [Unreleased] section has content\n");

// ── Step 3: Bump versions ──────────────────────────────────────────────────

console.log("Bumping versions...");
bumpVersionFiles(newVersion);
console.log();

// ── Step 4-5: Update CHANGELOG ─────────────────────────────────────────────

console.log("Updating CHANGELOG...");
updateChangelog(oldVersion, newVersion);
console.log();

// ── Step 6: Update npm lock file ───────────────────────────────────────────

console.log("Updating lock files...");
run("npm install --ignore-scripts", { stdio: "pipe" });
console.log("  ✓ package-lock.json");
try {
  run("cargo generate-lockfile", { cwd: "src-tauri", stdio: "pipe" });
} catch {
  die(
    "Failed to update Cargo.lock — is Rust installed?\n" +
      "  Check: rustup show\n" +
      "  Install: https://rustup.rs",
  );
}
console.log("  ✓ Cargo.lock\n");

// ── Step 7: Format ─────────────────────────────────────────────────────────

console.log("Formatting...");
run("npm run format", { stdio: "pipe" });
console.log("  ✓ Code formatted\n");

// ── Step 8: Preflight checks (BEFORE commit — fail early, nothing to reset)

console.log("Running preflight checks...");
try {
  run("npm run preflight");
} catch {
  die(
    "Preflight checks failed. Fix the issues above and run the release script again.\n" +
      "  Version files have been bumped but NOT committed — you can edit freely.",
  );
}
console.log("  ✓ All checks passed\n");

// ── Step 9: Commit ─────────────────────────────────────────────────────────

console.log("Committing...");
// Stage version bump files + any source files that were reformatted
run(
  `git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json CHANGELOG.md`,
);
run(`git add -u src/`, { stdio: "pipe" }); // pick up any Prettier changes
run(
  `git commit -m "Bump version to ${newVersion} and update CHANGELOG"`,
);
console.log();

// ── Step 10: Tag (with idempotency guard) ─────────────────────────────────

console.log("Tagging...");
const existingTag = runCapture(`git tag -l v${newVersion}`);
if (existingTag) {
  console.log(`  Tag v${newVersion} already exists, skipping\n`);
} else {
  run(`git tag v${newVersion}`);
  console.log();
}

// ── Step 11: Verify GitHub secrets ──────────────────────────────────────────

console.log("Checking GitHub secrets...");
try {
  const secretsJson = runCapture("gh secret list --json name -q '.[].name'");
  const secrets = secretsJson.split("\n").map((s) => s.trim()).filter(Boolean);
  const required = ["TAURI_SIGNING_PRIVATE_KEY", "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"];
  const missing = required.filter((s) => !secrets.includes(s));
  if (missing.length > 0) {
    die(
      `Missing GitHub secrets: ${missing.join(", ")}\n` +
        `  Configure them at: https://github.com/clawterm/clawterm/settings/secrets/actions`,
    );
  }
  console.log("  ✓ Required secrets configured\n");
} catch (e) {
  if (e.message?.includes("Missing GitHub secrets")) throw e;
  console.log("  ⚠ Could not verify secrets (gh CLI not available) — proceeding\n");
}

// ── Step 12: Push (with idempotency guard) ────────────────────────────────

console.log("Pushing...");
const remoteTag = runCapture(
  `git ls-remote --tags origin refs/tags/v${newVersion}`,
);
if (remoteTag) {
  console.log(`  v${newVersion} already pushed to remote`);
} else {
  run("git push origin main --tags");
}

console.log(`\n✓ Released v${newVersion}!`);
console.log(`  GitHub Actions will build and publish the release.`);
console.log(
  `  Track progress: https://github.com/clawterm/clawterm/actions\n`,
);
