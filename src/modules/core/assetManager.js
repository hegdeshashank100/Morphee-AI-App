/**
 * assetManager.js — Local & Offline Asset Management and Dual-Resolution Hub.
 *
 * CRITICAL ARCHITECTURAL ROLE:
 * Provides deterministic, offline-first resolution of all binary dependencies:
 * - MediaPipe WASM binaries (/wasm)
 * - MediaPipe Task Models (/models/*.task)
 * - Bundled Core VRM Avatars (/avatars/*.vrm)
 *
 * DUAL-RESOLUTION STRATEGY:
 * Attempts local bundled assets first. If in an environment where local paths
 * are inaccessible (or during remote development), seamlessly falls back to
 * remote Google Storage / jsDelivr / GitHub CDN endpoints with zero breakage.
 */

export const ASSET_PATHS = {
  wasm: {
    local: '/wasm',
    fallback: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
  },
  models: {
    face: {
      local: '/models/face_landmarker.task',
      fallback: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
    },
    hand: {
      local: '/models/hand_landmarker.task',
      fallback: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'
    },
    pose: {
      local: '/models/pose_landmarker_heavy.task',
      fallback: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task'
    }
  },
  avatars: {
    avatar_b: {
      local: '/avatars/AvatarSample_B.vrm',
      fallback: 'https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/stable/AvatarSample_B.vrm'
    },
    avatar_a: {
      local: '/avatars/AvatarSample_A.vrm',
      fallback: 'https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/stable/AvatarSample_A.vrm'
    }
  }
};

export class AssetManager {
  constructor(options = {}) {
    this._preferLocal = options.preferLocal !== false;
    this._probeTimeoutMs = options.probeTimeoutMs || 1500;
    
    /** Cache of verified availability: path -> boolean */
    this._availabilityCache = new Map();
    
    /** Event listeners */
    this._listeners = new Set();
  }

  /**
   * Check whether a local URL/path is reachable.
   * Caches results so multiple checks do not induce redundant network round-trips.
   * @param {string} url
   * @returns {Promise<boolean>}
   */
  async checkAvailability(url) {
    if (!url) return false;
    if (this._availabilityCache.has(url)) {
      return this._availabilityCache.get(url);
    }

    // Node.js environment check
    if (typeof process !== 'undefined' && process.versions && process.versions.node) {
      try {
        const fsMod = 'fs';
        const pathMod = 'path';
        const fs = await import(/* @vite-ignore */ fsMod);
        const path = await import(/* @vite-ignore */ pathMod);
        // If url starts with '/', resolve relative to public directory in cwd
        const normalized = url.startsWith('/') ? url.slice(1) : url;
        const localPath = path.resolve(process.cwd(), 'public', normalized);
        const exists = fs.existsSync(localPath) && fs.statSync(localPath).size > 0;
        this._availabilityCache.set(url, exists);
        return exists;
      } catch {
        // Fall back to false in node if file check fails
        this._availabilityCache.set(url, false);
        return false;
      }
    }

    // Browser environment check
    if (typeof fetch !== 'undefined') {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this._probeTimeoutMs);
        
        // Use HEAD to avoid downloading large payload just for reachability check
        const response = await fetch(url, {
          method: 'HEAD',
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        const ok = response.ok;
        this._availabilityCache.set(url, ok);
        return ok;
      } catch {
        // Fallback: in case HEAD is not supported on certain dev servers, try GET with small Range
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), this._probeTimeoutMs);
          const response = await fetch(url, {
            method: 'GET',
            headers: { Range: 'bytes=0-10' },
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          const ok = response.ok || response.status === 206;
          this._availabilityCache.set(url, ok);
          return ok;
        } catch {
          this._availabilityCache.set(url, false);
          return false;
        }
      }
    }

    return false;
  }

  /**
   * Resolve WASM binary directory path.
   * @returns {Promise<string>}
   */
  async getWasmPath() {
    if (!this._preferLocal) {
      return ASSET_PATHS.wasm.fallback;
    }

    // Test reachability of the primary internal js file
    const probeTarget = `${ASSET_PATHS.wasm.local}/vision_wasm_internal.js`;
    const isAvailable = await this.checkAvailability(probeTarget);
    if (isAvailable) {
      return ASSET_PATHS.wasm.local;
    }

    console.warn(`[AssetManager] Local WASM not available at ${ASSET_PATHS.wasm.local}, falling back to remote CDN.`);
    return ASSET_PATHS.wasm.fallback;
  }

  /**
   * Resolve task model path for 'face', 'hand', or 'pose'.
   * @param {'face'|'hand'|'pose'} modelKey
   * @returns {Promise<string>}
   */
  async getModelPath(modelKey) {
    const config = ASSET_PATHS.models[modelKey];
    if (!config) {
      throw new Error(`[AssetManager] Unknown model key: "${modelKey}"`);
    }

    if (!this._preferLocal) {
      return config.fallback;
    }

    const isAvailable = await this.checkAvailability(config.local);
    if (isAvailable) {
      return config.local;
    }

    console.warn(`[AssetManager] Local model "${modelKey}" not found at ${config.local}, falling back to remote URL.`);
    return config.fallback;
  }

  /**
   * Resolve avatar VRM model URL given definition or ID.
   * @param {string|object} avatarOrId
   * @returns {Promise<string>}
   */
  async getAvatarUrl(avatarOrId) {
    const id = typeof avatarOrId === 'string' ? avatarOrId : (avatarOrId && avatarOrId.id);
    const config = id ? ASSET_PATHS.avatars[id] : null;

    if (config) {
      if (this._preferLocal) {
        const isAvailable = await this.checkAvailability(config.local);
        if (isAvailable) {
          return config.local;
        }
      }
      return config.fallback;
    }

    // If avatar definition has a direct URL, respect it
    if (typeof avatarOrId === 'object' && avatarOrId.url) {
      if (avatarOrId.localUrl && this._preferLocal) {
        const isAvailable = await this.checkAvailability(avatarOrId.localUrl);
        if (isAvailable) return avatarOrId.localUrl;
      }
      return avatarOrId.url;
    }

    return '';
  }

  /**
   * Comprehensive introspection of asset status.
   * @returns {Promise<object>}
   */
  async getStatus() {
    const wasmOk = await this.checkAvailability(`${ASSET_PATHS.wasm.local}/vision_wasm_internal.js`);
    const faceOk = await this.checkAvailability(ASSET_PATHS.models.face.local);
    const handOk = await this.checkAvailability(ASSET_PATHS.models.hand.local);
    const poseOk = await this.checkAvailability(ASSET_PATHS.models.pose.local);
    const avatarBOk = await this.checkAvailability(ASSET_PATHS.avatars.avatar_b.local);
    const avatarAOk = await this.checkAvailability(ASSET_PATHS.avatars.avatar_a.local);

    const isFullyOffline = wasmOk && faceOk && handOk && poseOk && (avatarBOk || avatarAOk);

    return {
      isFullyOffline,
      preferLocal: this._preferLocal,
      wasm: { local: ASSET_PATHS.wasm.local, available: wasmOk },
      models: {
        face: { path: ASSET_PATHS.models.face.local, available: faceOk },
        hand: { path: ASSET_PATHS.models.hand.local, available: handOk },
        pose: { path: ASSET_PATHS.models.pose.local, available: poseOk }
      },
      avatars: {
        avatar_b: { path: ASSET_PATHS.avatars.avatar_b.local, available: avatarBOk },
        avatar_a: { path: ASSET_PATHS.avatars.avatar_a.local, available: avatarAOk }
      }
    };
  }
}

// Global Singleton Instance
export const assetManager = new AssetManager();
