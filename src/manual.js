import { VrmRenderer as FaceRenderer } from './modules/vrmRenderer.js';

const renderCanvas = document.getElementById('renderCanvas');
const loadingOverlay = document.getElementById('loadingOverlay');
const rigNote = document.getElementById('rigNote');
const expressionContainer = document.getElementById('expressionSliders');
const poseContainer = document.getElementById('poseSliders');
const resetValuesBtn = document.getElementById('resetValuesBtn');
const resetViewBtn = document.getElementById('resetViewBtn');

const faceRenderer = new FaceRenderer(renderCanvas);
faceRenderer.resize();
faceRenderer.startRenderLoop();

// VRM expression presets (emotion presets + viseme/mouth shapes), driven
// directly via vrm.expressionManager.setValue(name, weight).
const EXPRESSION_CONTROLS = [
  { label: 'Happy',      type: 'single', name: 'happy' },
  { label: 'Sad',        type: 'single', name: 'sad' },
  { label: 'Angry',      type: 'single', name: 'angry' },
  { label: 'Surprised',  type: 'single', name: 'surprised' },
  { label: 'Relaxed',    type: 'single', name: 'relaxed' },
  { label: 'Eye Blink',  type: 'pair',   left: 'blinkLeft', right: 'blinkRight' },
  { label: 'Mouth Ah',   type: 'single', name: 'aa' },
  { label: 'Mouth Ih',   type: 'single', name: 'ih' },
  { label: 'Mouth Ou',   type: 'single', name: 'ou' },
  { label: 'Mouth Oh',   type: 'single', name: 'oh' }
];

const POSE_CONTROLS = [
  { label: 'Jaw',  type: 'single', name: 'aa' },
  { label: 'Neck', type: 'neck' }
];

function makeSliderRow(label, min, max, step, onChange) {
  const row = document.createElement('div');
  row.className = 'slider-row';
  row.innerHTML = `
    <span>${label}</span>
    <input type="range" min="${min}" max="${max}" step="${step}" value="0">
    <span class="val">0.00</span>
  `;
  const input = row.querySelector('input');
  const valSpan = row.querySelector('.val');
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    valSpan.textContent = v.toFixed(2);
    onChange(v);
  });
  row._input = input;
  row._valSpan = valSpan;
  return row;
}

const allRows = [];

function buildExpressionSliders() {
  for (const ctrl of EXPRESSION_CONTROLS) {
    const row = makeSliderRow(ctrl.label, 0, 1, 0.01, (v) => {
      if (ctrl.type === 'pair') faceRenderer.setInfluencePair(ctrl.left, ctrl.right, v);
      else faceRenderer.setInfluence(ctrl.name, v);
    });
    expressionContainer.appendChild(row);
    allRows.push(row);
  }
}

function buildPoseSliders() {
  for (const ctrl of POSE_CONTROLS) {
    if (ctrl.type === 'neck') {
      const row = makeSliderRow(ctrl.label, -30, 30, 1, (v) => faceRenderer.setNeckPitch(v));
      poseContainer.appendChild(row);
      allRows.push(row);
    } else {
      const row = makeSliderRow(ctrl.label, 0, 1, 0.01, (v) => faceRenderer.setInfluence(ctrl.name, v));
      poseContainer.appendChild(row);
      allRows.push(row);
    }
  }
}

function resetAllSliders() {
  for (const row of allRows) {
    row._input.value = 0;
    row._valSpan.textContent = '0.00';
  }
  faceRenderer.resetAllInfluences();
  faceRenderer.setNeckPitch(0);
}

buildExpressionSliders();
buildPoseSliders();

resetValuesBtn.addEventListener('click', resetAllSliders);
resetViewBtn.addEventListener('click', () => faceRenderer.resetView());

(async function loadRig() {
  try {
    const count = await faceRenderer.loadRig();
    loadingOverlay.style.display = 'none';
    rigNote.textContent = `${count} expressions loaded on the VRM anime avatar. Identity "Shape" sliders aren't included — VRM avatars are pre-modeled characters (not a parametric identity space like FLAME), so face shape comes from the .vrm file itself, not runtime sliders.`;
  } catch (err) {
    console.error(err);
    loadingOverlay.textContent = 'Failed to load 3D face rig: ' + err.message;
  }
})();
