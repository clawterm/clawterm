/**
 * Pure computation functions extracted from Tab for testability.
 * These handle adaptive idle detection and working-state inference.
 */

/** Regex patterns that indicate an agent is still actively working.
 *  Matched against the last few terminal lines when the output goes quiet. */
export const AGENT_WORKING_RE =
  // Claude Code spinners (Braille dots used in the TUI spinner)
  /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]|Thinking|Running\s|Reading\s|Writing\s|Searching\s|Editing\s|Compiling|Building|Testing|Installing|Downloading|Uploading|Analyzing|Generating|Processing|Fetching|Cloning|Pushing|Pulling|Resolving|Bundling|Linking|Loading|Scanning|Indexing|Formatting|\.\.\.\s*$/i;

/** Default constants for adaptive idle detection */
export const IDLE_DEFAULTS = {
  /** Minimum adaptive agent idle timeout (ms) */
  MIN_MS: 15_000,
  /** Maximum adaptive agent idle timeout (ms) */
  MAX_MS: 60_000,
  /** Default when insufficient output gap data */
  DEFAULT_MS: 20_000,
  /** Minimum number of output gaps needed for adaptive calculation */
  MIN_GAPS: 5,
} as const;

/**
 * Compute an adaptive idle timeout based on observed output gaps.
 * Uses the 95th percentile of recent gaps × 2, clamped to safe bounds.
 * Falls back to a conservative default when insufficient data is available.
 */
export function computeAdaptiveTimeout(
  gaps: number[],
  opts: { minMs?: number; maxMs?: number; defaultMs?: number; minGaps?: number } = {},
): number {
  const minMs = opts.minMs ?? IDLE_DEFAULTS.MIN_MS;
  const maxMs = opts.maxMs ?? IDLE_DEFAULTS.MAX_MS;
  const defaultMs = opts.defaultMs ?? IDLE_DEFAULTS.DEFAULT_MS;
  const minGaps = opts.minGaps ?? IDLE_DEFAULTS.MIN_GAPS;

  if (gaps.length < minGaps) return defaultMs;

  const sorted = [...gaps].sort((a, b) => a - b);
  const p95Index = Math.floor(sorted.length * 0.95);
  const p95 = sorted[Math.min(p95Index, sorted.length - 1)];

  return Math.max(minMs, Math.min(p95 * 2, maxMs));
}

/**
 * Check whether terminal buffer lines indicate an agent is actively working.
 * Returns true if any working patterns (spinners, tool messages, progress) are found.
 */
export function hasWorkingPatterns(lines: string[]): boolean {
  if (lines.length === 0) return false;
  return AGENT_WORKING_RE.test(lines.join("\n"));
}
