import { describe, it, expect } from "vitest";
import {
  createDefaultTabState,
  createDefaultPaneState,
  computeDisplayTitle,
  computeSubtitle,
  computeFolderTitle,
  computePaneStatusLine,
  type TabState,
  type PaneState,
} from "../src/tab-state";

function makeState(overrides: Partial<TabState> = {}): TabState {
  return { ...createDefaultTabState(), ...overrides };
}

describe("createDefaultTabState", () => {
  it("returns idle state with default folder", () => {
    const state = createDefaultTabState();
    expect(state.folderName).toBe("~");
    expect(state.isIdle).toBe(true);
    expect(state.activity).toBe("idle");
    expect(state.needsAttention).toBe(false);
    expect(state.agentName).toBeNull();
    expect(state.serverPort).toBeNull();
    expect(state.projectName).toBeNull();
    expect(state.lastError).toBeNull();
    expect(state.processName).toBe("");
  });

  it("returns independent objects", () => {
    const a = createDefaultTabState();
    const b = createDefaultTabState();
    a.folderName = "changed";
    expect(b.folderName).toBe("~");
  });
});

describe("computeDisplayTitle", () => {
  it("shows folder name when idle", () => {
    expect(computeDisplayTitle(makeState({ folderName: "myproject" }))).toBe("myproject");
  });

  it("falls back to ~ when folder and project are empty", () => {
    expect(computeDisplayTitle(makeState({ folderName: "", projectName: null }))).toBe("~");
  });

  it("prefers projectName over folderName", () => {
    expect(
      computeDisplayTitle(makeState({ folderName: "dir", projectName: "MyApp" })),
    ).toBe("MyApp");
  });

  it("shows server port when set", () => {
    expect(
      computeDisplayTitle(makeState({ folderName: "app", serverPort: 3000 })),
    ).toBe("app :3000");
  });

  it("shows agent name when agent is active", () => {
    expect(
      computeDisplayTitle(
        makeState({ folderName: "code", agentName: "claude", activity: "running", isIdle: false }),
      ),
    ).toBe("code — claude");
  });

  it("shows [waiting] suffix when agent is waiting", () => {
    expect(
      computeDisplayTitle(
        makeState({ folderName: "code", agentName: "claude", activity: "agent-waiting" }),
      ),
    ).toBe("code — claude [waiting]");
  });

  it("shows process name when not idle and no agent", () => {
    expect(
      computeDisplayTitle(makeState({ folderName: "src", isIdle: false, processName: "npm" })),
    ).toBe("src — npm");
  });

  it("server port takes priority over agent name", () => {
    expect(
      computeDisplayTitle(
        makeState({ folderName: "app", serverPort: 8080, agentName: "claude" }),
      ),
    ).toBe("app :8080");
  });

  it("uses projectName with server port", () => {
    expect(
      computeDisplayTitle(
        makeState({ folderName: "dir", projectName: "MyApp", serverPort: 5173 }),
      ),
    ).toBe("MyApp :5173");
  });
});

describe("computeSubtitle", () => {
  it("returns null for idle state", () => {
    expect(computeSubtitle(makeState())).toBeNull();
  });

  it("returns 'waiting' when agent is waiting (unknown type)", () => {
    expect(computeSubtitle(makeState({ activity: "agent-waiting" }))).toBe("waiting");
  });

  it("returns 'waiting for input' when agent is waiting for user", () => {
    expect(computeSubtitle(makeState({ activity: "agent-waiting", waitingType: "user" }))).toBe("waiting for input");
  });

  it("returns localhost:port when server is running", () => {
    expect(computeSubtitle(makeState({ serverPort: 3000 }))).toBe("localhost:3000");
  });

  it("returns last error when set", () => {
    expect(computeSubtitle(makeState({ lastError: "ENOENT" }))).toBe("ENOENT");
  });

  it("returns agent name when agent is running", () => {
    expect(
      computeSubtitle(makeState({ agentName: "copilot", activity: "running" })),
    ).toBe("copilot");
  });

  it("agent-waiting takes priority over server port", () => {
    expect(
      computeSubtitle(makeState({ activity: "agent-waiting", serverPort: 3000 })),
    ).toBe("waiting");
  });

  it("server port takes priority over last error", () => {
    expect(
      computeSubtitle(makeState({ serverPort: 8080, lastError: "crash" })),
    ).toBe("localhost:8080");
  });

  it("last error takes priority over agent name", () => {
    expect(
      computeSubtitle(
        makeState({ lastError: "SIGTERM", agentName: "claude", activity: "running" }),
      ),
    ).toBe("SIGTERM");
  });

  it("shows lastAction when agent is running with action", () => {
    expect(
      computeSubtitle(
        makeState({ agentName: "claude", activity: "running", lastAction: "Reading src/auth.ts" }),
      ),
    ).toContain("Reading src/auth.ts");
  });
});

describe("computeFolderTitle", () => {
  it("returns /projectName when set", () => {
    expect(computeFolderTitle(makeState({ projectName: "myapp" }))).toBe("/myapp");
  });

  it("returns /folderName when no project", () => {
    expect(computeFolderTitle(makeState({ folderName: "src" }))).toBe("/src");
  });

  it("returns ~ for home directory", () => {
    expect(computeFolderTitle(makeState({ folderName: "~" }))).toBe("~");
  });

  it("returns / for root", () => {
    expect(computeFolderTitle(makeState({ folderName: "/" }))).toBe("/");
  });

  it("prefers projectName over folderName", () => {
    expect(computeFolderTitle(makeState({ folderName: "dir", projectName: "App" }))).toBe("/App");
  });
});

function makePane(overrides: Partial<PaneState> = {}): PaneState {
  return { ...createDefaultPaneState(), ...overrides };
}

describe("computePaneStatusLine", () => {
  it("returns 'idle' for default state", () => {
    expect(computePaneStatusLine(makePane())).toBe("idle");
  });

  it("shows 'starting agent...' when just detected", () => {
    expect(computePaneStatusLine(makePane({ agentJustStarted: true, agentName: "claude" }))).toBe(
      "starting claude...",
    );
  });

  it("shows agent waiting with reason", () => {
    expect(
      computePaneStatusLine(
        makePane({ activity: "agent-waiting", agentName: "aider", waitingType: "user" }),
      ),
    ).toContain("aider waiting for input");
  });

  it("shows agent working with action", () => {
    expect(
      computePaneStatusLine(
        makePane({ activity: "running", agentName: "claude", lastAction: "Editing file.ts" }),
      ),
    ).toContain("claude: Editing file.ts");
  });

  it("shows agent working without action", () => {
    expect(
      computePaneStatusLine(makePane({ activity: "running", agentName: "claude" })),
    ).toContain("claude working...");
  });

  it("shows server port", () => {
    expect(
      computePaneStatusLine(makePane({ activity: "server-running", serverPort: 3000 })),
    ).toBe("localhost:3000");
  });

  it("shows error", () => {
    expect(
      computePaneStatusLine(makePane({ activity: "error", lastError: "SEGFAULT" })),
    ).toBe("SEGFAULT");
  });

  it("shows process name when running", () => {
    expect(
      computePaneStatusLine(makePane({ activity: "running", processName: "npm" })),
    ).toBe("npm");
  });
});
