/**
 * GPU Detection & Capability Reporter
 *
 * Detects whether the system has an NVIDIA GPU (CUDA-capable) or other
 * hardware acceleration available via WebGL, and reports detailed info
 * to the UI.
 */

export function detectGPU() {
  const info = {
    renderer: 'Unknown',
    vendor: 'Unknown',
    webglVersion: 'N/A',
    maxTextureSize: 0,
    isNvidia: false,
    isCudaCapable: false,
    isHardwareAccelerated: false,
    delegate: 'CPU', // MediaPipe delegate to use
    summary: '',
  };

  // Try WebGL2 first, fall back to WebGL1
  const canvas = document.createElement('canvas');
  let gl = canvas.getContext('webgl2');
  if (gl) {
    info.webglVersion = 'WebGL 2.0';
  } else {
    gl = canvas.getContext('webgl');
    if (gl) info.webglVersion = 'WebGL 1.0';
  }

  if (!gl) {
    info.summary = 'No WebGL support detected — running on CPU.';
    return info;
  }

  // Get unmasked renderer info (the actual GPU name)
  const debugExt = gl.getExtension('WEBGL_debug_renderer_info');
  if (debugExt) {
    info.renderer = gl.getParameter(debugExt.UNMASKED_RENDERER_WEBGL) || 'Unknown';
    info.vendor = gl.getParameter(debugExt.UNMASKED_VENDOR_WEBGL) || 'Unknown';
  } else {
    info.renderer = gl.getParameter(gl.RENDERER) || 'Unknown';
    info.vendor = gl.getParameter(gl.VENDOR) || 'Unknown';
  }

  info.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0;

  // Detect NVIDIA
  const rendererLower = info.renderer.toLowerCase();
  const vendorLower = info.vendor.toLowerCase();

  if (rendererLower.includes('nvidia') || vendorLower.includes('nvidia')) {
    info.isNvidia = true;
    info.isCudaCapable = true;
    info.isHardwareAccelerated = true;
    info.delegate = 'GPU';
    info.summary = `NVIDIA GPU detected — CUDA acceleration active.`;
  } else if (rendererLower.includes('amd') || rendererLower.includes('radeon')) {
    info.isHardwareAccelerated = true;
    info.delegate = 'GPU';
    info.summary = `AMD GPU detected — hardware acceleration active.`;
  } else if (rendererLower.includes('intel')) {
    info.isHardwareAccelerated = true;
    info.delegate = 'GPU';
    info.summary = `Intel GPU detected — hardware acceleration active.`;
  } else if (rendererLower.includes('apple') || rendererLower.includes('m1') || rendererLower.includes('m2') || rendererLower.includes('m3')) {
    info.isHardwareAccelerated = true;
    info.delegate = 'GPU';
    info.summary = `Apple Silicon detected — Metal acceleration active.`;
  } else {
    info.delegate = 'GPU'; // Still try GPU delegate in WebGL context
    info.summary = `GPU: ${info.renderer}`;
  }

  // Clean up the temporary canvas
  canvas.remove();

  return info;
}

/**
 * Write GPU info to the UI elements
 */
export function populateGPUInfo(gpuInfo) {
  // Sidebar status
  const gpuStatus = document.getElementById('gpuStatus');
  const gpuName = document.getElementById('gpuName');
  const gpuDetail = document.getElementById('gpuDetail');
  const gpuIcon = document.getElementById('gpuIcon');

  if (gpuName) {
    if (gpuInfo.isNvidia) {
      gpuName.textContent = 'NVIDIA CUDA Active';
      gpuDetail.textContent = gpuInfo.renderer;
      gpuIcon.textContent = '🟢';
      if (gpuStatus) gpuStatus.classList.add('nvidia');
    } else if (gpuInfo.isHardwareAccelerated) {
      gpuName.textContent = 'GPU Accelerated';
      gpuDetail.textContent = gpuInfo.renderer;
      gpuIcon.textContent = '⚡';
    } else {
      gpuName.textContent = 'CPU Only';
      gpuDetail.textContent = 'No GPU acceleration';
      gpuIcon.textContent = '🔴';
    }
  }

  // Settings page details
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('gpuInfoRenderer', gpuInfo.renderer);
  set('gpuInfoVendor', gpuInfo.vendor);
  set('gpuInfoWebGL', gpuInfo.webglVersion);
  set('gpuInfoMaxTex', gpuInfo.maxTextureSize ? `${gpuInfo.maxTextureSize}px` : 'N/A');
  set('gpuInfoCuda', gpuInfo.isCudaCapable ? '✅ CUDA Ready' : gpuInfo.isHardwareAccelerated ? '✅ HW Accel' : '❌ Not Available');
}
