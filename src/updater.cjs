"use strict";
// Automatic updates from GitHub Releases (public repo: no token anywhere in the app).
// - Checks shortly after start and every 6 hours, downloads in the background (electron-updater, GitHub provider; the feed
//   comes from build.publish in package.json, which electron-builder writes into the app).
// - Never restarts by itself: the user chooses "הפעלה מחדש עכשיו", and only while no task / approval card is in progress.
//   "אחר כך" leaves the downloaded update to be installed on the next normal quit (autoInstallOnAppQuit).
// - Failures (offline, GitHub down) never throw into the app: they are logged and kept as technical details only.
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_MS = 20 * 1000;

function createUpdater({
  autoUpdater, // electron-updater's autoUpdater (injected so tests need no Electron)
  currentVersion,
  enabled, // false in dev runs; true only for an installed/packaged app
  portable = false, // the portable exe cannot replace itself
  isBusy = () => false, // true while a task, approval card or connection check is in progress
  prepareInstall = () => {}, // lets main stop hiding windows instead of closing them
  onChange = () => {}, // state changed: windows should re-read it
  log = () => {},
  setTimer = setTimeout,
  setRepeat = setInterval,
  clear = clearTimeout,
}) {
  let checking = false,
    downloading = false,
    readyVersion = null,
    availableVersion = null,
    lastError = "",
    lastCheck = 0,
    timers = [],
    started = false;

  const fail = (error) => {
    lastError = String(error?.message || error || "").slice(0, 1500);
    log("update-error", { message: lastError });
  };

  if (autoUpdater && enabled && !portable) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true; // "אחר כך" = install on the next quit
    autoUpdater.autoRunAppAfterInstall = true;
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.logger = null;
    autoUpdater.on("update-available", (info) => {
      availableVersion = info?.version || "";
      downloading = true;
      log("update-available", { version: availableVersion });
      onChange();
    });
    autoUpdater.on("update-not-available", () => {
      availableVersion = null;
      log("update-not-available", {});
    });
    autoUpdater.on("update-downloaded", (info) => {
      downloading = false;
      readyVersion = info?.version || availableVersion || "";
      log("update-downloaded", { version: readyVersion });
      onChange();
    });
    autoUpdater.on("error", (error) => {
      downloading = false;
      fail(error);
    });
  }

  async function check() {
    if (!enabled || portable || !autoUpdater) return;
    if (checking || downloading || readyVersion) return;
    checking = true;
    try {
      await autoUpdater.checkForUpdates();
      lastError = "";
    } catch (error) {
      downloading = false;
      fail(error);
    } finally {
      checking = false;
      lastCheck = Date.now();
    }
  }

  // Manual "בדיקת עדכונים". Always resolves with a status the window can show.
  async function checkNow() {
    if (portable)
      return {
        status: "portable",
        message:
          "הגרסה הניידת אינה מתעדכנת אוטומטית. הורידו את הגרסה החדשה מעמוד ההורדות.",
      };
    if (!enabled)
      return {
        status: "dev",
        message: "עדכונים פעילים רק באפליקציה המותקנת.",
      };
    if (readyVersion) return { status: "ready", version: readyVersion };
    if (downloading)
      return {
        status: "downloading",
        message: "גרסה חדשה בהורדה ברקע. נודיע כשהיא תהיה מוכנה.",
      };
    lastError = "";
    await check();
    if (readyVersion) return { status: "ready", version: readyVersion };
    if (lastError)
      return {
        status: "error",
        message: "לא ניתן לבדוק עדכונים כרגע. האפליקציה ממשיכה לעבוד כרגיל.",
        tech: lastError,
      };
    if (downloading)
      return {
        status: "downloading",
        message: "נמצאה גרסה חדשה. היא מורדת ברקע ונודיע כשתהיה מוכנה.",
      };
    return { status: "latest", message: "יש לך את הגרסה האחרונה" };
  }

  // Background schedule: first check soon after start, then every 6 hours. Timers never keep the app alive.
  function start() {
    if (started || !enabled || portable || !autoUpdater) return;
    started = true;
    const first = setTimer(check, FIRST_CHECK_MS);
    const repeat = setRepeat(check, CHECK_EVERY_MS);
    timers = [first, repeat];
    for (const t of timers) t?.unref?.();
  }
  function stop() {
    for (const t of timers) clear(t);
    timers = [];
    started = false;
  }

  function state() {
    const busy = !!isBusy();
    return {
      version: currentVersion,
      enabled: !!enabled && !portable,
      portable: !!portable,
      // The "ready" notice is shown only when nothing is in progress, so it never lands on an approval card.
      ready: !!readyVersion && !busy,
      readyVersion: readyVersion || null,
      busy,
      lastCheck,
    };
  }

  // The only way an update restarts the app: an explicit click, never during a task or approval.
  function install() {
    if (!readyVersion) return { ok: false, message: "אין עדכון מוכן להתקנה." };
    if (isBusy())
      return {
        ok: false,
        message: "יש משימה או אישור בתהליך. סיימו אותם ונסו שוב.",
      };
    prepareInstall();
    // isSilent=true: no installer wizard; forceRunAfter=true: the app opens again by itself after the update.
    autoUpdater.quitAndInstall(true, true);
    return { ok: true };
  }

  return { start, stop, check, checkNow, state, install, CHECK_EVERY_MS };
}

module.exports = { createUpdater, CHECK_EVERY_MS, FIRST_CHECK_MS };
