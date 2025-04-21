import { Stats } from 'fs';
import { dirname } from "path";
import chokidar from "chokidar";
import LRUCache from 'lru-cache';

import { Profile } from "../tool-env/profile";
import { statOrNull, lstat, toPosixPath, convertToOSPath, pathRelative, watchFile, unwatchFile } from "./files";

export type SafeWatcher = { close: () => void; };

type ChangeCallback = (event: string) => void;

interface Entry extends SafeWatcher {
  callbacks: Set<ChangeCallback>;
  _fire(event: string): void;
}

// Set METEOR_WATCH_USE_LRU environment variable to a truthy value to
// enable LRU caching for watcher entries to reduce memory usage.
const useLRU = Boolean(JSON.parse(process.env.METEOR_WATCH_USE_LRU || "false"));

// enable to tweak maximum entries size (default 500MB).
const sizeMaxLRU = JSON.parse(process.env.METEOR_WATCH_USE_LRU_SIZE || Math.pow(2, 20) * 500);

// Registry mapping normalized absolute paths to their watcher entry.
// If LRU caching is enabled, this will be an LRUCache instance.
// Otherwise, we use a Map object for entries.
const entries = useLRU
  ? new LRUCache<string, Entry | null>({
      max: sizeMaxLRU, // 1MB max size
      length: (entry, key) => {
        return key.length + (entry ? 100 : 10);
      },
      dispose: (key, entry) => {
        return entry?.close();
      },
    })
  : new Map<string, Entry | null>();

function getEntry(path: string): Entry | null | undefined {
  return entries.get(path);
}

function setEntry(path: string, entry: Entry | null): void {
  entries.set(path, entry);
}

function deleteEntry(path: string): void {
  if (useLRU) {
    return entries.del(path);
  }
  return entries.delete(path);
}

// Watch roots are directories for which we have an active chokidar watcher.
const watchRoots = new Set<string>();
// For each watch root, store its active watcher.
const dirSubscriptions = new Map<string, chokidar.FSWatcher>();
// A set of roots that are known to be unwatchable.
const ignoredWatchRoots = new Set<string>();

// Set METEOR_WATCH_FORCE_POLLING environment variable to a truthy value to
// force the use of files.watchFile instead of chokidar.
let watcherEnabled = !JSON.parse(process.env.METEOR_WATCH_FORCE_POLLING || "false");

/**
 * Polling fallback globals.
 * The legacy Meteor strategy used polling for cases where native watchers failed.
 * We keep track of files that changed, so that we can poll them faster.
 */
var DEFAULT_POLLING_INTERVAL =
    +(process.env.METEOR_WATCH_POLLING_INTERVAL_MS || 5000);

var NO_WATCHER_POLLING_INTERVAL =
    +(process.env.METEOR_WATCH_POLLING_INTERVAL_MS || 500);

var PRIORITIZE_CHANGED = true;
if (process.env.METEOR_WATCH_PRIORITIZE_CHANGED &&
    ! JSON.parse(process.env.METEOR_WATCH_PRIORITIZE_CHANGED)) {
  PRIORITIZE_CHANGED = false;
}

// Set of paths for which a change event has been fired, watched with
// watchLibrary.watch if available. This could be an LRU cache, but in
// practice it should never grow large enough for that to matter.
const changedPaths = new Set;

function shouldIgnorePath(absPath: string): boolean {
  const posixPath = toPosixPath(absPath);
  const parts = posixPath.split('/');

  // Check for .meteor: allow the .meteor directory itself,
  // but ignore its "local" subdirectory (or any immediate child folder that indicates cache).
  const meteorIndex = parts.indexOf(".meteor");
  if (meteorIndex !== -1) {
    const nextPart = parts[meteorIndex + 1];
    if (nextPart && nextPart === "local") {
      // Ignore anything inside .meteor/local
      return true;
    }
    // Otherwise, do not automatically ignore .meteor (which includes .meteor/packages, etc).
  }

  // For node_modules: ignore contents unless the package directory is a symlink (which means it’s under active development).
  const nmIndex = parts.indexOf("node_modules");
  if (nmIndex !== -1) {
    try {
      const stat = lstat(absPath);
      if (!stat?.isSymbolicLink()) {
        return true;
      }
      // If the package folder is symlinked, we want to watch it.
    } catch (e) {
      return true;
    }
  }

  return false;
}

/**
 * Ensure that the given directory is being watched by chokidar.
 * If it is not a directory or is unwatchable, it is immediately added to an ignore set.
 */
async function ensureWatchRoot(dirPath: string): Promise<void> {
  if (!watcherEnabled || watchRoots.has(dirPath) || ignoredWatchRoots.has(dirPath)) {
    return;
  }

  // If an ancestor is already watched, skip this one.
  for (const root of watchRoots) {
    const rel = pathRelative(root, dirPath);
    if (root !== dirPath && !rel.startsWith("..") && !rel.startsWith("/")) {
      return;
    }
  }

  // Remove any existing roots that are now encompassed by the new one.
  for (const root of Array.from(watchRoots)) {
    const rel = pathRelative(dirPath, root);
    if (root !== dirPath && !rel.startsWith("..") && !rel.startsWith("/")) {
      const watcher = dirSubscriptions.get(root);
      if (watcher) {
        try {
          await watcher.close();
        } catch (_) {
          /* ignore errors */
        }
      }
      dirSubscriptions.delete(root);
      watchRoots.delete(root);
    }
  }

  const osDirPath = convertToOSPath(dirPath);
  // Check that osDirPath is indeed a directory.
  try {
    const stats = statOrNull(osDirPath);
    if (!stats?.isDirectory()) {
      console.warn(`Skipping watcher for ${osDirPath}: not a directory`);
      ignoredWatchRoots.add(dirPath);
      return;
    }
  } catch (e) {
    console.error(`Failed to stat ${osDirPath}:`, e);
    ignoredWatchRoots.add(dirPath);
    return;
  }

  // Set up ignore patterns to skip deep node_modules and .meteor/local cache
  try {
    // Create a chokidar watcher
    const watcher = chokidar.watch(osDirPath, {
      ignored: (file) => file.includes('node_modules') || file.includes('.meteor/local'),
      ignoreInitial: true,
      followSymlinks: false,
      persistent: false,
    });

    // Handle file events
    const handleEvent = (eventType: string, path: string) => {
      const changedPath = toPosixPath(path);
      const entry = getEntry(changedPath);
      if (!entry) return;

      // In Meteor's safe-watcher API, both add/change trigger "change" events,
      // while unlink triggers "delete" events
      const evtType = eventType === 'unlink' ? "delete" : "change";
      entry._fire(evtType);
    };

    // Set up event handlers
    watcher.on('add', path => handleEvent('add', path));
    watcher.on('change', path => handleEvent('change', path));
    watcher.on('unlink', path => handleEvent('unlink', path));

    // Handle errors
    watcher.on('error', (error) => {
      // console.error(`Chokidar watcher error on ${osDirPath}:`, error);
      // Only disable native watching for critical errors (like ENOSPC).
      if (error.code === "ENOSPC" || error.errno === require("constants").ENOSPC) {
        fallbackToPolling();
      }
    });

    watchRoots.add(dirPath);
    dirSubscriptions.set(dirPath, watcher);
  } catch (e: any) {
    if (
        e &&
        (e.code === "ENOTDIR" ||
            /Not a directory/.test(e.message) ||
            e.code === "EBADF" ||
            /Bad file descriptor/.test(e.message))
    ) {
      console.warn(`Skipping watcher for ${osDirPath}: not a directory`);
      ignoredWatchRoots.add(dirPath);
    } else {
      console.error(`Failed to start watcher for ${osDirPath}:`, e);
      if (e.code === "ENOSPC" || e.errno === require("constants").ENOSPC) {
        fallbackToPolling();
      }
    }
  }
}

/**
 * Creates a new watch entry for a specific file (or directory) and
 * holds its registered callbacks.
 */
function startNewEntry(absPath: string): Entry {
  const callbacks = new Set<ChangeCallback>();
  let closed = false;
  const entry: Entry = {
    callbacks,
    close() {
      if (closed) return;
      closed = true;
      deleteEntry(absPath);
    },
    _fire(event: string) {
      callbacks.forEach(cb => {
        try {
          cb(event);
        } catch (e) {
          // Ignore callback errors.
        }
      });
    }
  };
  return entry;
}

/**
 * The primary API function to watch a file or directory.
 * This registers the callback on the internally managed entry and
 * ensures that a Parcel watcher is subscribed to a covering directory.
 */
export const watch = Profile(
    "safeWatcher.watch",
    (
    absPath: string,
    callback: ChangeCallback
    ): SafeWatcher => {
      absPath = toPosixPath(absPath);
      // If the path should be ignored, immediately return a noop SafeWatcher.
      if (shouldIgnorePath(absPath)) {
        return { close() {} };
      }
      // If native watching is disabled, use the polling strategy.
      if (!watcherEnabled) {
        return startPolling(absPath, callback);
      }
      // Try to reuse an existing entry if one was created before.
      let entry = getEntry(absPath);
      if (!entry) {
        entry = startNewEntry(absPath);
        setEntry(absPath, entry);
        // Determine the directory that should be watched.
        let watchTarget: string;
        try {
          const st = statOrNull(convertToOSPath(absPath));
          watchTarget = st?.isDirectory() ? absPath : toPosixPath(dirname(convertToOSPath(absPath)));
        } catch (e) {
          watchTarget = toPosixPath(dirname(convertToOSPath(absPath)));
        }
        // Set up a watcher on the parent directory (or the directory itself) if not already active.
        ensureWatchRoot(watchTarget);
      }
      // Register the callback for this file.
      entry.callbacks.add(callback);
      return {
        close() {
          const entry = getEntry(absPath);
          if (entry) {
            entry.callbacks.delete(callback);
            if (entry.callbacks.size === 0) {
              entry.close();
            }
          }
        }
      };
});

/**
 * Externally force a directory to be watched.
 * If the provided path is a file, its parent directory is used.
 */
export function addWatchRoot(absPath: string) {
  absPath = toPosixPath(absPath);
  let watchTarget = absPath;
  try {
    const st = statOrNull(convertToOSPath(absPath));
    if (!st?.isDirectory()) {
      watchTarget = toPosixPath(dirname(convertToOSPath(absPath)));
    }
  } catch (e) {
    watchTarget = toPosixPath(dirname(convertToOSPath(absPath)));
  }
  ensureWatchRoot(watchTarget);
}

async function safeCloseWatcher(root: string) {
  const watcher = dirSubscriptions.get(root);
  if (!watcher) return;  // Already closed.
  // Remove from our maps immediately to prevent further close calls.
  dirSubscriptions.delete(root);
  watchRoots.delete(root);
  try {
    await watcher.close();
  } catch (e) {
    console.error(`Error during watcher close for ${root}:`, e);
  }
}

export async function closeAllWatchers() {
  for (const root of Array.from(watchRoots)) {
    await safeCloseWatcher(root);
  }
}

function hasPriority(absPath: string) {
  // If we're not prioritizing changed files, then all files have
  // priority, which means they should be watched with native file
  // watchers if the platform supports them. If we are prioritizing
  // changed files, then only changed files get priority.
  return PRIORITIZE_CHANGED
      ? changedPaths.has(absPath)
      : true;
}

// Determines the polling interval to be used for the fs.watchFile-based
// safety net that works on all platforms and file systems.
function getPollingInterval(absPath: string): number {
  if (hasPriority(absPath)) {
    // Regardless of whether we have a native file watcher and it works
    // correctly on this file system, poll prioritized files (that is,
    // files that have been changed at least once) at a higher frequency
    // (every 500ms by default).
    return NO_WATCHER_POLLING_INTERVAL;
  }

  if (watcherEnabled || PRIORITIZE_CHANGED) {
    // As long as native file watching is enabled (even if it doesn't
    // work correctly) and the developer hasn't explicitly opted out of
    // the file watching priority system, poll unchanged files at a
    // lower frequency (every 5000ms by default).
    return DEFAULT_POLLING_INTERVAL;
  }

  // If native file watching is disabled and the developer has
  // explicitly opted out of the priority system, poll everything at the
  // higher frequency (every 500ms by default). Note that this leads to
  // higher idle CPU usage, so the developer may want to adjust the
  // METEOR_WATCH_POLLING_INTERVAL_MS environment variable.
  return NO_WATCHER_POLLING_INTERVAL;
}

function startPolling(absPath: string, callback: ChangeCallback): SafeWatcher {
  const osPath = convertToOSPath(absPath);
  // Initial polling interval.
  let interval = getPollingInterval(absPath);
  const pollCallback = (curr: Stats, prev: Stats) => {
    // Compare modification times to detect a change.
    if (+curr.mtime !== +prev.mtime) {
      changedPaths.add(absPath);
      callback("change");
    }
  };
  watchFile(osPath, { interval }, pollCallback);
  return {
    close() {
      unwatchFile(osPath, pollCallback);
      changedPaths.delete(absPath);
    }
  };
}

/**
 * Fall back to polling. If a critical error occurs,
 * we disable native watching and close all existing native watchers.
 */
function fallbackToPolling() {
  if (watcherEnabled) {
    console.error("Critical native watcher error encountered. Falling back to polling for all entries.");
    watcherEnabled = false;
    closeAllWatchers();
  }
}
