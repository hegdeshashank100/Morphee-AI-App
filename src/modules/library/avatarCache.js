/**
 * avatarCache.js — Error-Bounded Avatar Cache & Lazy Loading Engine.
 *
 * CRITICAL ARCHITECTURAL ROLE:
 * Manages the lifecycle of loaded AvatarInstance objects:
 *   - Lazy loading: VRMs are only loaded when explicitly selected or required.
 *   - In-flight deduplication: Simultaneous load requests for the same avatar share one Promise.
 *   - Warm cache reuse: An avatar in cache is reassigned without network, disk, or parsing overhead.
 *   - LRU eviction: Idle avatars beyond maxCached are safely disposed via vramDisposer.js.
 *   - Error boundary: Corrupt, missing, or failed models are caught gracefully, falling back to
 *     a verified bundled avatar without crashing the application or WebGL context.
 */

import { AvatarInstance } from '../stage/avatarInstance.js';
import { disposeVRM } from '../stage/vramDisposer.js';
import { avatarRegistry } from './avatarRegistry.js';

export const AVATAR_STATE = {
  UNLOADED: 'unloaded',
  LOADING: 'loading',
  ACTIVE: 'active',
  CACHED: 'cached',
  FAILED: 'failed'
};

export class AvatarCache {
  /**
   * @param {object} [options]
   * @param {number} [options.maxCached=3] Max idle/standby avatars retained in memory
   * @param {string} [options.defaultAvatarId='avatar_b'] Safe fallback avatar ID (Hana)
   */
  constructor(options = {}) {
    this.maxCached = options.maxCached ?? 3;
    this.defaultAvatarId = options.defaultAvatarId ?? 'avatar_b';

    /**
     * @type {Map<string, {
     *   instance: AvatarInstance,
     *   state: string,
     *   lastUsed: number,
     *   error: string|null
     * }>}
     */
    this._cache = new Map();

    /** @type {Map<string, Promise<AvatarInstance>>} In-flight loading promises to prevent duplicate loads */
    this._inFlightLoads = new Map();
  }

  get size() {
    return this._cache.size;
  }

  get capacity() {
    return this.maxCached;
  }

  /**
   * Acquire an AvatarInstance by ID or definition.
   * Leverages warm cache if available, deduplicates in-flight loads,
   * and catches errors with safe fallback.
   *
   * @param {string|object} avatarDefOrId 
   * @param {object} [options]
   * @param {boolean} [options.allowFallback=true] Fallback to default avatar if requested model fails
   * @param {function} [options.onProgress]
   * @returns {Promise<{ avatar: AvatarInstance, fromCache: boolean, fallback: boolean, error?: string }>}
   */
  async acquire(avatarDefOrId, options = {}) {
    const { allowFallback = true, onProgress = undefined, trackId = null } = options;

    const id = typeof avatarDefOrId === 'string' ? avatarDefOrId : avatarDefOrId?.id;
    let def = typeof avatarDefOrId === 'object' && avatarDefOrId !== null
      ? avatarDefOrId
      : avatarRegistry.get(id);

    // If active track requires an already-active avatar definition, scope cache key by trackId
    const baseEntry = this._cache.get(id);
    const key = (trackId && baseEntry?.state === AVATAR_STATE.ACTIVE && baseEntry?.trackId && baseEntry.trackId !== trackId)
      ? `${id}_track_${trackId}`
      : id;

    if (!id || (!def && !this._cache.has(key))) {
      const err = new Error(`Avatar ID '${id}' not found in registry.`);
      if (allowFallback && id !== this.defaultAvatarId) {
        return this._executeFallback(id, err.message, options);
      }
      throw err;
    }

    // 1. Check if already resident in cache (ACTIVE or CACHED)
    const existing = this._cache.get(key);
    if (existing?.instance?.isLoaded) {
      existing.state = AVATAR_STATE.ACTIVE;
      existing.trackId = trackId;
      existing.lastUsed = Date.now();
      avatarRegistry.recordUsage(id);
      return {
        avatar: existing.instance,
        fromCache: true,
        fallback: false
      };
    }

    // 2. Check if identical load is currently in-flight (deduplication)
    if (this._inFlightLoads.has(key)) {
      try {
        const instance = await this._inFlightLoads.get(key);
        const cached = this._cache.get(key);
        if (cached) {
          cached.state = AVATAR_STATE.ACTIVE;
          cached.trackId = trackId;
        }
        avatarRegistry.recordUsage(id);
        return {
          avatar: instance,
          fromCache: false,
          fallback: false
        };
      } catch (inFlightErr) {
        if (allowFallback && id !== this.defaultAvatarId) {
          return this._executeFallback(id, inFlightErr.message, options);
        }
        throw inFlightErr;
      }
    }

    // 3. Initiate new lazy load with Error Boundary
    const loadPromise = this._loadAvatarInstance(key, def, onProgress, trackId);
    this._inFlightLoads.set(key, loadPromise);

    try {
      const instance = await loadPromise;
      avatarRegistry.recordUsage(id);

      // Perform LRU cache eviction of idle avatars if over limit
      this._evictOldestCached();

      return {
        avatar: instance,
        fromCache: false,
        fallback: false
      };
    } catch (loadErr) {
      console.error(`[AvatarCache] Failed to load avatar '${id}':`, loadErr);

      // Record failed state
      const failedEntry = this._cache.get(id);
      if (failedEntry) {
        failedEntry.state = AVATAR_STATE.FAILED;
        failedEntry.error = loadErr.message;
      }

      if (allowFallback && id !== this.defaultAvatarId) {
        return this._executeFallback(id, loadErr.message, options);
      }
      throw loadErr;
    } finally {
      this._inFlightLoads.delete(key);
    }
  }

  async _loadAvatarInstance(key, def, onProgress, trackId = null) {
    const url = def.url || def.vrmUrl;
    if (!url) {
      throw new Error(`Avatar '${key}' definition has no valid VRM URL.`);
    }

    // Register placeholder loading state
    this._cache.set(key, {
      instance: null,
      state: AVATAR_STATE.LOADING,
      trackId,
      lastUsed: Date.now(),
      error: null
    });

    const instance = new AvatarInstance(key, def.name || key);
    try {
      await instance.load(url, onProgress);
    } catch (loadErr) {
      if (def.fallbackUrl && def.fallbackUrl !== url) {
        console.warn(`[AvatarCache] Primary URL failed for '${key}', trying fallbackUrl: ${def.fallbackUrl}`);
        await instance.load(def.fallbackUrl, onProgress);
      } else {
        throw loadErr;
      }
    }

    // Update state to ACTIVE
    this._cache.set(key, {
      instance,
      state: AVATAR_STATE.ACTIVE,
      trackId,
      lastUsed: Date.now(),
      error: null
    });

    return instance;
  }

  async _executeFallback(failedId, errorMsg, originalOptions) {
    console.warn(
      `[AvatarCache] Triggering safe fallback for '${failedId}' -> Loading default '${this.defaultAvatarId}'. Reason: ${errorMsg}`
    );

    const fallbackResult = await this.acquire(this.defaultAvatarId, {
      ...originalOptions,
      allowFallback: false // prevent infinite recursion
    });

    return {
      avatar: fallbackResult.avatar,
      fromCache: fallbackResult.fromCache,
      fallback: true,
      error: errorMsg,
      failedId
    };
  }

  /**
   * Release an active avatar into the warm standby cache.
   * It is NOT disposed immediately, so re-acquiring it is instantaneous.
   * @param {string} avatarId 
   * @param {number|null} [trackId=null]
   */
  release(avatarId, trackId = null) {
    const key = (trackId && this._cache.has(`${avatarId}_track_${trackId}`))
      ? `${avatarId}_track_${trackId}`
      : avatarId;
    const entry = this._cache.get(key);
    if (!entry) return;

    if (entry.state === AVATAR_STATE.ACTIVE) {
      entry.state = AVATAR_STATE.CACHED;
      entry.trackId = null;
      entry.lastUsed = Date.now();
      if (entry.instance) {
        entry.instance.visible = false;
        if (typeof entry.instance.resetPoseAndHands === 'function') {
          entry.instance.resetPoseAndHands();
        }
        if (typeof entry.instance.resetAllInfluences === 'function') {
          entry.instance.resetAllInfluences();
        }
      }
    }

    this._evictOldestCached();
  }

  /**
   * Evicts the least-recently-used idle cached avatar if cache size exceeds maxCached.
   * CRITICAL: Never evicts an ACTIVE avatar.
   */
  _evictOldestCached() {
    const cachedEntries = Array.from(this._cache.entries())
      .filter(([_, entry]) => entry.state === AVATAR_STATE.CACHED);

    if (cachedEntries.length <= this.maxCached) return;

    // Sort by lastUsed ascending (oldest first)
    cachedEntries.sort((a, b) => a[1].lastUsed - b[1].lastUsed);

    const excessCount = cachedEntries.length - this.maxCached;
    for (let i = 0; i < excessCount; i++) {
      const [evictId, evictEntry] = cachedEntries[i];
      this.evict(evictId);
    }
  }

  /**
   * Explicitly evicts and disposes a specific avatar from GPU VRAM.
   * @param {string} avatarId 
   * @returns {boolean} true if evicted, false if active or not found
   */
  evict(avatarId) {
    const entry = this._cache.get(avatarId);
    if (!entry) return false;

    // Safety rule: Never evict an active avatar
    if (entry.state === AVATAR_STATE.ACTIVE) {
      console.warn(`[AvatarCache] Refusing to evict active avatar '${avatarId}'.`);
      return false;
    }

    if (entry.instance?.vrm) {
      disposeVRM(entry.instance.vrm);
      entry.instance.dispose();
    }

    this._cache.delete(avatarId);
    return true;
  }

  /**
   * Disposes and clears all idle cached avatars.
   */
  clearAllCached() {
    for (const [id, entry] of Array.from(this._cache.entries())) {
      if (entry.state === AVATAR_STATE.CACHED) {
        this.evict(id);
      }
    }
  }

  /**
   * Check state of an avatar in the cache.
   * @param {string} avatarId 
   */
  getState(avatarId) {
    return this._cache.get(avatarId)?.state ?? AVATAR_STATE.UNLOADED;
  }

  /**
   * Returns diagnostic stats for testing and profiling.
   */
  getStats() {
    let active = 0, cached = 0, loading = 0, failed = 0;
    for (const entry of this._cache.values()) {
      if (entry.state === AVATAR_STATE.ACTIVE) active++;
      else if (entry.state === AVATAR_STATE.CACHED) cached++;
      else if (entry.state === AVATAR_STATE.LOADING) loading++;
      else if (entry.state === AVATAR_STATE.FAILED) failed++;
    }

    return {
      totalEntries: this._cache.size,
      active,
      cached,
      loading,
      failed,
      inFlightLoads: this._inFlightLoads.size,
      maxCached: this.maxCached
    };
  }
}

// Global avatar cache singleton
export const avatarCache = new AvatarCache();
export default avatarCache;
