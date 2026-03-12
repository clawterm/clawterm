import { invokeWithTimeout } from "./utils";
import { logger } from "./logger";

export interface TrackedServer {
  tabId: string;
  port: number;
  healthy: boolean;
  framework?: string;
}

export class ServerTracker {
  private servers: Map<string, TrackedServer> = new Map();
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private onCrash: ((tabId: string, port: number) => void) | null = null;
  private healthCheckIntervalMs: number;
  private ipcTimeoutMs: number;

  constructor(healthCheckIntervalMs = 10000, ipcTimeoutMs = 5000) {
    this.healthCheckIntervalMs = healthCheckIntervalMs;
    this.ipcTimeoutMs = ipcTimeoutMs;
  }

  onServerCrash(fn: (tabId: string, port: number) => void) {
    this.onCrash = fn;
  }

  addServer(tabId: string, port: number, framework?: string) {
    this.servers.set(tabId, { tabId, port, healthy: true, framework });
    if (!this.checkTimer) {
      this.startHealthChecks();
    }
  }

  removeServer(tabId: string) {
    this.servers.delete(tabId);
    if (this.servers.size === 0 && this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  getServer(tabId: string): TrackedServer | undefined {
    return this.servers.get(tabId);
  }

  getAllServers(): TrackedServer[] {
    return Array.from(this.servers.values());
  }

  private startHealthChecks() {
    this.checkTimer = setInterval(() => this.checkAll(), this.healthCheckIntervalMs);
  }

  private async checkAll() {
    for (const [tabId, server] of this.servers) {
      try {
        const alive = await invokeWithTimeout<boolean>(
          "check_port",
          { port: server.port },
          this.ipcTimeoutMs,
        );
        if (!alive && server.healthy) {
          server.healthy = false;
          this.onCrash?.(tabId, server.port);
        } else if (alive && !server.healthy) {
          server.healthy = true;
        }
      } catch (e) {
        logger.debug(`Health check failed for port ${server.port}:`, e);
      }
    }
  }

  dispose() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    this.servers.clear();
  }
}
