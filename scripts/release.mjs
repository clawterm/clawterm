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
 *   9. Commits all changes
 *  10. Runs preflight checks (lint, format, test, typecheck)
 *  11. Tags the release
 *  12. Pushes to origin with tags
 *
 * If preflight fails, the commit is reset and the user can fix & re-run.
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
if (status) {
  die("Working tree is not clean. Commit or stash your changes first.");
}

console.log("  ✓ Clean working tree on main\n");

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
run("cargo check", { cwd: "src-tauri", stdio: "pipe" });
console.log("  ✓ Cargo.lock\n");

// ── Step 7: Format ─────────────────────────────────────────────────────────

console.log("Formatting...");
run("npm run format", { stdio: "pipe" });
console.log("  ✓ Code formatted\n");

// ── Step 8: Commit ─────────────────────────────────────────────────────────

console.log("Committing...");
run(
  `git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json CHANGELOG.md`,
);
run(
  `git commit -m "Bump version to ${newVersion} and update CHANGELOG"`,
);
console.log();

// ── Step 9: Preflight checks ──────────────────────────────────────────────

console.log("Running preflight checks...");
try {
  run("npm run preflight");
} catch {
  console.error("\n✗ Preflight checks failed. Resetting commit...");
  execSync("git reset HEAD~1", { stdio: "inherit" });
  die(
    "Fix the issues above, re-stage your changes, and run the release script again.",
  );
}
console.log("  ✓ All checks passed\n");

// ── Step 10: Tag ───────────────────────────────────────────────────────────

console.log("Tagging...");
run(`git tag v${newVersion}`);
console.log();

// ── Step 11: Push ──────────────────────────────────────────────────────────

console.log("Pushing...");
run("git push origin main --tags");

console.log(`\n✓ Released v${newVersion}!`);
console.log(`  GitHub Actions will build and publish the release.`);
console.log(
  `  Track progress: https://github.com/clawterm/clawterm/actions\n`,
);
