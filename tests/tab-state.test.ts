import { describe, it, expect } from "vitest";
import {
  createDefaultTabState,
  createDefaultPaneState,
  computeDisplayTitle,
  computeFolderTitle,
  type TabState,
} from "../src/tab-state";

function makeState(overrides: Partial<TabState> = {}): TabState {
  return { ...createDefaultTabState(), ...overrides };
}

describe("createDefaultTabState", () => {
  it("returns idle state with default folder", () => {
    const state = createDefaultTabState();
    expect(state.folderName).toBe("~");
    expect(state.isIdle).toBe(true);
    expect(state.needsAttention).toBe(false);
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

  it("shows process name when not idle and no agent", () => {
    expect(
      computeDisplayTitle(makeState({ folderName: "src", isIdle: false, processName: "npm" })),
    ).toBe("src — npm");
  });

  it("server port takes priority over process name", () => {
    expect(
      computeDisplayTitle(
        makeState({ folderName: "app", serverPort: 8080, isIdle: false, processName: "node" }),
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

describe("createDefaultPaneState", () => {
  it("returns idle state", () => {
    const state = createDefaultPaneState();
    expect(state.folderName).toBe("~");
    expect(state.isIdle).toBe(true);
    expect(state.serverPort).toBeNull();
    expect(state.gitBranch).toBeNull();
  });
});
