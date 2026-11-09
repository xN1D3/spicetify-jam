/**
 * Spicetify Jam Auto-Updater & Dynamic Hot-Loader
 * Keeps the extension updated from GitHub seamlessly without manual terminal commands.
 */

export const MANIFEST_URL = 'https://raw.githubusercontent.com/xN1D3/spicetify-jam/main/manifest.json';
export const BUNDLE_URL = 'https://raw.githubusercontent.com/xN1D3/spicetify-jam/main/dist/spicetify-jam.js';

export const HOT_BUNDLE_KEY = 'spicetify_jam_hot_bundle';
export const HOT_VERSION_KEY = 'spicetify_jam_hot_ver';
export const HOT_PATCH_KEY = 'spicetify_jam_hot_patch';

export const CURRENT_BUILD_VERSION = '1.7.3';
export const CURRENT_BUILD_PATCH = 0;

/**
 * Compares two SemVer versions with an optional numeric patch component.
 * Returns > 0 if A > B, < 0 if A < B, 0 if equal.
 */
export function compareVersions(aVer: string, aPatch: number, bVer: string, bPatch: number): number {
    const aParts = (aVer || '0.0.0').split('.').map(n => parseInt(n, 10) || 0);
    const bParts = (bVer || '0.0.0').split('.').map(n => parseInt(n, 10) || 0);

    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const a = aParts[i] || 0;
        const b = bParts[i] || 0;
        if (a !== b) return a - b;
    }
    return (aPatch || 0) - (bPatch || 0);
}

/**
 * Checks if a newer hot-bundle is cached in localStorage.
 * If found and valid, executes it dynamically and returns true (preventing local code from mounting twice).
 */
export function tryExecuteHotBundle(): boolean {
    if ((window as any).__JAM_HOT_LOADED__) return false;

    try {
        const cachedCode = localStorage.getItem(HOT_BUNDLE_KEY);
        const cachedVer = localStorage.getItem(HOT_VERSION_KEY);
        const cachedPatch = parseInt(localStorage.getItem(HOT_PATCH_KEY) || '0', 10);

        if (!cachedCode || !cachedVer) return false;

        // Only run if the cached bundle is strictly newer than this physical build
        if (compareVersions(cachedVer, cachedPatch, CURRENT_BUILD_VERSION, CURRENT_BUILD_PATCH) > 0) {
            console.log(`[Jam Hot-Loader] Executing dynamic bundle v${cachedVer} (patch ${cachedPatch})...`);
            (window as any).__JAM_HOT_LOADED__ = true;

            const scriptEl = document.createElement('script');
            scriptEl.type = 'text/javascript';
            scriptEl.id = 'spicetify-jam-hot-bundle';
            scriptEl.text = cachedCode;
            document.head.appendChild(scriptEl);
            return true;
        } else {
            // Local physical build is already equal or newer; clean up obsolete cache
            localStorage.removeItem(HOT_BUNDLE_KEY);
            localStorage.removeItem(HOT_VERSION_KEY);
            localStorage.removeItem(HOT_PATCH_KEY);
        }
    } catch (err) {
        console.error('[Jam Hot-Loader] Failed to evaluate cached bundle, clearing cache:', err);
        try {
            localStorage.removeItem(HOT_BUNDLE_KEY);
            localStorage.removeItem(HOT_VERSION_KEY);
            localStorage.removeItem(HOT_PATCH_KEY);
        } catch (_) {}
    }
    return false;
}

/**
 * Checks GitHub repository for updates in the background.
 * If a new version exists, downloads dist/spicetify-jam.js and caches it.
 */
export async function checkForAutoUpdate(onSuccess?: (newVer: string) => void): Promise<boolean> {
    try {
        const res = await fetch(`${MANIFEST_URL}?t=${Date.now()}`);
        if (!res.ok) return false;
        const remote = await res.json();
        if (!remote?.version) return false;

        const remoteVer = String(remote.version);
        const remotePatch = parseInt(remote.patch ?? 0, 10);

        const currentVer = localStorage.getItem(HOT_VERSION_KEY) || CURRENT_BUILD_VERSION;
        const currentPatch = parseInt(localStorage.getItem(HOT_PATCH_KEY) || String(CURRENT_BUILD_PATCH), 10);

        if (compareVersions(remoteVer, remotePatch, currentVer, currentPatch) > 0) {
            console.log(`[Jam AutoUpdater] Newer version found: v${remoteVer} (patch ${remotePatch}). Downloading...`);

            const bundleRes = await fetch(`${BUNDLE_URL}?t=${Date.now()}`);
            if (!bundleRes.ok) return false;
            const bundleCode = await bundleRes.text();

            // Sanity verification of downloaded bundle
            if (bundleCode.length > 5000 && bundleCode.includes('Spicetify')) {
                localStorage.setItem(HOT_BUNDLE_KEY, bundleCode);
                localStorage.setItem(HOT_VERSION_KEY, remoteVer);
                localStorage.setItem(HOT_PATCH_KEY, String(remotePatch));

                console.log(`[Jam AutoUpdater] Successfully updated cache to v${remoteVer} (patch ${remotePatch})`);
                if (window.Spicetify?.showNotification) {
                    window.Spicetify.showNotification(`✨ Spicetify Jam v${remoteVer} ready! Tap update banner or restart Spotify.`);
                }
                if (onSuccess) onSuccess(remoteVer);
                return true;
            }
        }
    } catch (err) {
        console.warn('[Jam AutoUpdater] Update check failed:', err);
    }
    return false;
}
