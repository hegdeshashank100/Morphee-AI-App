/**
 * avatarPreviewGenerator.js — Single-Context Shared Offscreen VRM Preview Generator.
 *
 * CRITICAL ARCHITECTURAL ROLE:
 * Generates high-fidelity 2D static thumbnails (256x340) directly from real 3D VRM models
 * using ONE transient offscreen WebGLRenderer context.
 *
 * GUARANTEES:
 * 1. Zero persistent WebGL contexts (renderer is disposed after generation).
 * 2. Zero network requests during thumbnail generation for offline operation.
 *    Non-bundled avatars are cleanly flagged as 'unavailable' without network fetching.
 * 3. Studio portrait lighting and humanoid head-relative camera positioning.
 * 4. Immediate VRAM disposal of each temporary VRM model via disposeVRM().
 * 5. Caches generated data URLs in avatarRegistry.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { disposeVRM } from '../stage/vramDisposer.js';
import { avatarRegistry as defaultRegistry } from './avatarRegistry.js';

export class AvatarPreviewGenerator {
  constructor(registry = defaultRegistry) {
    this.registry = registry;
    this._cache = new Map(); // id -> dataUrl
    this._isGenerating = false;
    this._listeners = new Set();
  }

  /**
   * Subscribe to thumbnail generation completion events.
   * @param {function(string, string|null)} callback - (avatarId, dataUrl)
   */
  onThumbnailReady(callback) {
    this._listeners.add(callback);
    return () => this._listeners.delete(callback);
  }

  _notify(avatarId, dataUrl) {
    for (const listener of this._listeners) {
      try {
        listener(avatarId, dataUrl);
      } catch (err) {
        console.warn('[AvatarPreviewGenerator] Listener error:', err);
      }
    }
  }

  /**
   * Gets cached thumbnail data URL for avatar ID.
   * @param {string} avatarId 
   * @returns {string|null}
   */
  getThumbnail(avatarId) {
    return this._cache.get(avatarId) || (this.registry?.getThumbnail ? this.registry.getThumbnail(avatarId) : null) || null;
  }

  /**
   * Generates thumbnails sequentially for all definitions in the registry.
   * Disposes the offscreen WebGL renderer immediately upon completion.
   *
   * @param {Array<object>} [definitions] - Optional array of avatar definitions
   * @returns {Promise<Map<string, string|null>>} Map of avatarId -> dataUrl (or null)
   */
  async generateAll(definitions = null) {
    if (this._isGenerating) {
      return this._cache;
    }
    this._isGenerating = true;

    const defs = definitions || (this.registry?.getAll ? this.registry.getAll() : []);
    
    // Check if running in an environment with WebGL support
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      this._isGenerating = false;
      return this._cache;
    }

    let canvas = null;
    let renderer = null;
    let scene = null;
    let camera = null;

    try {
      // 1. Create single shared offscreen canvas and renderer
      const width = 256;
      const height = 340;

      canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
        powerPreference: 'low-power'
      });
      renderer.setSize(width, height, false);
      renderer.setPixelRatio(1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      // 2. Set up studio portrait lighting
      scene = new THREE.Scene();
      scene.background = null; // Transparent background for sleek glassmorphic cards

      const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
      scene.add(ambientLight);

      const keyLight = new THREE.DirectionalLight(0xfff5ea, 1.3);
      keyLight.position.set(1.0, 2.0, 1.5);
      scene.add(keyLight);

      const fillLight = new THREE.DirectionalLight(0xddeeff, 0.7);
      fillLight.position.set(-1.0, 1.2, 1.0);
      scene.add(fillLight);

      const rimLight = new THREE.DirectionalLight(0xa5b4fc, 0.5);
      rimLight.position.set(0, 2.5, -1.5);
      scene.add(rimLight);

      // 3. Perspective camera framed for bust / portrait composition
      camera = new THREE.PerspectiveCamera(28, width / height, 0.1, 20);
      camera.position.set(0, 1.38, 0.88);
      camera.lookAt(0, 1.33, 0);

      // 4. Process each avatar sequentially
      for (const def of defs) {
        if (!def || !def.id) continue;

        // If already cached in memory as data URL, keep and continue
        if (this._cache.has(def.id) && this._cache.get(def.id)) {
          continue;
        }

        // Check if registry already has a rendered data URL for this avatar
        const regThumb = this.registry?.getThumbnail ? this.registry.getThumbnail(def.id) : null;
        if (regThumb && typeof regThumb === 'string' && regThumb.startsWith('data:image/')) {
          this._cache.set(def.id, regThumb);
          continue;
        }

        // Strict offline policy: only generate for locally bundled avatars with local URLs
        if (!def.bundled || !def.url || def.url.startsWith('http://') || def.url.startsWith('https://')) {
          this._cache.set(def.id, null);
          if (this.registry?.setThumbnail) {
            this.registry.setThumbnail(def.id, null);
          }
          this._notify(def.id, null);
          continue;
        }

        try {
          const dataUrl = await this._renderVrmThumbnail(def.url, scene, camera, renderer, canvas);
          if (dataUrl) {
            this._cache.set(def.id, dataUrl);
            if (this.registry?.setThumbnail) {
              this.registry.setThumbnail(def.id, dataUrl);
            }
            this._notify(def.id, dataUrl);
          } else {
            this._cache.set(def.id, null);
            if (this.registry?.setThumbnail) {
              this.registry.setThumbnail(def.id, null);
            }
            this._notify(def.id, null);
          }
        } catch (err) {
          console.warn(`[AvatarPreviewGenerator] Failed generating thumbnail for '${def.id}':`, err?.message || err);
          this._cache.set(def.id, null);
          if (this.registry?.setThumbnail) {
            this.registry.setThumbnail(def.id, null);
          }
          this._notify(def.id, null);
        }
      }
    } catch (err) {
      console.warn('[AvatarPreviewGenerator] Offscreen WebGL initialization skipped:', err?.message || err);
    } finally {
      // 5. Cleanly dispose the offscreen WebGLRenderer and free GPU context
      if (renderer) {
        try {
          renderer.dispose();
          renderer.forceContextLoss?.();
          const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
          gl?.getExtension('WEBGL_lose_context')?.loseContext();
        } catch (e) {
          // Ignore context disposal errors
        }
      }
      canvas = null;
      renderer = null;
      scene = null;
      camera = null;
      this._isGenerating = false;
    }

    return this._cache;
  }

  /**
   * Loads a single VRM, renders 1 portrait frame, and extracts data URL.
   * @private
   */
  _renderVrmThumbnail(url, scene, camera, renderer, canvas) {
    return new Promise((resolve) => {
      const loader = new GLTFLoader();
      loader.register((parser) => new VRMLoaderPlugin(parser));

      const timeoutId = setTimeout(() => {
        resolve(null);
      }, 6000); // 6s safety timeout per avatar

      loader.load(
        url,
        (gltf) => {
          clearTimeout(timeoutId);
          let vrm = null;
          try {
            vrm = gltf.userData?.vrm;
            if (!vrm) {
              resolve(null);
              return;
            }

            try {
              VRMUtils.removeUnnecessaryVertices(gltf.scene);
              VRMUtils.removeUnnecessaryJoints(gltf.scene);
              VRMUtils.rotateVRM0(vrm);
            } catch (optErr) {
              console.warn('[AvatarPreviewGenerator] Optimization warning:', optErr?.message || optErr);
            }

            scene.add(vrm.scene);

            // Frame camera to the character's head position
            const headBone = vrm.humanoid?.getNormalizedBoneNode('head') || vrm.humanoid?.getRawBoneNode('head');
            let headY = 1.40;
            let headX = 0;
            let headZ = 0;
            if (headBone) {
              vrm.scene.updateMatrixWorld(true);
              const headPos = new THREE.Vector3();
              headBone.getWorldPosition(headPos);
              if (headPos.y > 0.2 && headPos.y < 3.0) {
                headY = headPos.y;
                headX = headPos.x;
                headZ = headPos.z;
              }
            } else {
              // Bounding box fallback for non-standard humanoid / robotic rigs
              const bbox = new THREE.Box3().setFromObject(vrm.scene);
              if (!bbox.isEmpty()) {
                const size = new THREE.Vector3();
                const center = new THREE.Vector3();
                bbox.getSize(size);
                bbox.getCenter(center);
                headY = bbox.min.y + size.y * 0.85;
                headX = center.x;
                headZ = center.z;
              }
            }

            camera.position.set(headX, headY - 0.02, headZ + 0.84);
            camera.lookAt(headX, headY - 0.06, headZ);
            camera.updateMatrixWorld();

            // Render single static frame
            renderer.render(scene, camera);

            // Extract data URL (webp preferred for small size, png fallback)
            let dataUrl = null;
            try {
              dataUrl = canvas.toDataURL('image/webp', 0.90);
              if (!dataUrl || dataUrl === 'data:,' || !dataUrl.startsWith('data:image/webp')) {
                dataUrl = canvas.toDataURL('image/png');
              }
            } catch (e) {
              try {
                dataUrl = canvas.toDataURL('image/png');
              } catch (e2) {
                dataUrl = null;
              }
            }

            // Remove from scene and deep dispose
            try {
              scene.remove(vrm.scene);
              disposeVRM(vrm);
            } catch (e) {}

            resolve(dataUrl);
          } catch (err) {
            if (vrm) {
              try {
                scene.remove(vrm.scene);
                disposeVRM(vrm);
              } catch (e) {}
            }
            resolve(null);
          }
        },
        undefined,
        (err) => {
          clearTimeout(timeoutId);
          resolve(null);
        }
      );
    });
  }
}

export const avatarPreviewGenerator = new AvatarPreviewGenerator();
export default avatarPreviewGenerator;
