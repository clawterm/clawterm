import { check } from "@tauri-apps/plugin-updater";
import { logger } from "./logger";

export async function checkForUpdates(): Promise<void> {
  try {
    const update = await check();
    if (!update) return;

    logger.debug(`Update available: ${update.version}`);
    showUpdateBanner(update.version, async () => {
      try {
        await update.downloadAndInstall();
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      } catch (e) {
        logger.debug("Update install failed:", e);
      }
    });
  } catch (e) {
    // Silently ignore — updater may not be configured yet
    logger.debug("Update check skipped:", e);
  }
}

function showUpdateBanner(version: string, onInstall: () => void): void {
  const banner = document.createElement("div");
  banner.className = "update-banner";
  banner.innerHTML = `
    <span>Clawterm ${version} is available</span>
    <button class="update-btn">Update & Restart</button>
    <button class="update-dismiss">✕</button>
  `;
  document.body.appendChild(banner);

  banner.querySelector(".update-btn")!.addEventListener("click", () => {
    const btn = banner.querySelector(".update-btn") as HTMLButtonElement;
    btn.textContent = "Installing...";
    btn.disabled = true;
    onInstall();
  });

  banner.querySelector(".update-dismiss")!.addEventListener("click", () => {
    banner.remove();
  });
}
