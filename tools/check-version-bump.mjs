// CI guard: if any file the service worker caches (js/precache.js) or sw.js itself changed, js/version.js must have changed too.
// Otherwise phones that already have the app keep serving their old cached copy, and nobody notices.
//
//   node tools/check-version-bump.mjs <base>      compares the working tree's commit (HEAD) with <base>, e.g. HEAD~1 or origin/main
//
// A file that was added or deleted counts as changed; js/version.js being added counts as bumped.

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const VERSION_FILE = 'js/version.js';
export const FAILURE_MESSAGE = "App files changed but js/version.js wasn't bumped — phones would keep the old copy. Bump APP_VERSION (see README › Releasing an update).";

/**
 * `changed`: paths (relative to the repo root, forward slashes) that differ from the base.
 * `precache`: the PRECACHE list. Returns {ok, message, appFiles} where appFiles are the changed files that need a bump.
 */
export function checkVersionBump(changed, precache) {
  const watched = new Set([...precache, 'sw.js']);
  const appFiles = changed.filter((path) => watched.has(path) && path !== VERSION_FILE);
  const bumped = changed.includes(VERSION_FILE);
  if (appFiles.length && !bumped) return { ok: false, message: `${FAILURE_MESSAGE}\nChanged: ${appFiles.join(', ')}`, appFiles };
  return { ok: true, message: appFiles.length ? 'App files changed and js/version.js was bumped.' : 'No cached app files changed.', appFiles };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const base = process.argv[2];
  if (!base) {
    console.error('Usage: node tools/check-version-bump.mjs <base commit or ref>');
    process.exit(2);
  }
  const changed = execFileSync('git', ['diff', '--name-only', base, 'HEAD'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const { PRECACHE } = await import(new URL('../js/precache.js', import.meta.url));
  const result = checkVersionBump(changed, PRECACHE);
  console.log(result.message);
  process.exit(result.ok ? 0 : 1);
}
