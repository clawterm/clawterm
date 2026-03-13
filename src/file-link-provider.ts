import type { Terminal, ILinkProvider, ILink, IBufferRange } from "@xterm/xterm";
import { showToast } from "./toast";

/**
 * Custom xterm.js link provider that detects file paths in terminal output.
 * Clicking a path copies it to clipboard. Handles formats like:
 *   /Users/foo/bar.ts:42:5
 *   ./src/main.rs:10
 *   src/config.ts
 */

// Match file paths: absolute (/foo/bar.ext) or relative (./foo or dir/file.ext)
// with optional :line and :col suffixes
const FILE_PATH_RE =
  /((?:\/[\w.@+-]+)+\/[\w.@+-]+(?:\.\w+)?(?::\d+(?::\d+)?)?|(?:\.\/|[\w@-]+\/)[\w./@+-]*(?:\.\w+)(?::\d+(?::\d+)?)?)/g;

export class FileLinkProvider implements ILinkProvider {
  constructor(private terminal: Terminal) {}

  provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
    const line = this.getLineText(bufferLineNumber);
    if (!line) {
      callback(undefined);
      return;
    }

    const links: ILink[] = [];
    let match: RegExpExecArray | null;
    FILE_PATH_RE.lastIndex = 0;

    while ((match = FILE_PATH_RE.exec(line)) !== null) {
      const text = match[1];
      if (!text) continue;

      // Skip URLs (already handled by WebLinksAddon)
      if (/^https?:\/\//i.test(line.substring(Math.max(0, match.index - 8), match.index + text.length))) {
        continue;
      }

      const startX = match.index + 1; // 1-based
      const range: IBufferRange = {
        start: { x: startX, y: bufferLineNumber },
        end: { x: startX + text.length, y: bufferLineNumber },
      };

      links.push({
        range,
        text,
        activate: (_event: MouseEvent, linkText: string) => {
          navigator.clipboard.writeText(linkText).then(
            () => showToast(`Copied: ${linkText}`, "info"),
            () => {},
          );
        },
      });
    }

    callback(links.length > 0 ? links : undefined);
  }

  private getLineText(lineNumber: number): string {
    const buf = this.terminal.buffer.active;
    const line = buf.getLine(lineNumber - 1);
    if (!line) return "";
    return line.translateToString(true);
  }
}
