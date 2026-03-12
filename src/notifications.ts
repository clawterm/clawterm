import type { OutputEvent } from "./matchers";
import { logger } from "./logger";

interface NotificationTypeConfig {
  enabled: boolean;
  sound: boolean;
}

export interface NotificationsConfig {
  enabled: boolean;
  sound: boolean;
  types: {
    completion: NotificationTypeConfig;
    agentWaiting: NotificationTypeConfig;
    serverStarted: NotificationTypeConfig;
    serverCrashed: NotificationTypeConfig;
    error: NotificationTypeConfig;
  };
}

export const DEFAULT_NOTIFICATIONS_CONFIG: NotificationsConfig = {
  enabled: true,
  sound: true,
  types: {
    completion: { enabled: true, sound: false },
    agentWaiting: { enabled: true, sound: true },
    serverStarted: { enabled: true, sound: false },
    serverCrashed: { enabled: true, sound: true },
    error: { enabled: true, sound: false },
  },
};

const EVENT_TO_CONFIG_KEY: Record<string, keyof NotificationsConfig["types"]> = {
  "agent-completed": "completion",
  "agent-waiting": "agentWaiting",
  "server-started": "serverStarted",
  "server-crashed": "serverCrashed",
  error: "error",
};

const EVENT_MESSAGES: Record<string, string> = {
  "agent-waiting": "Agent is waiting for input",
  "server-started": "Server started",
  "server-crashed": "Server crashed",
  error: "Error detected",
  "agent-completed": "Agent task completed",
};

export class NotificationManager {
  private config: NotificationsConfig;
  private audioCtx: AudioContext | null = null;

  constructor(config?: NotificationsConfig) {
    this.config = config ?? DEFAULT_NOTIFICATIONS_CONFIG;
  }

  updateConfig(config: NotificationsConfig) {
    this.config = config;
  }

  private ensurePermission() {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }

  notify(event: OutputEvent, tabTitle: string, isActiveTab: boolean) {
    if (!this.config.enabled) return;
    if (isActiveTab && !document.hidden) return;
    this.ensurePermission();

    const configKey = EVENT_TO_CONFIG_KEY[event.type];
    if (!configKey) return;

    const typeConfig = this.config.types[configKey];
    if (!typeConfig.enabled) return;

    // Desktop notification
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      const message = EVENT_MESSAGES[event.type] ?? event.detail;
      new Notification("Clawterm", {
        body: `${tabTitle}: ${message}`,
      });
    }

    // Sound
    if (this.config.sound && typeConfig.sound) {
      this.playTone(event.type);
    }
  }

  // Notify on simple command completion (idle transition in background)
  notifyCommandComplete(tabTitle: string, isActiveTab: boolean) {
    if (!this.config.enabled) return;
    if (isActiveTab && !document.hidden) return;
    if (!this.config.types.completion.enabled) return;
    this.ensurePermission();

    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification("Clawterm", {
        body: `Command finished in: ${tabTitle}`,
      });
    }

    if (this.config.sound && this.config.types.completion.sound) {
      this.playTone("agent-completed");
    }
  }

  private getAudioContext(): AudioContext {
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
    }
    return this.audioCtx;
  }

  dispose() {
    if (this.audioCtx) {
      this.audioCtx.close();
      this.audioCtx = null;
    }
  }

  private playTone(type: string) {
    try {
      const ctx = this.getAudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      gain.gain.value = 0.15;

      if (type === "agent-waiting") {
        // Two-tone chime
        osc.frequency.value = 880;
        osc.type = "sine";
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);

        // Second tone
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.frequency.value = 1100;
        osc2.type = "sine";
        gain2.gain.setValueAtTime(0.15, ctx.currentTime + 0.15);
        gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.45);
        osc2.start(ctx.currentTime + 0.15);
        osc2.stop(ctx.currentTime + 0.45);
      } else if (type === "server-crashed" || type === "error") {
        // Low alert tone
        osc.frequency.value = 330;
        osc.type = "triangle";
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.5);
      } else {
        // Simple soft tone
        osc.frequency.value = 660;
        osc.type = "sine";
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.2);
      }
    } catch (e) {
      logger.debug("Audio playback failed:", e);
    }
  }
}
