import { check } from "@tauri-apps/plugin-updater";
import { logger } from "./logger";

const CHECK_INTERVAL_MS = 60 * 1000; // 60 seconds
let updateFound = false;

export function startUpdateChecker(): void {
  // First check after 3 seconds
  setTimeout(checkForUpdates, 3000);

  // Then check periodically
  setInterval(() => {
    if (!updateFound) checkForUpdates();
  }, CHECK_INTERVAL_MS);
}

async function checkForUpdates(): Promise<void> {
  try {
    const update = await check();
    if (!update) return;

    updateFound = true;
    logger.debug(`Update available: ${update.version}`);
    showUpdateNotice(update.version, async () => {
      try {
        await update.downloadAndInstall();
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      } catch (e) {
        logger.debug("Update install failed:", e);
      }
    });
  } catch (e) {
    logger.debug("Update check skipped:", e);
  }
}

function showUpdateNotice(version: string, onInstall: () => void): void {
  const footer = document.getElementById("sidebar-footer");
  if (!footer) return;

  // Don't show duplicate notices
  if (footer.querySelector(".update-notice")) return;

  const notice = document.createElement("div");
  notice.className = "update-notice";
  notice.innerHTML = `
    <div class="update-notice-dot"></div>
    <div class="update-notice-text">
      <span class="update-notice-label">Update available</span>
      <span class="update-notice-version">${version}</span>
    </div>
    <button class="update-notice-action">Update</button>
  `;

  footer.insertBefore(notice, footer.firstChild);

  notice.querySelector(".update-notice-action")!.addEventListener("click", (e) => {
    e.stopPropagation();
    const btn = notice.querySelector(".update-notice-action") as HTMLButtonElement;
    btn.textContent = "Installing…";
    btn.disabled = true;
    notice.classList.add("installing");
    onInstall();
  });
}
