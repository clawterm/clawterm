import { check } from "@tauri-apps/plugin-updater";
import { logger } from "./logger";
import { trapFocus } from "./utils";
import { showToast } from "./toast";
import type { Config } from "./config";

const JUST_UPDATED_KEY = "clawterm_last_update_ts";
let updateFound = false;
let manualCheckInProgress = false;

export function startUpdateChecker(config: Config): void {
  if (!config.updates.autoCheck) {
    logger.debug("Auto-update checking disabled via config");
    return;
  }

  // Skip the initial check if the app was just updated (within last 30s)
  const lastUpdate = parseInt(localStorage.getItem(JUST_UPDATED_KEY) || "0", 10);
  const justUpdated = Date.now() - lastUpdate < 30_000;

  if (justUpdated) {
    localStorage.removeItem(JUST_UPDATED_KEY);
    logger.debug("Skipping initial update check — app was just updated");
  } else {
    // First check after 3 seconds
    setTimeout(checkForUpdates, 3000);
  }

  // Then check periodically
  const intervalMs = config.updates.checkIntervalMs;
  setInterval(() => {
    if (!updateFound) checkForUpdates();
  }, intervalMs);
}

export async function manualCheckForUpdates(): Promise<void> {
  if (manualCheckInProgress) return;
  manualCheckInProgress = true;
  const btn = document.getElementById("update-btn");
  try {
    const update = await check();
    if (!update) {
      if (btn) {
        btn.classList.add("up-to-date");
        btn.title = "Up to date";
        setTimeout(() => {
          btn.classList.remove("up-to-date");
          btn.title = "Check for Updates";
        }, 2000);
      }
    } else {
      updateFound = true;
      logger.debug(`Update available: ${update.version}`);
      showUpdateNotice(update.version, () => installLatest());
    }
  } catch (e) {
    logger.warn("Manual update check failed:", e);
    showToast("Update check failed — try again later", "warn");
  } finally {
    manualCheckInProgress = false;
  }
}

async function checkForUpdates(): Promise<void> {
  try {
    const update = await check();
    if (!update) return;

    updateFound = true;
    logger.debug(`Update available: ${update.version}`);
    showUpdateNotice(update.version, () => installLatest());
  } catch (e) {
    logger.debug("Update check skipped:", e);
  }
}

/**
 * Re-check for the absolute latest version before downloading to avoid
 * stepping through intermediate releases if multiple were published.
 */
async function installLatest(): Promise<void> {
  try {
    // Fresh check to ensure we download the very latest, not a stale reference
    const latest = await check();
    if (!latest) {
      logger.debug("No update found on re-check before install");
      return;
    }
    logger.debug(`Installing latest version: ${latest.version}`);
    localStorage.setItem(JUST_UPDATED_KEY, String(Date.now()));
    await latest.downloadAndInstall();
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (e) {
    logger.warn("Update install failed:", e);
    localStorage.removeItem(JUST_UPDATED_KEY);
    showToast("Update failed — download manually from GitHub Releases", "error");
  }
}

function showUpdateConfirm(version: string, onConfirm: () => void): void {
  document.querySelector(".close-confirm-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "close-confirm-overlay";

  const dialog = document.createElement("div");
  dialog.className = "close-confirm-dialog";

  const titleEl = document.createElement("div");
  titleEl.className = "close-confirm-title";
  titleEl.textContent = "Install update?";

  const bodyEl = document.createElement("div");
  bodyEl.className = "close-confirm-body";
  bodyEl.textContent = `Version ${version} is ready. This will close all terminals and restart the app.`;

  const actionsEl = document.createElement("div");
  actionsEl.className = "close-confirm-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "close-confirm-btn cancel";
  cancelBtn.textContent = "Cancel";

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "close-confirm-btn confirm";
  confirmBtn.textContent = "Update & Restart";

  actionsEl.appendChild(cancelBtn);
  actionsEl.appendChild(confirmBtn);
  dialog.appendChild(titleEl);
  dialog.appendChild(bodyEl);
  dialog.appendChild(actionsEl);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const removeTrap = trapFocus(dialog);
  const dismiss = () => {
    removeTrap();
    overlay.remove();
  };

  cancelBtn.addEventListener("click", dismiss);
  confirmBtn.addEventListener("click", () => {
    dismiss();
    onConfirm();
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) dismiss();
  });
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") dismiss();
  });

  cancelBtn.focus();
}

function showUpdateNotice(version: string, onInstall: () => void): void {
  const footer = document.getElementById("sidebar-footer");
  if (!footer) return;

  // If a notice already exists, update its version text and bail
  const existing = footer.querySelector(".update-notice");
  if (existing) {
    const ver = existing.querySelector(".update-notice-version");
    if (ver) ver.textContent = version;
    return;
  }

  const notice = document.createElement("div");
  notice.className = "update-notice";

  const dot = document.createElement("div");
  dot.className = "update-notice-dot";

  const text = document.createElement("div");
  text.className = "update-notice-text";
  const label = document.createElement("span");
  label.className = "update-notice-label";
  label.textContent = "Update available";
  const ver = document.createElement("span");
  ver.className = "update-notice-version";
  ver.textContent = version;
  text.appendChild(label);
  text.appendChild(ver);

  const btn = document.createElement("button");
  btn.className = "update-notice-action";
  btn.textContent = "Update";

  notice.appendChild(dot);
  notice.appendChild(text);
  notice.appendChild(btn);

  footer.insertBefore(notice, footer.firstChild);

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    showUpdateConfirm(version, () => {
      btn.textContent = "Installing\u2026";
      btn.disabled = true;
      notice.classList.add("installing");
      onInstall();
    });
  });
}
