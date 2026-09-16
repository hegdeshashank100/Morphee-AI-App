/**
 * vramDisposer.js — Deep recursive GPU resource and VRAM disposal utility for Three.js & VRM.
 *
 * CRITICAL ARCHITECTURAL ROLE:
 * Resolves the progressive VRAM memory leak that occurs when switching avatars or unbinding tracks.
 * Safely traverses the entire object hierarchy, disposing BufferGeometries, Materials, and Textures
 * without crashing on non-standard material properties or causing double-disposal errors.
 */

/**
 * Disposes a single Three.js Material and all its attached textures.
 * @param {THREE.Material} material 
 * @param {Set<any>} disposedSet - Tracks already-disposed objects to prevent duplicate calls.
 */
export function disposeMaterial(material, disposedSet = new Set()) {
  if (!material || disposedSet.has(material)) return;
  disposedSet.add(material);

  try {
    // Iterate through all material properties to find attached textures
    for (const key of Object.keys(material)) {
      const value = material[key];
      if (value && typeof value === 'object') {
        // Direct texture map check (map, normalMap, roughnessMap, alphaMap, etc.)
        if (value.isTexture && typeof value.dispose === 'function' && !disposedSet.has(value)) {
          disposedSet.add(value);
          try {
            value.dispose();
          } catch (texErr) {
            console.warn(`[vramDisposer] Warning disposing texture on ${key}:`, texErr);
          }
        }
      }
    }

    // Dispose the material itself (clears shader programs in WebGL)
    if (typeof material.dispose === 'function') {
      material.dispose();
    }
  } catch (matErr) {
    console.warn('[vramDisposer] Warning disposing material:', matErr);
  }
}

/**
 * Recursively disposes an entire Three.js Object3D hierarchy (meshes, geometries, materials).
 * @param {THREE.Object3D} root 
 * @param {Set<any>} disposedSet 
 */
export function disposeHierarchy(root, disposedSet = new Set()) {
  if (!root) return;

  root.traverse((obj) => {
    if (disposedSet.has(obj)) return;

    try {
      // 1. Dispose Geometry
      if (obj.geometry && typeof obj.geometry.dispose === 'function' && !disposedSet.has(obj.geometry)) {
        disposedSet.add(obj.geometry);
        obj.geometry.dispose();
      }

      // 2. Dispose Material(s)
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          for (const mat of obj.material) {
            disposeMaterial(mat, disposedSet);
          }
        } else {
          disposeMaterial(obj.material, disposedSet);
        }
      }
    } catch (nodeErr) {
      console.warn('[vramDisposer] Warning disposing node:', obj.name || obj.uuid, nodeErr);
    }
  });

  // Remove from parent if still attached to a scene
  if (root.parent) {
    root.parent.remove(root);
  }
}

/**
 * Completely unloads and disposes a VRM avatar instance.
 * @param {import('@pixiv/three-vrm').VRM} vrm 
 * @param {THREE.Scene} [scene] Optional parent scene to remove from
 * @returns {{ geometriesDisposed: number, materialsDisposed: number, texturesDisposed: number }}
 */
export function disposeVRM(vrm, scene = null) {
  if (!vrm) return { geometriesDisposed: 0, materialsDisposed: 0, texturesDisposed: 0 };

  const disposedSet = new Set();

  try {
    // 1. Detach from Three.js scene graph
    if (vrm.scene) {
      if (scene) {
        scene.remove(vrm.scene);
      } else if (vrm.scene.parent) {
        vrm.scene.parent.remove(vrm.scene);
      }
    }

    // 2. Destroy VRM Expression Manager if present
    if (vrm.expressionManager && typeof vrm.expressionManager.destroy === 'function') {
      try {
        vrm.expressionManager.destroy();
      } catch (emErr) {
        console.warn('[vramDisposer] Warning destroying expressionManager:', emErr);
      }
    }

    // 3. Reset Humanoid bone poses to default rest pose
    if (vrm.humanoid && typeof vrm.humanoid.resetNormalizedPose === 'function') {
      try {
        vrm.humanoid.resetNormalizedPose();
      } catch (hErr) {
        console.warn('[vramDisposer] Warning resetting humanoid pose:', hErr);
      }
    }

    // 4. Dispose all meshes, geometries, and materials in the VRM scene graph
    if (vrm.scene) {
      disposeHierarchy(vrm.scene, disposedSet);
    }
  } catch (err) {
    console.error('[vramDisposer] Error during VRM disposal:', err);
  }

  // Count items disposed for diagnostic verification
  let geometriesDisposed = 0;
  let materialsDisposed = 0;
  let texturesDisposed = 0;

  for (const item of disposedSet) {
    if (item?.isBufferGeometry) geometriesDisposed++;
    else if (item?.isMaterial) materialsDisposed++;
    else if (item?.isTexture) texturesDisposed++;
  }

  return { geometriesDisposed, materialsDisposed, texturesDisposed };
}
