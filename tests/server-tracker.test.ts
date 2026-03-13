import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the utils module before importing ServerTracker
vi.mock("../src/utils", () => ({
  invokeWithTimeout: vi.fn(),
  modLabel: "\u2318",
  modKey: "cmd",
}));

// Mock logger to silence output
vi.mock("../src/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { ServerTracker } from "../src/server-tracker";
import { invokeWithTimeout } from "../src/utils";

const mockInvoke = vi.mocked(invokeWithTimeout);

describe("ServerTracker", () => {
  let tracker: ServerTracker;

  beforeEach(() => {
    vi.useFakeTimers();
    tracker = new ServerTracker(1000, 500);
  });

  afterEach(() => {
    tracker.dispose();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("adds and retrieves a server", () => {
    tracker.addServer("tab-1", 3000, "vite");
    const server = tracker.getServer("tab-1");
    expect(server).toBeDefined();
    expect(server!.port).toBe(3000);
    expect(server!.framework).toBe("vite");
    expect(server!.healthy).toBe(true);
  });

  it("returns undefined for unknown tab", () => {
    expect(tracker.getServer("nope")).toBeUndefined();
  });

  it("removes a server", () => {
    tracker.addServer("tab-1", 3000);
    tracker.removeServer("tab-1");
    expect(tracker.getServer("tab-1")).toBeUndefined();
  });

  it("lists all servers", () => {
    tracker.addServer("tab-1", 3000);
    tracker.addServer("tab-2", 8080, "express");
    const all = tracker.getAllServers();
    expect(all).toHaveLength(2);
    expect(all.map((s) => s.port).sort()).toEqual([3000, 8080]);
  });

  it("fires onServerCrash when health check fails", async () => {
    const crashHandler = vi.fn();
    tracker.onServerCrash(crashHandler);
    tracker.addServer("tab-1", 3000);

    // Port returns not alive
    mockInvoke.mockResolvedValue(false);

    // Advance past health check interval
    await vi.advanceTimersByTimeAsync(1000);

    expect(crashHandler).toHaveBeenCalledWith("tab-1", 3000);
  });

  it("does not fire crash again if already unhealthy", async () => {
    const crashHandler = vi.fn();
    tracker.onServerCrash(crashHandler);
    tracker.addServer("tab-1", 3000);

    mockInvoke.mockResolvedValue(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(crashHandler).toHaveBeenCalledTimes(1);

    // Second check — already unhealthy, should not fire again
    await vi.advanceTimersByTimeAsync(1000);
    expect(crashHandler).toHaveBeenCalledTimes(1);
  });

  it("recovers from unhealthy to healthy", async () => {
    const crashHandler = vi.fn();
    tracker.onServerCrash(crashHandler);
    tracker.addServer("tab-1", 3000);

    mockInvoke.mockResolvedValue(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(tracker.getServer("tab-1")!.healthy).toBe(false);

    mockInvoke.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(tracker.getServer("tab-1")!.healthy).toBe(true);
  });

  it("clears servers on dispose", () => {
    tracker.addServer("tab-1", 3000);
    tracker.addServer("tab-2", 8080);
    tracker.dispose();
    expect(tracker.getAllServers()).toHaveLength(0);
  });
});
