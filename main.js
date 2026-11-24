import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/addons/loaders/GLTFLoader.js';
import { retargetClip, retarget } from './vendor/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from './vendor/addons/utils/BufferGeometryUtils.js';
window.__step_loaded = true;
const AV = '266'; // asset cache-buster: cached .glb/.jpg URLs change when assets change
function showErr(msg) {
  if (!location.search.includes('dev=1') && started) return; // once the walk is running, production stays silent
  let d = document.getElementById('err');
  if (!d) { d = document.createElement('div'); d.id = 'err';
    d.style.cssText = 'position:fixed;top:10px;left:10px;z-index:99;color:#ff6b7a;font:12px ui-monospace,monospace;white-space:pre-wrap;max-width:60%';
    document.body.appendChild(d); }
  d.textContent += msg + '\n';
}
window.addEventListener('error', (e) => showErr('JS: ' + (e.message || 'load error')));
setTimeout(() => { // stalled downloads never fire onerror; give them one fresh start
  if (!window.__step_loaded) return;
  if (typeof STARTABLE === 'boolean' && !STARTABLE && !sessionStorage.getItem('step_reload1')) {
    sessionStorage.setItem('step_reload1', '1');
    location.reload();
  }
}, 50000);
setTimeout(() => { if (!window.__step_loaded) showErr('main.js が読み込めていない（ブラウザが古い可能性）'); }, 2500);

// ============ CONFIG ============
// ============================================================
// STEP — walk to the beat, Stage 1: dawn suburbs -> station plaza
// file order:
//   1 config, palettes, textures      2 road / ground / sky / distance
//   3 props: load queue + placement rules (center -> ground -> overlap) + zone layout
//   4 station plaza & train           5 legacy city / dusk modes (off by default)
//   6 characters, clips, choreography 7 music (synth groove; song.mp3 wins if present)
//   8 input & step state machine      9 frame loop
//  10 dev tools (?dev=1: warp, scrubbers, minimap; ?z= ?sun= ?map=1)
// ============================================================
const CONFIG = {
  bpm: 100,          // song.mp3 を置いたら、その曲の BPM に合わせる
  stride: 0.62,      // 1歩(=1ビート)で進むメートル
  swing: 1 / 12,     // シャッフルの揺れ（ビート単位）
};
const BEAT = 60 / CONFIG.bpm;
const SPEED = CONFIG.stride / BEAT;
const WANT_CITY = new URLSearchParams(location.search).has('city');
const WANT_DUSK = new URLSearchParams(location.search).has('dusk');
const WANT_STAGE = !WANT_CITY && !WANT_DUSK;   // 既定はステージ1：朝焼けの郊外一本道
// 実街スケール（A3並の16m道路）かgraybox用狭道か
const RW = WANT_CITY ? 8.0 : (WANT_STAGE ? 2.8 : 2.2);   // 車道の半幅

// ============ renderer / scene ============
const renderer = new THREE.WebGLRenderer({ antialias: true });
// an iPhone at ratio 2 shades ~9x the pixels of the same view at 1 —
// on a touch device that resolution bought nothing and ate the frame budget
const COARSE = matchMedia && matchMedia('(pointer: coarse)').matches;
renderer.setPixelRatio(Math.min(devicePixelRatio, COARSE ? 1.25 : 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.05, 1000);
scene.add(camera);
scene.fog = new THREE.Fog(0x7a3f8f, 20, 150);
scene.background = new THREE.Color(0x4a2f6e);

const hemi = new THREE.HemisphereLight(0xffffff, 0x221133, 1.1);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xffffff, 1.4);
key.position.set(6, 12, 4);
scene.add(key);
const fill = new THREE.DirectionalLight(0xb08ad8, 0.8);
fill.position.set(-6, 7, -12);
scene.add(fill);

// ============ palettes (一本道の黄昏、同族で微変) ============
const PALETTES = [
  { sky: 0x31215e, fog: 0x7a3f8f, light: 0xff3ec8, light2: 0x39c9ff, ground: 0x1d1628, prop: 0x241b3a, hemi: 0x6b4a8f, zenith: 0x241b4d, horizon: 0xc75bb0 },
  { sky: 0x241d55, fog: 0x5c4ba6, light: 0x39c9ff, light2: 0xff3ec8, ground: 0x191628, prop: 0x222a55, hemi: 0x4a55aa, zenith: 0x1a1740, horizon: 0x8f6fc8 },
  { sky: 0x3d1f5e, fog: 0x9c56c8, light: 0xff7ad0, light2: 0x6fd6ff, ground: 0x241a2e, prop: 0x3c2450, hemi: 0x9a5ac0, zenith: 0x2c1a4a, horizon: 0xe07ac0 },
  { sky: 0x1c1a4a, fog: 0x3e3a86, light: 0x9fb8ff, light2: 0xff5ce0, ground: 0x16152a, prop: 0x26305e, hemi: 0x3a4a9a, zenith: 0x121038, horizon: 0x6f6ac0 },
];
if (WANT_STAGE) PALETTES.splice(0, PALETTES.length,
  { sky: 0x2a3a68, fog: 0x3d5080, light: 0x93a8d2, light2: 0xa9bce0, ground: 0x2c2f3a, prop: 0x333a4c, hemi: 0x5c6ea3, zenith: 0x1d2a55, horizon: 0x6f85ae },
  { sky: 0x2c3c6b, fog: 0x405383, light: 0x97acd6, light2: 0xaec0e4, ground: 0x2e313c, prop: 0x353c4e, hemi: 0x5f71a6, zenith: 0x1e2b57, horizon: 0x7288b2 },
  { sky: 0x293965, fog: 0x3b4e7c, light: 0x90a5cc, light2: 0xa6b8da, ground: 0x2b2e38, prop: 0x323848, hemi: 0x596b9e, zenith: 0x1c2952, horizon: 0x6c82aa },
  { sky: 0x2b3b69, fog: 0x3e5180, light: 0x94a8d0, light2: 0xaabce0, ground: 0x2d303a, prop: 0x343a4a, hemi: 0x5d6fa2, zenith: 0x1d2a55, horizon: 0x7086b0 });
const SECTION_LEN = 60;
// stage 1 sunrise: as bars pass, the whole world lerps from pre-dawn toward morning
const MORNING = { sky: 0xa8c8e4, fog: 0xd4d6d8, light: 0xfff0da, light2: 0xfff7e2, ground: 0x807a88, prop: 0x8d8698, hemi: 0xd8dfee, zenith: 0x6f9cc8, horizon: 0xffe8c0 }
const TWILIGHT = { sky: 0x46567e, fog: 0x64779c, light: 0xbcc8e2, light2: 0xc7d4ec, ground: 0x474b58, prop: 0x585e70, hemi: 0x8694ba, zenith: 0x33456f, horizon: 0xa9b7d2 };;
let SUNRISE = 0; // 0 = pre-dawn, 1 = full morning
let SUNRIF = 0, SUNRIN = 0;
// stage 1 timeline: BPM 100 -> 1 bar = 2.4s. Dawn holds for the first minute
// (25 bars), then morning is complete around 2:45 (bar ~70). 3-minute stage.
const SUNRISE_START = 25;
const BARS_TO_MORNING = 80; // a long, gradual dawn instead of a quick brightening
const _ca = new THREE.Color(), _cb = new THREE.Color();
function paletteAt(z, out) {
  const f = Math.max(0, z) / SECTION_LEN;
  const i = Math.floor(f) % PALETTES.length;
  const j = (i + 1) % PALETTES.length;
  let k = f % 1;
  k = k > 0.72 ? (k - 0.72) / 0.28 : 0;
  for (const c of ['sky', 'fog', 'light', 'light2', 'ground', 'prop', 'hemi', 'zenith', 'horizon']) {
    // the transition has a middle act: sky, fog and the horizon wake up first,
    // the ground and the props right beside you hold onto the night a while longer
    const sun = (c === 'ground' || c === 'prop') ? SUNRIN : (c === 'light' || c === 'light2') ? (SUNRIF + SUNRIN) * 0.5 : SUNRIF;
    let v = _ca.setHex(PALETTES[i][c]).lerp(_cb.setHex(PALETTES[j][c]), k);
    // three-act dawn: night -> a long cool twilight hour (TWILIGHT) -> morning,
    // so the light never snaps from dark to bright
    if (sun > 0) {
      const k1 = Math.min(1, sun * 2), k2 = Math.max(0, sun * 2 - 1);
      if (k1 > 0) v = v.lerp(_ca.setHex(TWILIGHT[c]).clone(), k1);
      if (k2 > 0) v = v.lerp(_ca.setHex(MORNING[c]).clone(), k2);
    }
    out[c] = v.getHex();
  }
  return out;
}
const pal = {};
const bakedProps = [];

// ============ canvas textures (stage) ============
let _rs = 13579;
const _sr = () => { _rs = (_rs * 1103515245 + 12345) % 2147483648; return _rs / 2147483648; };
function canvasTex(fn, repX, repY) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const g = cv.getContext('2d'); fn(g);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repX, repY);
  return t;
}
const asphaltTex = (rx, ry) => canvasTex((g) => {
  g.fillStyle = '#26241f'; g.fillRect(0, 0, 256, 256); // neutral warm dark: no violet cast at dawn
  for (let i = 0; i < 2600; i++) {
    const v = 34 + _sr() * 92;
    g.fillStyle = `rgba(${v + 4},${v},${v - 4},${0.05 + _sr() * 0.08})`;
    g.fillRect(_sr() * 256, _sr() * 256, 1 + _sr() * 2.4, 1 + _sr() * 2.4);
  }
  g.strokeStyle = 'rgba(14,12,10,0.5)'; g.lineWidth = 1.1;
  for (let c = 0; c < 7; c++) {
    g.beginPath();
    let x = _sr() * 256, y = 0;
    g.moveTo(x, y);
    while (y < 256) { x += (_sr() - 0.5) * 26; y += 18 + _sr() * 30; g.lineTo(x, y); }
    g.stroke();
  }
  for (let i = 0; i < 14; i++) { g.fillStyle = 'rgba(78,72,64,0.25)'; g.beginPath(); g.ellipse(_sr() * 256, _sr() * 256, 6 + _sr() * 22, 4 + _sr() * 12, _sr() * 3, 0, 7); g.fill(); }
}, rx, ry);
const dirtTex = (rx, ry) => canvasTex((g) => {
  g.fillStyle = '#8a7a56'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1900; i++) {
    const v = 70 + _sr() * 110;
    g.fillStyle = `rgba(${v},${v - 12},${v * 0.62},${0.06 + _sr() * 0.1})`;
    g.fillRect(_sr() * 256, _sr() * 256, 1 + _sr() * 3, 1 + _sr() * 3);
  }
  g.strokeStyle = 'rgba(105,92,58,0.6)'; g.lineWidth = 1;
  for (let i = 0; i < 130; i++) { const x = _sr() * 256, y = _sr() * 256; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (_sr() - 0.5) * 5, y - 3 - _sr() * 7); g.stroke(); }
  for (let i = 0; i < 10; i++) { g.fillStyle = 'rgba(60,52,36,0.28)'; g.beginPath(); g.ellipse(_sr() * 256, _sr() * 256, 8 + _sr() * 26, 6 + _sr() * 14, _sr() * 3, 0, 7); g.fill(); }
}, rx, ry);
function paintTex(hex, _worn) {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 512;
  const g = cv.getContext('2d');
  const c = new THREE.Color(hex);
  const img = g.createImageData(64, 512);
  for (let y = 0; y < 512; y++) for (let x = 0; x < 64; x++) {
    const i = (y * 64 + x) * 4;
    const e = Math.min(x, 63 - x);
    const jag = 3 + Math.sin(y * 0.13 + x * 0.7) * 2 + _sr() * 2.5;
    let a = e < 1 ? 0 : e < jag ? _sr() * 0.65 : 1;
    const w = (Math.sin(x * 0.21 + y * 0.058) + Math.sin(x * 0.13 - y * 0.091) + Math.sin((x + y) * 0.072)) / 3 * 0.5 + 0.5;
    if (w > 0.5 - _worn * 0.06) a *= Math.max(0.02, 1 - (w - (0.5 - _worn * 0.06)) / (0.5 + _worn * 0.06) * (0.95 + _worn * 0.3));
    if (_worn > 0) {
      const gp = Math.sin(y * 0.012 + 0.7) * Math.sin(y * 0.033 + 2.1) + Math.sin(y * 0.006 + 0.2) * 0.4;
      if (gp > 0.22) a *= 0.02;
      a *= 0.28 + _sr() * 0.22;
    } else a *= 0.6 + _sr() * 0.3;
    const d = 0.82 + _sr() * 0.18;
    img.data[i] = c.r * 255 * d; img.data[i + 1] = c.g * 255 * d; img.data[i + 2] = c.b * 255 * d; img.data[i + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 60);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const woodTex = () => canvasTex((g) => {
  g.fillStyle = '#b0a894'; g.fillRect(0, 0, 256, 256);
  for (let x = 8; x < 256; x += 22 + _sr() * 10) { g.strokeStyle = 'rgba(80,72,60,0.5)'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (_sr() - 0.5) * 3, 256); g.stroke(); }
  for (let i = 0; i < 900; i++) { const v = 110 + _sr() * 80; g.fillStyle = `rgba(${v},${v - 8},${v - 22},0.12)`; g.fillRect(_sr() * 256, _sr() * 256, 2, 1); }
  for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(96,54,38,0.3)'; g.fillRect(_sr() * 256, _sr() * 256, 20 + _sr() * 50, 3 + _sr() * 8); }
}, 3, 1.2);
// ============ world ============
const STAGE_LEN = 570; // must cover SP*N slots (props reach z ~543)
const ROAD_LEN = 527, ROAD_C = 253.5; // asphalt to z=517, overlapping under the paving (starts 516) so no bare seam at the plaza mouth
const FINISH = 516;    // the walk ends at the station plaza
let finishMode = false, restartBtn = null;
const STAGE_C = STAGE_LEN / 2 - 10; // centered so the strip spans ~-10..560
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(90, STAGE_LEN),
  new THREE.MeshStandardMaterial({ color: 0x1d1628, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.position.z = STAGE_C;
scene.add(ground);
const texScroll = [];
if (WANT_STAGE) {
  // dormant suburban lawn, not bare dirt: muted greens with dry straw patches
  ground.material.map = canvasTex((g) => {
    g.fillStyle = '#75805a'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) {
      const v = 60 + _sr() * 90, r = v * (0.72 + _sr() * 0.2), gb = v * (0.95 + _sr() * 0.35);
      g.fillStyle = `rgba(${r | 0},${gb | 0},${v * 0.62 | 0},${0.05 + _sr() * 0.12})`;
      g.fillRect(_sr() * 256, _sr() * 256, 1 + _sr() * 2, 2 + _sr() * 4);
    }
    for (let i = 0; i < 14; i++) { // dry summer-killed patches
      g.fillStyle = `rgba(172,158,108,${0.18 + _sr() * 0.22})`;
      g.beginPath(); g.ellipse(_sr() * 256, _sr() * 256, 6 + _sr() * 22, 4 + _sr() * 12, _sr() * 3, 0, 7); g.fill();
    }
    for (let i = 0; i < 8; i++) { // worn dirt around nothing in particular
      g.fillStyle = `rgba(122,102,72,${0.16 + _sr() * 0.2})`;
      g.beginPath(); g.ellipse(_sr() * 256, _sr() * 256, 3 + _sr() * 9, 2 + _sr() * 6, _sr() * 3, 0, 7); g.fill();
    }
  }, 24, 240);
  texScroll.push({ t: ground.material.map, len: STAGE_LEN / 240 }); // +z/len locks the texture to the world (the plane itself follows the player)
}
const road = new THREE.Mesh(
  new THREE.PlaneGeometry(RW * 2, ROAD_LEN),
  new THREE.MeshStandardMaterial({ color: 0x191531, roughness: 0.85 }));
road.position.z = ROAD_C;
if (WANT_STAGE) {
  const tl = new THREE.TextureLoader();
  const photoTex = (u, rx, ry, srgb) => {
    const t = tl.load(u + '?v=' + AV, undefined, () => {
      setTimeout(() => { t.image.src = (t.image.src || '').split('#')[0] + '#r' + Date.now(); t.needsUpdate = true; }, 4000);
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  // back to the Poly Haven plate: that grey, low-contrast look is the asphalt the
  // Human knows and likes. the procedural plate was a detour
  road.material.map = photoTex('tex/asphalt_diff.jpg?v=359', 2.8, 264, true);
  road.material.normalMap = photoTex('tex/asphalt_nrm.jpg?v=359', 2.8, 264, false);
  road.material.normalScale = new THREE.Vector2(1.1, 1.1);

  road.material.color.setHex(0xcfc8dc);
  road.material.roughness = 0.9;
  texScroll.push({ t: road.material.map, len: ROAD_LEN / 264 }); // tile size; +z/len cancels the plane's follow exactly
  texScroll.push({ t: road.material.normalMap, len: ROAD_LEN / 264 });
}
road.rotation.x = -Math.PI / 2;
road.position.y = 0.03; // above the lawn's depth slab: at z~450 a 1cm offset z-fights away and the road vanished under the grass
scene.add(road);

// 縁の光る帯（Schnellの絵の magenta line）
const edgeLines = [];
for (const sx of [-RW - 0.1, RW + 0.1]) {
  const edge = new THREE.Mesh(new THREE.PlaneGeometry(0.06, ROAD_LEN),
    new THREE.MeshBasicMaterial({ color: 0xff3ec8, transparent: true, opacity: 0.75 }));
  edge.rotation.x = -Math.PI / 2;
  edge.position.set(sx, 0.04, ROAD_C);
  scene.add(edge);
  edgeLines.push(edge);
}
if (WANT_CITY) {
  // 旧・歩道バンドは廃止。道路テクスチャが道路幅からはみ出て、端だけざらついて中央が塗ったように平らに見せていた
}

const dashMat = new THREE.MeshBasicMaterial({ color: 0xf2e9d8, transparent: true, opacity: 0.5 });
const dashes = [];
for (let i = 0; i < 60; i++) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.14, WANT_CITY ? 2.0 : (WANT_STAGE ? 1.3 : 1.0)), dashMat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(0, 0.02, -10 + i * 4);
  scene.add(m); dashes.push(m);
}
// 車線の点線
const laneDashes = [];
const LANE_X = WANT_CITY ? [-RW / 2, RW / 2] : (WANT_STAGE ? [] : [-1.3, 1.3]);
for (let i = 0; i < 44; i++) for (const lx of LANE_X) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(WANT_CITY ? 0.12 : 0.07, WANT_CITY ? 1.1 : 0.6), dashMat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(lx, 0.04, -8 + i * 5);
  scene.add(m); laneDashes.push(m);
}
if (WANT_STAGE) for (const d of dashes) d.visible = false;
function recycleAlong(list, span, z, behind) {
  for (const o of list) if (o.position.z < z - behind) o.position.z += span;
}

// (removed: an old camera-attached moon sphere that floated in front of the camera)

// ============ 遠景（空ドーム・月・skyline）============
function radialTex() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(cv);
  return t;
}
const glowTex = radialTex();

const skyMat = new THREE.ShaderMaterial({
  uniforms: {
    top: { value: new THREE.Color(0x241b4d) },
    mid: { value: new THREE.Color(0x7a3f8f) },
    bot: { value: new THREE.Color(0xc75bb0) },
  },
  vertexShader: 'varying float vH; void main(){ vH = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying float vH; void main(){ float h = clamp(vH, -0.25, 1.0); vec3 c = h < 0.0 ? mix(bot, mid, (h + 0.25) / 0.25) : mix(mid, top, pow(h, 0.65)); gl_FragColor = vec4(c, 1.0); }',
  side: THREE.BackSide, depthWrite: false, fog: false,
});
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(460, 32, 20), skyMat);
// twinkling stars for the opening night: a countable handful (~90), high over
// the horizon, each with its own slow beat; they thin out with the far sunrise
// curve so they're gone by the time the sky turns morning
const starMat = new THREE.ShaderMaterial({
  uniforms: { uT: { value: 0 }, uNight: { value: 1 }, uPx: { value: Math.min(2, devicePixelRatio || 1) } },
  vertexShader: `
    attribute float aSeed;
    varying float vA;
    uniform float uT; uniform float uNight; uniform float uPx;
    void main() {
      float f = 0.35 + 1.6 * aSeed;                       // each star twinkles at its own pace
      float tw = 0.5 + 0.5 * sin(uT * f * 6.2831 + aSeed * 41.0);
      vA = uNight * (0.34 + 0.66 * tw) * (0.62 + 0.38 * aSeed);
      gl_PointSize = uPx * (1.8 + 1.9 * aSeed) * (0.78 + 0.42 * tw);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    varying float vA;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      float a = vA * smoothstep(0.5, 0.10, d);
      if (a <= 0.004) discard;
      gl_FragColor = vec4(vec3(0.92, 0.95, 1.0), a);
    }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
});
{
  const NS = 90, spos = new Float32Array(NS * 3), sseed = new Float32Array(NS);
  for (let i = 0; i < NS; i++) {
    const el = (14 + Math.random() * 66) * Math.PI / 180; // keep clear of the haze line
    const az = Math.random() * Math.PI * 2;
    const rr = 430; // just inside the sky dome, so buildings occlude them honestly
    spos[i * 3] = rr * Math.cos(el) * Math.sin(az);
    spos[i * 3 + 1] = rr * Math.sin(el);
    spos[i * 3 + 2] = rr * Math.cos(el) * Math.cos(az);
    sseed[i] = Math.random();
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(spos, 3));
  starGeo.setAttribute('aSeed', new THREE.BufferAttribute(sseed, 1));
  var starPts = new THREE.Points(starGeo, starMat);
  starPts.frustumCulled = false;
  scene.add(starPts);
}
const moonDisc = new THREE.Mesh(new THREE.SphereGeometry(9, 24, 24),
  new THREE.MeshBasicMaterial({ color: 0xfff0e8, fog: false, transparent: true }));
let sunGlowRef = null;
const moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffe9d8, transparent: true, opacity: 0.55, depthWrite: false, fog: false }));
moonGlow.scale.set(70, 70, 1);

function skylineTex(seed) {
  const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 256;
  const g = cv.getContext('2d');
  let x = 0; let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  while (x < 2048) {
    const bw = 18 + rnd() * 60, bh = 30 + rnd() * (rnd() < 0.12 ? 220 : 120);
    g.fillStyle = '#ffffff';
    g.fillRect(x, 256 - bh, bw, bh);
    x += bw + 6 + rnd() * 30;
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
function skylineTexLit(seed) {
  const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 256;
  const g = cv.getContext('2d');
  let x = 0; let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  while (x < 2048) {
    const bw = 22 + rnd() * 64, bh = 34 + rnd() * (rnd() < 0.12 ? 200 : 110);
    const bx = x, by = 256 - bh;
    const sh = 150 + rnd() * 90;
    g.fillStyle = `rgb(${sh},${sh - 12},${sh + 18})`;
    g.fillRect(bx, by, bw, bh);
    g.fillStyle = 'rgba(20,16,30,0.5)'; g.fillRect(bx, by, 2, bh);
    if (rnd() < 0.4) { g.fillStyle = `rgb(${sh - 30},${sh - 40},${sh - 10})`; g.fillRect(bx + bw * 0.3, by - 6 - rnd() * 10, bw * 0.35, 8); }
    for (let wy = by + 6; wy < 254; wy += 9) for (let wx = bx + 4; wx < bx + bw - 4; wx += 7) {
      const r = rnd();
      if (r < 0.32) { g.fillStyle = rnd() < 0.7 ? 'rgba(255,214,150,0.9)' : 'rgba(150,220,255,0.85)'; g.fillRect(wx, wy, 2.4, 3.4); }
      else if (r < 0.62) { g.fillStyle = 'rgba(30,26,44,0.7)'; g.fillRect(wx, wy, 2.4, 3.4); }
    }
    x += bw + 5 + rnd() * 26;
  }
  const cv2 = document.createElement('canvas'); cv2.width = 2048; cv2.height = 256;
  const g2 = cv2.getContext('2d');
  g2.filter = 'blur(1.4px)';
  g2.drawImage(cv, 0, 0);
  const hz = g2.createLinearGradient(0, 60, 0, 256);
  hz.addColorStop(0, 'rgba(255,255,255,0)');
  hz.addColorStop(1, 'rgba(255,205,170,0.42)');
  g2.fillStyle = hz; g2.fillRect(0, 0, 2048, 256);
  const t = new THREE.CanvasTexture(cv2);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
const far = new THREE.Group(); far.name = 'far';
const sky1 = new THREE.Mesh(new THREE.PlaneGeometry(900, 130),
  new THREE.MeshBasicMaterial({ map: skylineTex(11), color: 0x2e2450, transparent: true, opacity: 0.8, depthWrite: false, fog: false, side: THREE.DoubleSide }));
sky1.position.set(0, 55, 380);
const sky2 = new THREE.Mesh(new THREE.PlaneGeometry(760, 90),
  new THREE.MeshBasicMaterial({ map: skylineTex(77), color: 0x1a1430, transparent: true, opacity: 0.95, depthWrite: false, fog: false, side: THREE.DoubleSide }));
sky2.position.set(0, 32, 220);
far.add(skyDome, sky1, sky2);
if (WANT_STAGE) { sky1.visible = false; sky2.visible = false; } // user: drop the flat billboard skyline; real props carry the horizon
moonDisc.position.set(20, 120, 360);
moonGlow.position.copy(moonDisc.position);
far.add(moonDisc, moonGlow);
if (WANT_STAGE) {
  // Stage 1 is dawn: the sun has not cleared the horizon yet — keep only a wide,
  // diffuse horizon glow, and show a small pale moon high up instead of a sun disc
  moonDisc.material.color.setHex(0xe8ecf8);
  moonDisc.scale.setScalar(0.85);
  moonDisc.position.set(140, 165, 395);
  moonGlow.material.opacity = 0.18;
  moonGlow.scale.set(26, 26, 1);
  moonGlow.position.copy(moonDisc.position);
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffc487, transparent: true, opacity: 0.30, depthWrite: false, fog: true }));
  sunGlow.scale.set(340, 36, 1); sunGlow.position.set(30, -26, 428);
  far.add(sunGlow);
  sunGlowRef = sunGlow;
  if (location.search.includes('nosun')) sunGlow.visible = false;

  // faint distance layers: mountain ridgelines on the sides + a megacity on the horizon.
  // deliberately low-contrast; they tint with the sunrise like everything else
  function ridgeTex(seed, h) {
    const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 512;
    const c = cv.getContext('2d');
    let s = seed;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const N = 129, base = new Array(N).fill(0);
    for (let o = 0; o < 6; o++) {
      const freq = 2 << o, amp = 1 / Math.pow(1.7, o), m = freq * 4, pts = [];
      for (let k = 0; k <= m; k++) pts.push(rnd());
      for (let i = 0; i < N; i++) {
        const u = (i / (N - 1)) * m, k0 = Math.min(m - 1, u | 0), f = u - k0;
        base[i] += (pts[k0] + (pts[k0 + 1] - pts[k0]) * f * f * (3 - 2 * f)) * amp;
      }
    }
    c.fillStyle = '#ffffff';
    c.beginPath(); c.moveTo(0, 512);
    for (let i = 0; i < N; i++) c.lineTo(i * 16, 470 - base[i] * 150 * h);
    c.lineTo(2048, 512); c.closePath(); c.fill();
    return new THREE.CanvasTexture(cv);
  }
  function cityFarTex(seed) {
    const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 512;
    const c = cv.getContext('2d');
    let s = seed;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    c.fillStyle = '#606060';
    let x = 20;
    while (x < 2020) {
      const w = 26 + rnd() * 85;
      const mid = 1 - Math.abs(x - 1024) / 1100;
      const hgt = 55 + rnd() * 250 * (0.3 + 0.7 * mid) + mid * 70;
      c.fillRect(x, 512 - hgt, w, hgt);
      if (rnd() < 0.3) c.fillRect(x + w * 0.3, 512 - hgt - 10 - rnd() * 26, w * 0.4, 10 + rnd() * 26); // antenna crown
      x += w + 6 + rnd() * 26;
    }
    c.fillStyle = '#b4b4b4';
    for (let w = 0; w < 700; w++) c.fillRect(24 + rnd() * 1990, 120 + rnd() * 360, 2.4, 2.4); // sparse window glints
    return new THREE.CanvasTexture(cv);
  }
  const farBG = (window.__farBG = []);
  function bgPlane(tex, w, h, pos, ry, hex, morn, op, order) {
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: op, depthWrite: false, fog: false, side: THREE.DoubleSide, color: hex });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(pos[0], pos[1], pos[2]); m.rotation.y = ry; m.renderOrder = order;
    far.add(m);
    farBG.push({ mat, dusk: hex, morn });
  }
  bgPlane(ridgeTex(31, 0.45), 1600, 200, [-520, 58, -60], Math.PI / 2, 0x6f6890, 0x8fa6c4, 0.17, 1);
  bgPlane(ridgeTex(97, 0.38), 1600, 180, [540, 54, 20], Math.PI / 2, 0x6a6392, 0x8ba3c6, 0.14, 1);
  bgPlane(cityFarTex(13), 1000, 210, [0, 66, 545], 0, 0x585070, 0x7d94b2, 0.28, 2);
  bgPlane(cityFarTex(41), 700, 165, [-390, 52, -80], Math.PI / 2, 0x5e5676, 0x8499b6, 0.20, 2);
  bgPlane(cityFarTex(71), 700, 165, [400, 50, -140], Math.PI / 2, 0x5a5274, 0x8196b4, 0.17, 2);
}
scene.add(far);

// ---- props (街・階段の代わりのモジュール) ----
const PROP_SPACING = WANT_CITY ? 13.6 : (WANT_STAGE ? 4.5 : 8.5), PROP_COUNT = WANT_STAGE ? 124 : 34;
const props = [];
const propGeo = {
  pole: new THREE.CylinderGeometry(0.05, 0.07, 3.2, 6),
  bulb: new THREE.SphereGeometry(0.16, 10, 10),
  trunk: new THREE.CylinderGeometry(0.08, 0.11, 1.2, 6),
  leaf: new THREE.ConeGeometry(0.6, 1.6, 7),
  post: new THREE.CylinderGeometry(0.09, 0.09, 2.6, 6),
  beam: new THREE.BoxGeometry(0.18, 0.18, 5.0),
  block: new THREE.BoxGeometry(1.8, 2.4, 2.6),
  stair: new THREE.BoxGeometry(2.2, 0.12, 0.9),
};
function buildProp(kind) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x241b3a, roughness: 0.85 });
  const lmat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff3ec8, emissiveIntensity: 2.2 });
  g.userData = { mat, lmat };
  if (kind === 0) {
    const LS = WANT_CITY ? 2.3 : 1;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 4.2 * LS, 6), mat); p.position.y = 2.1 * LS; g.add(p);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.7 * LS, 0.05, 0.05), mat); arm.position.set(0.3 * LS, 4.15 * LS, 0); g.add(arm);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.28 * LS, 0.11 * LS, 0.15), lmat); b.position.set(0.62 * LS, 4.06 * LS, 0); g.add(b);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff3ec8, transparent: true, opacity: 0.7, depthWrite: false, fog: true }));
    glow.scale.set(1.5 * LS, 1.5 * LS, 1); glow.position.set(0.62 * LS, 4.06 * LS, 0); g.add(glow);
    g.userData.glowMat = glow.material;
  } else if (kind === 1) {
    const t = new THREE.Mesh(propGeo.trunk, mat); t.position.y = 0.6; g.add(t);
    const l = new THREE.Mesh(propGeo.leaf, mat); l.position.y = 1.9; g.add(l);
  } else if (kind === 3) {
    for (let s = 0; s < 3; s++) {
      const st = new THREE.Mesh(propGeo.stair, mat);
      st.position.set(0, 0.06 + s * 0.12, -s * 0.75); g.add(st);
    }
  } else if (kind === 4) {
    const l = new THREE.Mesh(propGeo.post, mat); l.position.set(-2.5, 1.3, 0); g.add(l);
    const r = new THREE.Mesh(propGeo.post, mat); r.position.set(2.5, 1.3, 0); g.add(r);
    const b = new THREE.Mesh(propGeo.beam, lmat); b.position.y = 2.65; g.add(b);
  } else {
    const b = new THREE.Mesh(propGeo.block, mat); b.position.y = 1.2; g.add(b);
  }
  return g;
}
if (!WANT_CITY && !WANT_STAGE) for (let i = 0; i < PROP_COUNT; i++) {
  const kind = WANT_CITY ? 0 : ((i % 6 === 5) ? 4 : (i % 3 === 0 ? 0 : (i % 3 === 1 ? (i % 2 ? 2 : 3) : 1)));
  const g = buildProp(kind);
  const side = i % 2 === 0 ? -1 : 1;
  g.userData.alt = i % 2;
  if (kind === 0 && side === 1) g.rotation.y = Math.PI;
  const gx = WANT_CITY ? side * (RW + 2.6) : side * (kind === 4 ? 0 : (kind === 2 ? 3.1 : 2.6 + (i % 3)));
  g.position.set(gx, 0, -8 + i * PROP_SPACING);
  scene.add(g); props.push(g);
}
// ---- stage1: 朝焼けの郊外一本道（車・ガソリンスタンド・自動販売機・電柱と電線・バス停・生け垣） ----
const stagePosts = [];
if (WANT_STAGE) {
  const rng = (() => { let s = 987654321; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; })();
  const SP = 4.5, N = 124;  // 1スロット4.5m、558m分（3分=252mの移行+市街の続き）
  const scratch = () => { const m = new THREE.MeshStandardMaterial({ color: 0xffffff }); scene.userData._scratch = scene.userData._scratch || []; scene.userData._scratch.push(m); return m; };
  const CAR_COLORS = [0x9a9fb5, 0xa8665a, 0x6a7f96, 0xc7b98a, 0x555a66, 0x7e8d7a, 0xb8a0c0];
  function carGroup(fixedCol) {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: fixedCol || CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)], roughness: 0.5, metalness: 0.25 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x1c2030, roughness: 0.25, metalness: 0.5 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x14161e, roughness: 0.9 });
    const tailMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff4a3a, emissiveIntensity: 1.6 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.62, 4.05), bodyMat); b.position.y = 0.58; g.add(b);
    const c = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.5, 1.95), bodyMat); c.position.set(0, 1.05, -0.22); g.add(c);
    const gl = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.34, 1.78), glassMat); gl.position.set(0, 1.1, -0.22); g.add(gl);
    for (const wx of [-0.8, 0.8]) for (const wz of [-1.28, 1.32]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.22, 10), darkMat);
      w.rotation.z = Math.PI / 2; w.position.set(wx, 0.31, wz); g.add(w);
    }
    for (const tx of [-0.62, 0.62]) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.06), tailMat); t.position.set(tx, 0.62, -2.04); g.add(t); }
    const headMat = new THREE.MeshStandardMaterial({ color: 0x20202a, emissive: 0xfff0c8, emissiveIntensity: 0.9 });
    for (const tx of [-0.62, 0.62]) { const h = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.06), headMat); h.position.set(tx, 0.6, 2.04); g.add(h); }
    for (const mx of [-0.92, 0.92]) { const mi = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 0.2), darkMat); mi.position.set(mx, 1.08, 0.72); g.add(mi); }
    g.userData = { mat: scratch(), lmat: tailMat };
    return g;
  }
  function vending(side) {
    const g = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: 0x3c4250, roughness: 0.7 });
    const panel = new THREE.MeshStandardMaterial({ color: 0x101018, emissive: rng() < 0.5 ? 0x53d0ff : 0xffb35a, emissiveIntensity: 2.0 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.98, 1.88, 0.7), body); b.position.y = 0.94; g.add(b);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 1.32), panel); p.position.set(0, 1.12, 0.36); g.add(p);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.1, 0.7), panel); band.position.y = 1.86; g.add(band);
    for (const sy of [0.55, 0.95, 1.35]) { const sh = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.03, 0.02), body); sh.position.set(0, sy, 0.365); g.add(sh); }
    const ks = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.02), new THREE.MeshStandardMaterial({ color: 0x23262e })); ks.position.set(0.28, 0.35, 0.365); g.add(ks);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: panel.emissive.getHex(), transparent: true, opacity: 0.5, depthWrite: false, fog: true }));
    glow.scale.set(1.8, 2.2, 1); glow.position.set(0, 1.1, 0.5); g.add(glow);
    g.rotation.y = side === 1 ? Math.PI : 0;
    g.userData = { mat: body, lmat: panel, glowMat: glow.material };
    return g;
  }
  function gasStation(side) {
    const g = new THREE.Group();
    const conc = new THREE.MeshStandardMaterial({ color: 0x6b6472, roughness: 1 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x8a8492, roughness: 0.6, metalness: 0.3 });
    const under = new THREE.MeshStandardMaterial({ color: 0x20202a, emissive: 0xffe2b0, emissiveIntensity: 1.4 });
    const pump = new THREE.MeshStandardMaterial({ color: 0x4a4450, roughness: 0.6 });
    const sign = new THREE.MeshStandardMaterial({ color: 0x14141c, emissive: 0xff9d5c, emissiveIntensity: 1.8 });
    const pad = new THREE.Mesh(new THREE.BoxGeometry(15, 0.1, 11), conc); pad.position.y = 0.05; g.add(pad);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(11, 0.35, 7), steel); roof.position.y = 4.7; g.add(roof);
    const lit = new THREE.Mesh(new THREE.PlaneGeometry(10.4, 6.4), under); lit.rotation.x = Math.PI / 2; lit.position.y = 4.48; g.add(lit);
    for (const px of [-4.8, 4.8]) for (const pz of [-2.8, 2.8]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.24, 4.5, 0.24), steel); p.position.set(px, 2.3, pz); g.add(p); }
    for (const px of [-1.7, 1.7]) { const pm = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.35, 0.75), pump); pm.position.set(px, 0.78, 0.5); g.add(pm); const sc = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.06), sign); sc.position.set(px, 1.15, 0.9); g.add(sc); }
    const shop = new THREE.Mesh(new THREE.BoxGeometry(6.2, 3.3, 4.6), steel); shop.position.set(0.5, 1.7, -6.6); g.add(shop);
    const door = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.1, 0.1), under); door.position.set(0.5, 1.1, -4.28); g.add(door);
    const totem = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4.4, 1.0), steel); totem.position.set(6.2, 2.2, 4.6); g.add(totem);
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.15, 0.14), sign); board.position.set(6.2, 3.85, 4.6); g.add(board);
    if (side === 1) g.rotation.y = Math.PI;
    g.userData = { mat: scratch(), lmat: sign, glowMat: null };
    return g;
  }
  function busStop(side) {
    const g = new THREE.Group();
    const frame = new THREE.MeshStandardMaterial({ color: 0x5c6470, roughness: 0.55, metalness: 0.3 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x9fb4c8, transparent: true, opacity: 0.35, roughness: 0.2 });
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.7, 0.09), glass); back.position.set(0, 1.35, -0.45); g.add(back);
    for (const px of [-1.1, 1.1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.2, 0.08), frame); p.position.set(px, 1.1, -0.45); g.add(p); }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.09, 1.25), frame); roof.position.set(0, 2.24, -0.15); g.add(roof);
    const bench = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.07, 0.42), frame); bench.position.set(0, 0.52, -0.3); g.add(bench);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), frame); pole.position.set(1.6, 1.2, 0.2); g.add(pole);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.06), new THREE.MeshStandardMaterial({ color: 0x14141c, emissive: 0x8fd8ff, emissiveIntensity: 1.6 })); sign.position.set(1.6, 2.35, 0.2); g.add(sign);
    g.rotation.y = side === 1 ? Math.PI : 0;
    g.userData = { mat: frame, lmat: sign.material };
    return g;
  }
  function powerPole(wireLen) {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a7f6e, roughness: 1 });
    const wireMat = new THREE.MeshStandardMaterial({ color: 0x2a2833, roughness: 0.6 });
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 9.2, 7), wood); p.position.y = 4.6; g.add(p);
    for (const y of [7.7, 8.5]) { const a = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.08), wood); a.position.y = y; g.add(a); }
    const trafo = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.4), new THREE.MeshStandardMaterial({ color: 0x767e86, roughness: 0.8 })); trafo.position.set(0.45, 6.9, 0); g.add(trafo);
    const gb = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.35), new THREE.MeshStandardMaterial({ color: 0x5d646c, roughness: 0.9 })); gb.position.set(0.3, 0.45, -0.5); g.add(gb);
    if (wireLen > 0) {
      for (const [wx, wy] of [[-0.78, 7.7], [0.78, 7.7], [0, 8.5]]) {
        const curve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(wx, wy, 0),
          new THREE.Vector3(wx, wy - 2.6, wireLen / 2),
          new THREE.Vector3(wx, wy, wireLen));
        const wMesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 14, 0.022, 4, false), wireMat);
        wMesh.castShadow = false;  // a 2cm wire must not throw a 30m bar shadow on the plaza
        g.add(wMesh);
      }
    }
    g.userData = { mat: scratch(), lmat: wireMat };
    return g;
  }
  function hedgeTex() {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256;
    const g = cv.getContext('2d');
    g.fillStyle = '#2c3a1c'; g.fillRect(0, 0, 256, 256);
    const tone = ['#46612c', '#55743a', '#3a5225', '#617f42', '#2f4420'];
    let hs = 12345;
    const rnd = () => { hs = (hs * 16807) % 2147483647; return hs / 2147483647; };
    for (let i = 0; i < 900; i++) {
      const x = rnd() * 256, y = rnd() * 256;
      g.save(); g.translate(x, y); g.rotate(rnd() * Math.PI);
      g.fillStyle = tone[(rnd() * tone.length) | 0];
      g.beginPath(); g.ellipse(0, 0, 2.2 + rnd() * 4, 1.2 + rnd() * 2.2, 0, 0, Math.PI * 2); g.fill();
      if (rnd() < 0.25) { g.fillStyle = 'rgba(160,180,110,0.35)'; g.beginPath(); g.ellipse(0.8, 0, 1.4, 0.7, 0, 0, Math.PI * 2); g.fill(); }
      g.restore();
    }
    for (let i = 0; i < 260; i++) { g.fillStyle = 'rgba(15,22,10,0.55)'; g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 2.5, 1 + rnd() * 2); }
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function hedge(len) {
    const g = new THREE.Group();
    const ht = hedgeTex(); ht.repeat.set(Math.max(1, len / 1.1), 1);
    const m = new THREE.MeshStandardMaterial({ map: ht, roughness: 1 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.05, len), m); b.position.y = 0.55; g.add(b);
    const ht2 = hedgeTex(); ht2.repeat.set(Math.max(1, len / 1.3), 0.5);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.2, len * 0.94), new THREE.MeshStandardMaterial({ map: ht2, roughness: 1 })); t.position.y = 1.15; g.add(t);
    for (let k = 0; k < Math.max(3, (len / 2) | 0); k++) {
      const hb = new THREE.Mesh(new THREE.BoxGeometry(0.55 + _sr() * 0.3, 0.16 + _sr() * 0.14, len * (0.10 + _sr() * 0.12)), t.material);
      hb.position.set((_sr() - 0.5) * 0.2, 1.28 + _sr() * 0.05, (0.5 - _sr()) * len * 0.85);
      hb.rotation.y = (_sr() - 0.5) * 0.3;
      g.add(hb);
    }
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.1, len * 1.02), new THREE.MeshStandardMaterial({ color: 0x3d3628, roughness: 1 }));
    skirt.position.y = 0.05; g.add(skirt);
    g.userData = { mat: scratch(), lmat: scratch() };
    return g;
  }
  function bin() {
    const g = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({ color: 0x556058, roughness: 0.8 });
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.3, 0.85, 10), m); b.position.y = 0.43; g.add(b);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.07, 10), new THREE.MeshStandardMaterial({ color: 0x3f4a44 })); lid.position.y = 0.9; g.add(lid);
    g.userData = { mat: scratch(), lmat: scratch() };
    return g;
  }
  function crosswalk() {
    const g = new THREE.Group();
    const wm = new THREE.MeshBasicMaterial({ color: 0xf2e9d8, transparent: true, opacity: 0.55 });
    for (let k = 0; k < 6; k++) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(0.5, RW * 2 - 0.4), wm);
      s.rotation.x = -Math.PI / 2; s.rotation.z = Math.PI / 2;
      s.position.set(-(RW - 0.4) + k * ((RW * 2 - 0.8) / 5), 0.022, 0);
      g.add(s);
    }
    g.userData = { mat: scratch(), lmat: scratch() };
    return g;
  }
  function cones() {
    const g = new THREE.Group();
    const cm = new THREE.MeshStandardMaterial({ color: 0xe2683a, roughness: 0.7 });
    const wm = new THREE.MeshStandardMaterial({ color: 0xf2e9d8 });
    for (let k = 0; k < 3; k++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.7, 10), cm); c.position.set((k - 1) * 1.4, 0.35, (k % 2) * 0.5); g.add(c);
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.09, 10), wm); w.position.set((k - 1) * 1.4, 0.32, (k % 2) * 0.5); g.add(w);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 0.06), new THREE.MeshStandardMaterial({ color: 0xe2683a })); bar.position.set(0, 0.8, 1.0); g.add(bar);
    for (const bx of [-1.2, 1.2]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.8, 0.07), new THREE.MeshStandardMaterial({ color: 0x8a8492 })); l.position.set(bx, 0.4, 1.0); g.add(l); }
    g.userData = { mat: scratch(), lmat: scratch() };
    return g;
  }
  function gasTank() {
    const g = new THREE.Group();
    const ym = new THREE.MeshStandardMaterial({ color: 0xd8b23a, roughness: 0.6 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.6, 1.1), ym); b.position.y = 0.8; g.add(b);
    for (const py of [0.45, 1.15]) { const p = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.12, 1.15), new THREE.MeshStandardMaterial({ color: 0x2c2c34 })); p.position.y = py; g.add(p); }
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.5, 8), new THREE.MeshStandardMaterial({ color: 0x8a8492 })); cap.position.set(0.5, 1.8, 0); g.add(cap);
    g.userData = { mat: scratch(), lmat: scratch() };
    return g;
  }
  const XING = [34, 78];   // 十字路
  function railSeg() {
    const g = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({ color: 0x9aa2ae, roughness: 0.5, metalness: 0.4 });
    const pm = new THREE.MeshStandardMaterial({ color: 0x7d848e, roughness: 0.6 });
    for (const sx of [RW + 0.35, -(RW + 0.35)]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, SP - 1.8), m); b.position.set(sx, 0.62, 0); g.add(b);
      for (const pz of [-(SP - 1.8) / 2 + 0.4, 0, (SP - 1.8) / 2 - 0.4]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.62, 0.09), pm); p.position.set(sx, 0.31, pz); g.add(p); }
    }
    g.userData = { mat: scratch(), lmat: scratch() };
    return g;
  }
  function crossX() {
    const g = new THREE.Group();
    const road = new THREE.Mesh(new THREE.PlaneGeometry(360, RW * 2), new THREE.MeshStandardMaterial({ color: 0x1b1734, roughness: 0.85 }));
    road.rotation.x = -Math.PI / 2; road.position.y = 0.028; g.add(road);
    const cwA = crosswalk(); cwA.position.z = -5.2; g.add(cwA);
    const cwB = crosswalk(); cwB.position.z = 5.2; g.add(cwB);
    const cm = new THREE.MeshStandardMaterial({ color: 0xd8cfa8, roughness: 0.8 });
    for (const cx of [-(RW + 1.3), RW + 1.3]) for (const cz of [-RW - 1.3, RW + 1.3]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 8), cm); c.position.set(cx, 0.25, cz); g.add(c);
    }
    // STOPサインと街道名札
    for (const sx of [RW + 1.5, -(RW + 1.5)]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), new THREE.MeshStandardMaterial({ color: 0x8a8492, roughness: 0.6 }));
      pole.position.set(sx, 1.2, -RW - 1.5); g.add(pole);
      const stop = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 8), new THREE.MeshStandardMaterial({ color: 0xa8302a, roughness: 0.5 }));
      stop.rotation.x = Math.PI / 2; stop.rotation.z = Math.PI / 8; stop.position.set(sx, 2.2, -RW - 1.5); g.add(stop);
      const street = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.18, 0.04), new THREE.MeshStandardMaterial({ color: 0x2e6b46, roughness: 0.7 }));
      street.position.set(sx, 2.62, -RW - 1.5); g.add(street);
    }
    g.userData = { mat: scratch(), lmat: scratch() };
    return g;
  }
  function deadTree() {
    const g = new THREE.Group();
    const wm = new THREE.MeshStandardMaterial({ color: 0x6b5a48, roughness: 1 });
    const h = 4.5 + rng() * 3.5;
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.24, h, 6), wm); t.position.y = h / 2; g.add(t);
    for (let k = 0; k < 4; k++) {
      const bl = 1.2 + rng() * 1.8;
      const br = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.09, bl, 5), wm);
      const a = rng() * Math.PI * 2, tilt = 0.7 + rng() * 0.6;
      br.position.set(Math.sin(a) * bl * 0.35, h * (0.55 + rng() * 0.4), Math.cos(a) * bl * 0.35);
      br.rotation.set(Math.cos(a) * tilt, 0, Math.sin(a) * tilt); g.add(br);
    }
    g.userData = { mat: scratch(), lmat: scratch() };
    return g;
  }
  // street frontage walls for the town/city half — continuous low walls with gaps
  function brickTex(base, mortar, rows) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const c = cv.getContext('2d');
    c.fillStyle = mortar; c.fillRect(0, 0, 128, 128);
    const rh = 128 / rows;
    const bc = new THREE.Color(base), mc = new THREE.Color(mortar);
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * 16;
      for (let q = -1; q < 4; q++) {
        const f = 0.9 + Math.random() * 0.2; // one brightness drift per brick — stays red
        c.fillStyle = new THREE.Color(bc.r * f, bc.g * f, bc.b * f).getStyle();
        c.fillRect(q * 32 + off + 2, r * rh + 2, 28, rh - 4);
      }
    }
    c.fillStyle = 'rgba(' + (mc.r * 255 | 0) + ',' + (mc.g * 255 | 0) + ',' + (mc.b * 255 | 0) + ',0.18)';
    for (let i = 0; i < 90; i++) c.fillRect(Math.random() * 128, Math.random() * 128, 2 + Math.random() * 9, 1 + Math.random() * 4);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace; // canvas paint is sRGB; left linear, every brick rendered washed-out pale
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  function wallSeg(style, len) {
    const L = len || 4.25;
    const g = new THREE.Group();
    g.userData = { mat: null, lmat: new THREE.MeshStandardMaterial() }; // paintProps contract; lmat unused
    if (style === 0) {
      const bt = brickTex('#8f6b52', '#cfc4b2', 4); bt.repeat.set(Math.max(1, L / 1.9), 1.4);
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.0, L), new THREE.MeshStandardMaterial({ map: bt, roughness: 1 }));
      w.position.y = 0.5; g.add(w); g.userData.mat = w.material;
      const capM = new THREE.MeshStandardMaterial({ color: 0xb9ad99, roughness: 1 });
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.08, L + 0.05), capM); cap.position.y = 1.04; g.add(cap);
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.22, 0.4), capM); p.position.set(0, 0.61, L / 2 - 0.15); g.add(p);
    } else {
      const ct = brickTex('#9aa0a4', '#7f858a', 2); ct.repeat.set(Math.max(1, L / 1.8), 1);
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.78, L), new THREE.MeshStandardMaterial({ map: ct, roughness: 1 }));
      w.position.y = 0.39; g.add(w); g.userData.mat = w.material;
      const capM = new THREE.MeshStandardMaterial({ color: 0x6a6f74, roughness: 0.7, metalness: 0.4 });
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.07, L + 0.05), capM); cap.position.y = 0.81; g.add(cap);
      for (const pz of [-L / 2 + 0.2, L / 2 - 0.2]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.55, 0.07), capM); p.position.set(0, 1.1, pz); g.add(p);
      }
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, L - 0.1), capM); rail.position.y = 1.32; g.add(rail);
    }
    for (const o of g.children) o.userData._orig = 0xffffff; // seat into the bakedProps tint loop
    return g;
  }
  function shack() {
    const g = new THREE.Group();
    const wt = woodTex(); const wall = new THREE.MeshStandardMaterial({ color: rng() < 0.5 ? 0xb4ac9c : 0x8f8878, roughness: 1, map: wt });
    const roof = new THREE.MeshStandardMaterial({ color: 0x6a5f52, roughness: 1 });
    const win = new THREE.MeshStandardMaterial({ color: 0x201d28, roughness: 0.4 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(11, 3.4, 7.5), wall); b.position.y = 1.7; g.add(b);
    const step = new THREE.Mesh(new THREE.BoxGeometry(11.6, 0.55, 8.1), roof); step.position.y = 3.6; g.add(step);
    const par = new THREE.Mesh(new THREE.BoxGeometry(11.4, 0.12, 1.5), roof); par.position.set(0, 2.6, 4.4); par.rotation.x = -0.35; g.add(par);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.1, 0.1), win); door.position.set(-2.2, 1.05, 3.78); g.add(door);
    for (const wx of [1.2, 3.6]) { const w = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 0.1), win); w.position.set(wx, 1.8, 3.78); g.add(w); }
    g.userData = { mat: scratch(), lmat: scratch() };
    return g;
  }
  // zone map over the ~3-minute stage (stride .62m/beat -> 252m):
  //   i 0..19   decayed suburb   |  i 20..41  farmland edge
  //   i 42..63  small town       |  i 64..    city outskirts
  const zoneOf = (i) => (i < 20 ? 0 : i < 42 ? 1 : i < 64 ? 2 : 3);
  const STORES = { 0: [3, 13], 1: [26], 2: [44, 52, 60], 3: [70, 84, 98, 112] };
  const GAS = [11, 48];
  const SHACKS = { 0: 7, 1: 25 };
  const CROSS = [19, 50, 58];
  const BUS = [17, 46];
  const POLE_A = (() => { const a = []; for (let i = 1; i < N; i += 4) if (i % 12 !== 9) a.push(i); return a; })();
  // baked Quaternius props (FBX -> GLB via bake_props.html); async, palette-tinted
  const bakedCache = {};
  const bakedWait = {}; const bakedTried = {};
  // Ultimate Textured Buildings: FBX carries no texture refs; atlas per color variant is applied here
  let _txCols = null;
  function texCols() {
    if (!_txCols) {
      _txCols = {};
      const tl = new THREE.TextureLoader();
      for (const c of ['Red', 'Blue', 'Green', 'Grey', 'Light', 'Dark', 'DarkBlue', 'DarkPurple']) {
        const t = tl.load('./assets/quaternius/texbuild_tex/Textures/Texture_' + c + '.png?v=' + AV);
        t.colorSpace = THREE.SRGBColorSpace;
        _txCols[c] = t;
      }
    }
    return _txCols;
  }
  function mergeProp(root) {
    // one draw call per material per model instead of one per primitive:
    // the iPhone was paying ~12,000 draw calls a frame and that was the stutter.
    root.updateMatrixWorld(true);
    const byMat = new Map();
    root.traverse((o) => { if (o.isMesh && !o.isSkinnedMesh && o.material) {
      const k = o.material.uuid; if (!byMat.has(k)) byMat.set(k, []); byMat.get(k).push(o);
    } });
    for (const arr of byMat.values()) {
      if (arr.length < 2) continue;
      const geos = [];
      for (const m of arr) { const g2 = m.geometry.clone(); g2.applyMatrix4(m.matrix); geos.push(g2.index ? g2.toNonIndexed() : g2); }
      let merged = null;
      try { merged = mergeGeometries(geos, false); } catch (e) { merged = null; }
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, arr[0].material);
      mesh.userData._orig = arr[0].userData._orig;
      mesh.position.set(0, 0, 0);
      const host = arr[0].parent;
      host.add(mesh);
      for (const m of arr) host.remove(m);
    }
  }
  const staticProps = [];
  // the fog already hides anything past ~150m; hiding it from the renderer too cuts the
  // suburbs from ~1000k triangles a frame to the strip actually on screen
  window.__stats = (renderer) => {
    if (!location.search.includes('stats=1') || !renderer) return;
    const pz = player.position.z;
    let nb = 0, nt = 0, nall = 0;
    for (const o of staticProps) {
      if (!o.visible) continue;
      nall++;
      if (/Story|House|Building|Shop|Bank|Hotel|Office|Flat|Hospital|Saloon|Station|Garage|DairyQueen|WaterTower|Barn/.test(o.name || '')) {
        nb++;
        o.traverse((m) => { if (m.isMesh && m.geometry.attributes.position) nt += m.geometry.attributes.position.count; });
      }
    }
    const nearP = (window.__placed || []).filter((t) => { const zz = +t.split(',')[1]; return zz > pz - 60 && zz < pz + 60; }).length;
    const samp = staticProps.map((o) => o.name + '#' + o.uid + (o.visible ? '*' : '') + '(' + o.position.x.toFixed(1) + ',' + o.position.z.toFixed(1) + ')');
    console.log('SAMP n=' + samp.length + ' ' + samp.slice(0, 40).join(' '));
    console.log('STATS visibleProps=' + nall + ' buildings=' + nb + ' placedNear=' + nearP + ' draws=' + renderer.info.render.calls + ' tris=' + renderer.info.render.triangles);
  };
  window.__cullProps = () => {
    const pz = player.position.z;
    // some models' geometry sits far from their node origin (the station's mesh is 60m
    // off its own position) — cull by the true footprint center, not the raw node z
    for (const o of staticProps) { const cz = o.userData.cz !== undefined ? o.userData.cz : o.position.z;
      o.visible = (cz > pz - 25) && (cz < pz + 165); }
  };
  // ~900 props requested at once saturates an iPhone's network+parse pipe and starves
  // the opening character; cap in-flight prop downloads at 4, the rest trickle in
  let propInflight = 0; const propQ = []; let propsArmed = false;  // no prop bytes until START
  window.__armProps = () => { propsArmed = true; window.__propLeft = propQ.length + propInflight; pumpProps(); };
  if (location.search.includes('dev=1')) {
    setTimeout(() => { document.getElementById('start').click(); }, 150); // dev: straight into the world
  }
  if (location.search.includes('map=1')) {
    window.__ahead = 5000;   // map capture: the whole stage, one pass (desktop)
    window.__dumpPlaces = () => {
      const arr = staticProps.map(o => [o.name, +o.position.x.toFixed(1), +o.position.z.toFixed(1),
        +(o.rotation.y || 0).toFixed(2), +(o.scale.x || 1).toFixed(2)]);
      return fetch('./save?name=places.json', { method: 'POST', body: JSON.stringify(arr) });
    };
  }
  window.__pump = pumpProps;
  setTimeout(() => {                               // after module init (TDZ order)
    propQ.sort((a2, b2) => a2.z - b2.z);           // strict near-to-far order for the walker window
    window.__propTot = propQ.length + propInflight;
    // NOT armed yet: the opening character downloads alone first (an iPhone only
    // has a few sockets; a street flooding them starved Timmy and the bar sat at 0%)
  }, 0);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(pumpProps, 50); });
  const PROP_MAX = COARSE ? 2 : 4;   // phones get a gentler drip
  const PROP_GAP = COARSE ? 350 : 40; // phones: a steady drip, not a flood
  function pumpProps() {
    if (!propQ.length) { if (window.__checkWorld) window.__checkWorld(); }
    // serve only the strip ahead of the walker; far files wait until you near them
    const ahead = (window.__pz || 0) + (window.__ahead || 165);
    while (propsArmed && propInflight < PROP_MAX && propQ.length && propQ[0].z <= ahead) {
      propInflight++; propQ.shift().run();
      if (COARSE) break; // one at a time, then wait — no pile-ups
    }
  }
  // ---- prop load queue: one GLB per name, distance-ordered, few at a time on phones ----
  function getProp(name, cb, pz0) {
    (window.__gpc = window.__gpc || {})[name] = ((window.__gpc[name] || 0) + 1);
    const wrapped = (o) => { o.name = name; o.uid = (window.__uid = (window.__uid || 0) + 1); staticProps.push(o); cb(o); };
    if (bakedCache[name]) { wrapped(bakedCache[name].clone()); return; }
    if (bakedTried[name]) { // a load is already in flight — queue instead of dropping the caller
      (bakedWait[name] = bakedWait[name] || []).push(cb);
      return;
    }
    bakedTried[name] = true;
    const attempt = (ntry) => {
    propQ.push({ z: pz0 || 0, run: () => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', './models/clips/prop_' + name + '.glb?v=' + AV, true);
      xhr.responseType = 'arraybuffer';
      xhr.timeout = 12000; // a wedged request must not freeze the world gate
      let settled = false;
      const release = () => { propInflight--; if (window.__maybeLit) window.__maybeLit(); setTimeout(pumpProps, PROP_GAP); };
      const dead = () => { if (settled) return; settled = true;
        if (ntry < 1) { bakedTried[name] = false; attempt(1); release(); return; }  // slow lines get one fresh try
        bakedTried[name] = false;   // don't wedge later callers on a failed name forever
        window.__propDone = (window.__propDone || 0) + 1; if (window.__barFn) window.__barFn(); if (window.__checkWorld) window.__checkWorld();
        release(); };
      xhr.ontimeout = () => { try { xhr.abort(); } catch (e) {} dead(); };
      xhr.onerror = dead;
      xhr.onload = () => {
        if (settled) return;
        if (xhr.status !== 200) { dead(); return; }
        try { new GLTFLoader().parse(xhr.response, '', (gltf) => { ok(gltf); }, dead); } catch (e) { dead(); }
      };
      const ok = (gltf) => { if (settled) return; settled = true;
      window.__propDone = (window.__propDone || 0) + 1;
      try {
      const root = gltf.scene;
      // clone per source-material (not per mesh), so same-material primitives can merge into one draw
      const matMap = new Map();
      root.traverse((o) => { if (o.isMesh && o.material) {
        const src = Array.isArray(o.material) ? o.material[0] : o.material;
        if (Array.isArray(o.material)) o.material = src;
        if (!matMap.has(src.uuid)) matMap.set(src.uuid, src.clone());
        o.material = matMap.get(src.uuid);
        o.userData._orig = o.material.color ? o.material.color.getHex() : 0x888888;
      } });
      if (!COARSE) mergeProp(root);   // phones skip the merge: it is a per-arrival CPU bomb
      bakedCache[name] = root;
      (window.__baked = window.__baked || {})[name] = root;
      if (location.search.includes('nobaked')) root.visible = false;
      wrapped(root.clone());
      for (const w of (bakedWait[name] || [])) { const o2 = root.clone(); o2.name = name; o2.uid = (window.__uid = (window.__uid || 0) + 1); staticProps.push(o2); w(o2); }
      bakedWait[name] = [];
      } catch (e) { showErr('prop ' + name + ': ' + (e && e.message || e)); }
      finally { if (window.__barFn) window.__barFn(); if (window.__checkWorld) window.__checkWorld(); release(); }
      };
      xhr.send();
    } });
    };
    attempt(0);
    pumpProps();
  }
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  // ---- placement rules, shared by every prop type:
  // center the geometry on the spot (packs bake models far from their origin),
  // sink it to the ground, then the overlap law: buildings never intersect (the later
  // one dies), trees never sit on roads (|x| corridor) or inside buildings ----
  // ---- quiet maker's marks: faded ghost signs naming the tools this stage grew from ----
  const CREDIT_NAMES = ['QWEN', 'STRATA', 'YuE2', 'LINGER', 'ISTA-DASLAB', 'MIXAMO', 'QUATERNIUS', 'THREE.JS'];
  const _credTex = {};
  function ghostTex(txt) {
    if (_credTex[txt]) return _credTex[txt];
    const cv = document.createElement('canvas'); cv.width = 300; cv.height = 84;
    const c = cv.getContext('2d');
    c.fillStyle = 'rgba(214,208,190,0.05)';
    c.beginPath(); c.roundRect(6, 8, 288, 68, 4); c.fill();
    const fs = txt.length > 9 ? 24 : 30;
    c.font = '600 ' + fs + 'px ui-sans-serif,system-ui,sans-serif';
    c.textBaseline = 'middle';
    const sp = 3; let w = 0;
    for (const ch of txt) w += c.measureText(ch).width + sp;
    w -= sp; let x = (300 - w) / 2;
    c.fillStyle = 'rgba(234,228,210,0.92)';
    for (const ch of txt) { c.fillText(ch, x, 42); x += c.measureText(ch).width + sp; }
    // weather: knock out rain-grain holes so the paint reads old
    c.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 2600; i++) { c.globalAlpha = 0.04 + Math.random() * 0.18; c.fillRect(Math.random() * 300, Math.random() * 84, 1 + Math.random() * 2.6, 1); }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    const t = new THREE.CanvasTexture(cv); t.anisotropy = 4;
    _credTex[txt] = t; return t;
  }
  let _credN = 0;
  function attachCredit(g, b2) {
    if (_credN >= CREDIT_NAMES.length) return;
    const wZ = b2.max.z - b2.min.z, hB = b2.max.y;
    const w = Math.min(2.3, wZ - 0.5);
    if (w < 0.9 || hB < 2.6) return;
    const right = b2.min.x + b2.max.x >= 0;
    // only front-row walls: a sign on a back-row building is invisible from the road
    if (right ? b2.min.x > RW + 8.2 : b2.max.x < -(RW + 8.2)) return;
    const s = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.3),
      new THREE.MeshBasicMaterial({ map: ghostTex(CREDIT_NAMES[_credN]), transparent: true, opacity: 0.42, depthWrite: false }));
    s.position.set(right ? b2.min.x - 0.06 : b2.max.x + 0.06, Math.min(hB - 1.0, 3.0), (b2.min.z + b2.max.z) / 2);
    s.rotation.y = right ? -Math.PI / 2 : Math.PI / 2;
    s.userData.bld = 1; scene.add(s); bakedProps.push(s);
    console.log('credit ' + CREDIT_NAMES[_credN] + ' @z' + Math.round((b2.min.z + b2.max.z) / 2) + ' x' + Math.round(s.position.x) + ' w' + w.toFixed(1));
    _credN++;
  }
  // road paint: two worn names in the right lane, like old curbside advertising
  function roadPaint(txt, z) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.42),
      new THREE.MeshBasicMaterial({ map: ghostTex(txt), transparent: true, opacity: 0.17, depthWrite: false }));
    p.rotation.x = -Math.PI / 2; p.rotation.z = (Math.abs(z) % 3 - 1) * 0.02;
    p.position.set(RW - 1.1, 0.06, z);
    p.userData.bld = 1; scene.add(p); bakedProps.push(p);
  }
  roadPaint('MIXAMO', 96); roadPaint('YuE2', 300); roadPaint('STRATA', 430);
  // tour-de-France style lane paint: the maker names crossed over the lane,
  // bold color worn by traffic, appearing only now and then down the stage
  function bannerTex(txt, hex) {
    const cv = document.createElement('canvas'); cv.width = 720; cv.height = 170;
    const c = cv.getContext('2d');
    // the ground plane maps texture-up toward -z, so bake the text turned around:
    // it then reads correctly for someone walking +z, like tour road paint for riders
    c.translate(720, 170); c.rotate(Math.PI);
    let fs = txt.length > 8 ? 74 : 96;
    c.font = '800 ' + fs + 'px ui-sans-serif,system-ui,sans-serif';
    const sp = 6; let w = 0;
    for (const ch of txt) w += c.measureText(ch).width + sp;
    if (w > 700) { fs = fs * 700 / w; c.font = '800 ' + fs + 'px ui-sans-serif,system-ui,sans-serif'; w = 700; }
    let x = (720 - w) / 2;
    c.fillStyle = hex; c.globalAlpha = 0.92;
    for (const ch of txt) { c.fillText(ch, x, 118); x += c.measureText(ch).width + sp; }
    c.globalAlpha = 1;
    // traffic wear: lift grains and drag horizontal scuffs off the paint
    c.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 4200; i++) { c.globalAlpha = 0.05 + Math.random() * 0.22; c.fillRect(Math.random() * 720, Math.random() * 170, 1 + Math.random() * 3.4, 1); }
    c.globalAlpha = 0.10;
    for (let i = 0; i < 60; i++) { const y = Math.random() * 170; c.fillRect(0, y, 720, 1 + Math.random() * 2); }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    const t = new THREE.CanvasTexture(cv); t.anisotropy = 8;
    return t;
  }
  const BANNERS = [['QWEN', '#8a7de0'], ['LINGER', '#d4527c'], ['YuE2', '#3fa7a0'], ['ISTA-DASLAB', '#c9c04a'], ['QUATERNIUS', '#5cae62'], ['STRATA', '#d8a13c'], ['MIXAMO', '#5a8ad0']];
  // keep clear of the crossroads at z143/341 and the plaza mouth at 516
  [[152, 0], [208, 1], [262, 2], [300, 3], [366, 4], [424, 5], [470, 6]].forEach(([bz, bi], k) => {
    const [nm, hx] = BANNERS[bi];
    const p = new THREE.Mesh(new THREE.PlaneGeometry(nm.length > 8 ? 5.0 : 4.4, nm.length > 8 ? 1.06 : 1.28),
      new THREE.MeshBasicMaterial({ map: bannerTex(nm, hx), transparent: true, opacity: 0.62, depthWrite: false }));
    p.rotation.x = -Math.PI / 2; p.rotation.z = ((k % 3) - 1) * 0.016;
    p.position.set(0, 0.061, bz);
    p.userData.bld = 1; scene.add(p); bakedProps.push(p);
  });

  // terrace cursors: each side's row fills forward with no gap; stop short of the plaza
  const facadeCur = { l: -10 + 64 * SP, r: -10 + 64 * SP, plc: FINISH - 8 };
  const facadeStop = { l: FINISH - 10, r: FINISH - 10, plc: FINISH + 20 };
  function addBuilding(name, x, z, targetH, ry, texName, yard, edge, facade) {
    (window.__placed = window.__placed || []).push(name + '@' + x.toFixed(1) + ',' + z);
    getProp(name, (g) => {
      const box = new THREE.Box3().setFromObject(g);
      const h = Math.max(0.01, box.max.y - box.min.y);
      g.scale.setScalar(targetH / h);
      g.rotation.y = ry || 0;
      // many Quaternius models bake their geometry far off the origin; center the
      // actual footprint on the intended spot, not the raw model origin
      const b1 = new THREE.Box3().setFromObject(g);
      const px = edge ? (x >= 0 ? edge - b1.min.x : -edge - b1.max.x) : x - (b1.min.x + b1.max.x) / 2;
      if (facade) { // row houses: butt each facade to the last one's end, one continuous wall
        const c0 = facadeCur[facade];
        if (c0 > facadeStop[facade]) { g.visible = false; return; }
        g.position.set(px, 0, c0 - b1.min.z);
        facadeCur[facade] = c0 + (b1.max.z - b1.min.z);
      } else g.position.set(px, 0, z - (b1.min.z + b1.max.z) / 2);
      if (/^(1|2|3|4|6)Story/.test(name)) {
        const cols = texCols(); const keys = Object.keys(cols);
        const t = (texName && cols[texName]) || cols[keys[(Math.round(z) + name.length) % keys.length]];
        g.traverse(o => { if (o.isMesh && o.material) {
          o.material = o.material.clone();
          o.material.map = t; o.material.needsUpdate = true;
        } });
      }
      const b2 = new THREE.Box3().setFromObject(g);
      g.userData.cz = (b2.min.z + b2.max.z) / 2;
      g.position.y = -b2.min.y - 0.3; // sink 30cm: in dawn light even a true touch can read as floating; the trim hides it
      // placement rule: two buildings that intersect — delete the later one, never shove them apart
      if (!/^tr_/.test(name)) {
        let clash = false;
        // open-country rule: out where buildings stand alone, even a half-metre gap reads as one merged barn from the road
        const mg = z < 185 ? 2.3 : 0.01;
        const b2e = b2.clone().expandByScalar(mg);
        for (const e2 of (window.__bboxes || [])) { const bx = e2.b;
          if (!bx.intersectsBox(b2e)) continue;
          const oX = Math.min(bx.max.x, b2e.max.x) - Math.max(bx.min.x, b2e.min.x);
          const oZ = Math.min(bx.max.z, b2e.max.z) - Math.max(bx.min.z, b2e.min.z);
          if (oX > 0.6 && oZ > 0.6) { console.log('DROPPED ' + name + ' z' + Math.round(z) + ' by ' + e2.n + ' z' + Math.round((bx.min.z + bx.max.z) / 2) + ' oX=' + oX.toFixed(1) + ' oZ=' + oZ.toFixed(1)); clash = true; break; }
        }
        if (clash) { window.__ovlDrop = (window.__ovlDrop || 0) + 1; g.visible = false; return; }
        for (const tr of (window.__trees || [])) { const bx = tr.b; // a house that landed on an earlier tree: the tree goes
          if (!bx.intersectsBox(b2)) continue;
          const oX = Math.min(bx.max.x, b2.max.x) - Math.max(bx.min.x, b2.min.x);
          const oZ = Math.min(bx.max.z, b2.max.z) - Math.max(bx.min.z, b2.min.z);
          if (oX > 0.3 && oZ > 0.3) tr.ref.visible = false;
        }
        (window.__bboxes = window.__bboxes || []).push({ n: name, b: b2.clone() });
      }
      // a thin dirt apron under the footprint: light-on-dark ground contact kills the floating read at dawn
      const w2 = (b2.max.x - b2.min.x) / 2 + 1.1, d2 = (b2.max.z - b2.min.z) / 2 + 1.1;
      const ap = new THREE.Mesh(new THREE.PlaneGeometry(w2 * 2, d2 * 2),
        new THREE.MeshStandardMaterial({ color: 0x6f6555, roughness: 1 }));
      ap.rotation.x = -Math.PI / 2; ap.position.set(g.position.x, 0.014, g.position.z);
      scene.add(ap); bakedProps.push(ap);
      (window.__placedY = window.__placedY || []).push(name + ' z=' + z + ' minY=' + b2.min.y.toFixed(2) + ' h=' + (b2.max.y - b2.min.y).toFixed(1));
      g.userData.prop = name; g.userData.bld = 1; scene.add(g); bakedProps.push(g);
      // a ghost sign on roughly one building in thirteen, from town onward
      if (z > 140 && z < FINISH - 24 && (Math.round(z * 7 + name.length * 13) % 13) === 0) attachCredit(g, b2);
      // brick yard walls removed: they piled on top of the wooden fences and stopped mid-field
    }, z);
  }
  function addBaked(name, x, z, sc, ry) {
    getProp(name, (g) => {
      g.scale.setScalar(sc); g.rotation.y = ry || 0; g.position.set(0, 0, 0);
      let bb = new THREE.Box3().setFromObject(g);
      // same pack quirk as trees: geometry baked far from the origin — center it on the spot
      g.position.set(x - (bb.min.x + bb.max.x) / 2, 0, z - (bb.min.z + bb.max.z) / 2);
      bb = new THREE.Box3().setFromObject(g);
      g.userData.cz = (bb.min.z + bb.max.z) / 2;
      if (WANT_STAGE && bb.max.x > -(RW + 2) && bb.min.x < RW + 2) { g.visible = false; return; } // nothing grows in the road corridor
      if (bb.min.y < -0.05 || bb.min.y > 0.05) g.position.y = -bb.min.y;
      scene.add(g); bakedProps.push(g);
    }, z);
  }
  function addTree(name, x, z, h0, h1, street) { // scale each tree to a real height in meters
    getProp(name, (t2) => {
      const b = new THREE.Box3().setFromObject(t2);
      const raw = Math.max(0.5, b.max.y - b.min.y);
      t2.scale.setScalar((h0 + rng() * (h1 - h0)) / raw);
      t2.rotation.y = rng() * 6.283; t2.position.set(0, 0, 0);
      let b2 = new THREE.Box3().setFromObject(t2);
      // some nature GLBs bake the tree 10-20m from its origin: center the canopy over the trunk's spot
      t2.position.set(x - (b2.min.x + b2.max.x) / 2, -b2.min.y, z - (b2.min.z + b2.max.z) / 2);
      b2 = new THREE.Box3().setFromObject(t2);
      t2.userData.cz = (b2.min.z + b2.max.z) / 2;
      const gr = RW + (street ? 0.6 : 3); // the planned street row may hang a little over the curb
      if (WANT_STAGE && b2.max.x > -gr && b2.min.x < gr) return; // no tree canopy over the road
      for (const e2 of (window.__bboxes || [])) { const bx = e2.b; // a tree never grows through a building: later tree, tree goes
        if (!bx.intersectsBox(b2)) continue;
        const oX = Math.min(bx.max.x, b2.max.x) - Math.max(bx.min.x, b2.min.x);
        const oZ = Math.min(bx.max.z, b2.max.z) - Math.max(bx.min.z, b2.min.z);
        if (oX > 0.6 && oZ > 0.6) return;
      }
      scene.add(t2); bakedProps.push(t2);
      (window.__trees = window.__trees || []).push({ b: b2.clone(), ref: t2 });
    }, z);
  }
  // the Realistic Car pack's FBX bakes some wheels at the wrong spot (near the body
  // centre instead of the axle). The mesh names are honest, so send each wheel where
  // its name says it belongs: Front/Back along the length, Left/Right mirrored.
  function fixWheels(g) {
    const meshes = g.children.slice(); // the wheel names live on the node groups, not the meshes
    let body = null, bv = -1;
    for (const o of meshes) { const b = new THREE.Box3().setFromObject(o);
      const v = (b.max.x - b.min.x) * (b.max.y - b.min.y) * (b.max.z - b.min.z);
      if (v > bv) { bv = v; body = o; } }
    if (!body) return;
    const bb = new THREE.Box3().setFromObject(body);
    const xS = bb.max.x - bb.min.x, zS = bb.max.z - bb.min.z;
    const lenIsZ = zS >= xS;
    const la = lenIsZ ? 'z' : 'x', wa = lenIsZ ? 'x' : 'z';
    const hl = (lenIsZ ? zS : xS) / 2, hw = (lenIsZ ? xS : zS) / 2;
    const Lc = (bb.min[la] + bb.max[la]) / 2, Wc = (bb.min[wa] + bb.max[wa]) / 2;
    const wheels = meshes.filter((o) => o !== body && /wheel/i.test(o.name || ''));
    const info = wheels.map((o) => { const wb = new THREE.Box3().setFromObject(o);
      return { o, name: (o.name || '').toLowerCase(),
        lon: (wb.min[la] + wb.max[la]) / 2 - Lc, lat: (wb.min[wa] + wb.max[wa]) / 2 - Wc,
        r: Math.max(0.05, (wb.max.y - wb.min.y) / 2), wb }; });
    // sign conventions come from whichever wheels the file placed correctly
    let frontSign = 0, spread = 0;
    for (const w of info) {
      const fr = w.name.indexOf('front') >= 0, bk = w.name.indexOf('back') >= 0;
      if ((fr || bk) && Math.abs(w.lon) >= 0.4 * hl) frontSign = fr ? Math.sign(w.lon) : -Math.sign(w.lon);
      if (Math.abs(w.lat) >= 0.3 * hw) spread = Math.max(spread, Math.abs(w.lat));
    }
    if (!frontSign) frontSign = -1; // the pack's upright root turns Front to -z
    for (const w of info) {
      const fr = w.name.indexOf('front') >= 0, bk = !fr && w.name.indexOf('back') >= 0;
      const lonT = (fr ? frontSign : bk ? -frontSign : Math.sign(w.lon) || frontSign) * hl * 0.62;
      let latT = w.lat;
      if (w.name.indexOf('left') >= 0 || w.name.indexOf('right') >= 0) {
        const mate = info.find((m) => m !== w && ((m.name.indexOf('left') >= 0) !== (w.name.indexOf('left') >= 0))
          && ((m.name.indexOf('front') >= 0) === (w.name.indexOf('front') >= 0)) && Math.abs(m.lat) >= 0.3 * hw);
        latT = mate ? -mate.lat : (w.name.indexOf('left') >= 0 === frontSign > 0 ? -1 : 1) * Math.max(hw - w.r, spread);
      }
      const dLon = lonT - w.lon, dLat = latT - w.lat, dY = 0 - w.wb.min.y;
      if (Math.abs(dLon) > 0.05) w.o.position[la] += dLon;
      if (Math.abs(dLat) > 0.05) w.o.position[wa] += dLat;
      if (Math.abs(dY) > 0.01) w.o.position.y += dY;
    }
  }
  function addCar(name, x, z, ry, paint) {
    getProp(name, (g) => {
      g.rotation.y = 0; g.position.set(0, 0, 0); g.updateMatrixWorld(true);
      fixWheels(g);
      if (paint) g.traverse((o) => { // paint the bright body panels only — tyres, glass and
        // trim are dark, and the merge step can reparent panels under odd nodes anyway.
        // Clone the material so the twin car at another z keeps its own colour.
        if (!o.isMesh) return;
        const keep = (m) => { if (!m || !m.color || m.transparent) return;
          const c = m.color, lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
          if (lum > 0.12) { m.color.setHex(paint); o.userData._orig = paint; } };
        if (Array.isArray(o.material)) o.material = o.material.map((m) => { m = m.clone(); keep(m); return m; });
        else if (o.material) { o.material = o.material.clone(); keep(o.material); } });
      g.rotation.y = ry || 0; g.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(g);
      let wMin = null; // sit on the tyres, not on whatever low trim the body shell has
      g.traverse((o) => { if (o !== g && /wheel/i.test(o.name || '')) { const wb = new THREE.Box3().setFromObject(o);
        if (wMin === null || wb.min.y < wMin) wMin = wb.min.y; } });
      g.position.set(x - (bb.min.x + bb.max.x) / 2, -(wMin === null ? bb.min.y : wMin), z - (bb.min.z + bb.max.z) / 2);
      scene.add(g);
      if (!paint) bakedProps.push(g); // painted cars keep their colour: out of the tint loop
    }, z);
  }
  function farmField(crop, x0, z0, nx, nz) {
    getProp(crop, (proto) => {
      let mesh = null;
      proto.traverse((o) => { if (!mesh && o.isMesh) mesh = o; });
      if (!mesh) return;
      const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, nx * nz);
      const mt = new THREE.Matrix4();
      let k = 0;
      for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
        mt.makeRotationY(rng() * 6.283);
        mt.setPosition(x0 + (a - (nx - 1) / 2) * 1.1 + (rng() - 0.5) * 0.4, 0, z0 + (b - (nz - 1) / 2) * 1.1 + (rng() - 0.5) * 0.4);
        im.setMatrixAt(k++, mt);
      }
      im.instanceMatrix.needsUpdate = true;
      scene.add(im); bakedProps.push(im);
    }, z0);
  }
  const DEAD_TREES = ['CommonTree_Dead_1','CommonTree_Dead_2','CommonTree_Dead_3','BirchTree_Dead_1','BirchTree_Dead_2'];
  const OK_TREES = ['CommonTree_1','CommonTree_2','CommonTree_3','CommonTree_4','BirchTree_1','BirchTree_2'];
  const AUTUMN = ['CommonTree_Autumn_1','CommonTree_Autumn_3','BirchTree_1'];
  const PINES = ['PineTree_1','PineTree_2','PineTree_3'];
  const ROCKS = ['Rock_1','Rock_2','Rock_3','Rock_4','Rock_5'];
  // baked buildings: suburb houses / town rows / city blocks / farmstead
  const SUBB = [['House1',4.6],['House2',4.4],['Building1_Small',5.0],['1Story',3.6],['1Story_GableRoof',3.9]];
  const TOWNB = [['2Story',6.8],['2Story_2',6.8],['2Story_Center',6.8],['2Story_Columns',7.0],['2Story_GableRoof',7.2],['2Story_Slim',6.6],['2Story_Wide',6.8],['2Story_Sidehouse',6.8],['1Story_RoundRoof',4.0]];
  const CITYB = [['3Story_Balcony',9.5],['3Story_Slim',9.5],['3Story_Small',9.0],['4Story',12],['4Story_Center',12],['Building2_Large',11],['Building3_Big',11],['Building4',10.5],['6Story_Stack',16]];
  // front-row set: models whose front face stays under ~7m wide, so a 9m lot line reads as an even wall
  const CITYF = CITYB.filter((b) => b[0] !== 'Building2_Large' && b[0] !== 'Building3_Big');
  const SUB_H = [2, 6, 10, 14, 15, 18];
  const TOWN_H = [43, 47, 51, 55, 59, 63];
  const CITY_H = []; for (let q = 67; q < N; q += 4) CITY_H.push(q);
  const FARM_B = { 29: ['SmallBarn',7] }; // BigBarn.glb is itself a fused complex of 2-3 barns — it always read as an overlap. The farm keeps ONE single barn + silos + windmill.
  const FARM_X = { 37: ['TowerWindmill',13], 41: ['WaterTower',10] };
  const FARM_S = [['Well',2.6],['ChickenCoop',2.3]];
  // parked Quaternius cars — deliberately sparse, one per area
  const CARSPOT = { 12: 'car_Taxi', 16: 'car_SUV', 32: 'car_NormalCar2', 45: 'car_Cop', 56: 'car_SportsCar', 64: 'car_NormalCar1' };
  const faceRoad = (side) => (side === 1 ? -Math.PI / 2 : Math.PI / 2);
  const NEARX = (zc) => XING.some((k) => Math.abs(zc - (-10 + k * SP)) < 11);
  // reference photos: a small downtown is 2-3 storeys fronting the street, not a wall
  // of towers; save the tall blocks for the last stretch before the station
  const MAINB = [['3Story_Slim',9.0],['3Story_Small',8.8],['2Story_Wide',7.2],['2Story_Columns',7.2],['2Story',7.0]];
  const cityLot = (side, zc) => {
    const near = zc > FINISH - 60;
    const b = pick(near ? CITYF : MAINB);
    addBuilding(b[0], side * (RW + 6.5), zc, b[1] + (near ? rng() * 2 : rng() * 1), faceRoad(side), null, null,
      RW + 6.9, side === 1 ? 'r' : 'l');
  };
  let g;
  for (let i = 0; i < N; i++) {
    if (POLE_A.includes(i)) { // power poles are additive — the lot behind them still gets built
      const nx2 = POLE_A[POLE_A.indexOf(i) + 1];
      const pg = powerPole(nx2 ? (nx2 - i) * SP : 0);
      pg.userData.alt = i % 2; pg.position.set(-(RW + 1.0), 0, -10 + i * SP);
      pg.traverse((o) => { o.castShadow = false; }); // a 9m pole under the low dawn sun threw a 100m bar across the road
      scene.add(pg); props.push(pg);
    }
    const zc = -10 + i * SP;
    const z0 = zoneOf(i);
    const side = i % 2 === 0 ? -1 : 1;
    g = null; let x = 0;
    if (GAS.includes(i)) { /* gas station removed: style clash, empty lot */ }
    else if (i in SHACKS && SHACKS[z0] === i) { g = shack(); x = side * (RW + 8.5); if (side === 1) g.rotation.y = Math.PI; }
    else if (XING.includes(i)) { g = crossX(); x = 0; }
    else if (CROSS.includes(i)) { g = crosswalk(); x = 0; }
    else if (BUS.includes(i)) { g = busStop(side); x = side * (RW + 3.4); }
    else if (CARSPOT[i]) { addCar(CARSPOT[i], side * (RW + 1.7), zc, (side === 1 ? Math.PI : 0) + (rng() - 0.5) * 0.2); }
    else if (STORES[z0].includes(i)) { g = buildProp(0); const LS = 1.35; g.scale.setScalar(LS); x = side * (RW + 2.7); if (side === 1) g.rotation.y = Math.PI; }
    else if (z0 === 0 && SUB_H.includes(i)) { const b = pick(SUBB); addBuilding(b[0], side * (RW + 6.5), zc, b[1] + rng() * 0.8, faceRoad(side)); }
    else if (z0 === 1 && (i === 22 || i === 29)) { // the farm's two silos; the barn itself was removed for good — it never sat right
      addBuilding('Silo', side * (RW + 19.5), zc - 11, 9.5, 0); }
    else if (z0 === 1 && FARM_X[i]) { const b = FARM_X[i]; addBuilding(b[0], side * (RW + 9.5), zc, b[1], 0); }
    else if (z0 === 2 && TOWN_H.includes(i)) { const b = pick(TOWNB); addBuilding(b[0], side * (RW + 5.2), zc, b[1] + rng() * 0.6, faceRoad(side), undefined, 0); }
    else if (z0 === 3 && CITY_H.includes(i)) cityLot(side, zc);
    else if (z0 === 1 && i % 3 === 0) { /* farm rows handled below */ }
    else { const r = rng();
      if (z0 === 0) {
        if (r < 0.16) { const b = pick(SUBB); addBuilding(b[0], side * (RW + 6.5 + rng() * 2.5), zc, b[1] + rng() * 0.8, faceRoad(side)); }
        else if (r < 0.47) { /* vending machine removed */ }
        else if (r < 0.53) { g = hedge(6 + rng() * 6); x = side * (RW + 5.6); }
        else if (r < 0.57) { g = bin(); x = side * (RW + 3.0); }
        else if (r < 0.61) { g = cones(); x = side * (RW + 0.7); }
        else if (r < 0.80) addTree(pick(DEAD_TREES), side * (RW + 10.5 + rng() * 4), zc, 6, 9); // farm dead trees well off the shoulder
        else if (r < 0.90) { if (!NEARX(zc)) addBaked(pick(ROCKS), side * (RW + 3 + rng() * 6), zc, 1, rng() * 6.283); }
        else if (!NEARX(zc)) addBaked(rng() < 0.5 ? 'TreeStump' : 'WoodLog', side * (RW + 3.5 + rng() * 4), zc, 1, rng() * 6.283);
      } else if (z0 === 1) {
        if (r < 0.08) { const b = pick(FARM_S); addBuilding(b[0], side * (RW + 7.5 + rng() * 3), zc, b[1], faceRoad(side)); }
        else if (r < 0.26) addTree('Willow_1', side * (RW + 9), zc, 9, 12);
        else if (r < 0.40) { if (!NEARX(zc)) addBaked(pick(['Grass_2','Flowers']), side * (RW + 6 + rng() * 3), zc, 1.1, rng() * 6.283); }
        else if (r < 0.50) { if (!NEARX(zc)) addBaked(pick(ROCKS), side * (RW + 4 + rng() * 6), zc, 1, rng() * 6.283); }
        else if (r < 0.62) { if (!NEARX(zc)) addBaked(pick(['WoodLog','TreeStump_Moss']), side * (RW + 3 + rng() * 4), zc, 1, rng() * 6.283); }
        else if (r < 0.86) addTree(pick(DEAD_TREES), side * (RW + 8 + rng() * 6), zc, 7, 10);
      } else if (z0 === 2) {
        if (r < 0.52) {
          const b = pick(TOWNB);
          addBuilding(b[0], side * (RW + 5.2), zc, b[1] + rng() * 0.6, faceRoad(side), undefined, 0);
          if (rng() < 0.35) { const b2 = pick(TOWNB); addBuilding(b2[0], side * (RW + 10 + rng() * 3), zc + (rng() - 0.5) * 5, b2[1], faceRoad(side)); }
        }
        else if (r < 0.36) { g = vending(side); x = side * (RW + 3.2); }
        else if (r < 0.45) { g = hedge(6 + rng() * 6); x = side * (RW + 5.6); }
        else if (r < 0.74) addTree(rng() < 0.35 ? pick(AUTUMN) : pick(OK_TREES), side * (RW + 4.5 + rng() * 4), zc, 8, 12);
        else if (r < 0.86) { if (!NEARX(zc)) addBaked(pick(['Grass_2','Flowers','Grass']), side * (RW + 6 + rng() * 3), zc, 1.1, rng() * 6.283); }
      } else {
        // a real downtown: walls of buildings on nearly every lot, front and back rows —
        // except the last stretch, which is the hand-composed station plaza
        if (zc > FINISH - 14) { /* plaza surrounds: placed by hand above */ }
        else if (r < (zc > FINISH - 45 ? 0.012 : 0.05)) { /* pines removed: wrong feel */ }
        else if (r < (zc > FINISH - 45 ? 0.02 : 0.08)) addBaked(pick(ROCKS), side * (RW + 3 + rng() * 7), zc, 1, rng() * 6.283);
        else if (rng() < (zc > FINISH - 45 ? 0.95 : 0.72)) cityLot(side, zc);
      } }
    if (g) { g.userData.alt = i % 2; g.position.set(x, 0, zc); scene.add(g); props.push(g); }
  }
  // fill each downtown row to the plaza: one continuous, gap-free wall of facades.
  // the cursor moves on async load, so request by an average-width estimate; extras cap themselves
  for (const side of [-1, 1]) { const key = side === 1 ? 'r' : 'l';
    for (let est = facadeCur[key]; est <= facadeStop[key] + 24; est += 4.5) cityLot(side, est); }
  // the downtown allée: street trees at equal spacing down both brick sidewalks
  { let alt = 0;
    for (let tz = -10 + 64 * SP + 5; tz < FINISH - 16; tz += 9, alt++) {
      const side = alt % 2 === 0 ? -1 : 1;
      addTree(pick(OK_TREES), side * (RW + 3.7), tz, 5.5, 7, true);
    } }
  // crop rows on the shoulders of the farmland stretch
  farmField('Corn_1', -(RW + 9), 100, 5, 6);
  farmField('Corn_2', RW + 9, 122, 5, 6);
  farmField('Wheat', -(RW + 9), 172, 6, 8);
  farmField('Wheat', RW + 9, 194, 6, 6);
  // paddock fences edging the crop fields (gaps left for the barn driveways)
  for (const [fx, zf0, zf1] of [[-(RW + 7.4), 94, 136], [RW + 7.4, 116, 158], [-(RW + 7.4), 166, 210], [RW + 7.4, 190, 220]])
    for (let fz = zf0; fz <= zf1; fz += 2.4) {
      if ([89, 120.5].some((bz) => Math.abs(fz - bz) < 7)) continue; // open in front of the barns
      addBaked(pick(['Fence', 'Fence2']), fx, fz, 1, Math.PI / 2);
    }
  // ---- station plaza: the end of Stage 1 ----
  const plaza = new THREE.Mesh(new THREE.PlaneGeometry(27, 24),
    new THREE.MeshStandardMaterial({ color: 0xbcae9d, roughness: 0.95,
      map: canvasTex((g) => {
        // faded square stones laid on the diagonal, in sun-worn red-brown and grey
        g.fillStyle = '#574c42'; g.fillRect(0, 0, 256, 256); // the joints
        const cols = [[124, 80, 60], [133, 92, 72], [110, 90, 78], [96, 82, 70], [142, 108, 86], [122, 106, 95]];
        g.save(); g.translate(128, 128); g.rotate(Math.PI / 4);
        const S = 30;
        for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) {
          const c = cols[((i + 8) * 2 + j + 8) % cols.length], f = 0.8 + _sr() * 0.34;
          g.fillStyle = `rgb(${c[0] * f | 0},${c[1] * f | 0},${c[2] * f | 0})`;
          g.fillRect(i * S + 1.6, j * S + 1.6, S - 3.2, S - 3.2);
        }
        g.restore();
        for (let i = 0; i < 1700; i++) { const v = 120 + _sr() * 110; g.fillStyle = `rgba(${v},${v - 4},${v - 16},${0.04 + _sr() * 0.1})`; g.fillRect(_sr() * 256, _sr() * 256, 1 + _sr() * 3, 1 + _sr() * 4); }
        for (let i = 0; i < 46; i++) { g.fillStyle = 'rgba(214,206,190,0.10)'; g.beginPath(); g.arc(_sr() * 256, _sr() * 256, 3 + _sr() * 11, 0, 6.283); g.fill(); }
      }, 8, 7) }));
  plaza.rotation.x = -Math.PI / 2; plaza.position.set(0, 0.035, FINISH + 12); // paving 27x24, z 516..540; the road tucks under its near edge
  scene.add(plaza);
  // once the street turns into the downtown, the shoulders become brick pavement
  { const CITY_Z = -10 + 64 * SP, Z1 = FINISH + 24, LEN = Z1 - CITY_Z;
    // deeper rust: at full morning sun the old base reads as pale tan, and the
    // whole downtown floor turns brown
    const bt = brickTex('#63361f', '#41302a', 8);
    bt.repeat.set(6.4 / 0.96, LEN / 0.96); bt.anisotropy = 4;
    const walk = new THREE.Mesh(new THREE.PlaneGeometry(6.4, LEN),
      new THREE.MeshStandardMaterial({ map: bt, roughness: 0.9 }));
    walk.rotation.x = -Math.PI / 2;
    for (const side of [-1, 1]) { const w = walk.clone(); w.position.set(side * (RW + 3.55), 0.032, CITY_Z + LEN / 2); scene.add(w); }
  }
  // the station closes the far side; its front stands on the paving edge, not inside it
  // the station: wide, four storeys, twin tall openings so the entrance reads from the plaza
  addBuilding('4Story_Wide_2Doors', 0, FINISH + 26, 13, Math.PI, 'Red');
  addBuilding('1Story_RoundRoof', -14.5, FINISH + 23.5, 3.8, Math.PI); // ticket booth / cafe, on the far line
  addBuilding('3Story_Slim', 17.5, FINISH + 23, 9, Math.PI, 'Grey'); // close the far line corner (clear of the booth)
  // the player walks +z, so their LEFT is +x — that's the colonnade the station-front photo
  // wanted opened up. the -x side stays walled in.
  addBuilding('3Story_Balcony', -14.5, 0, 9.5, Math.PI / 2, 'Light', null, 13.4, 'plc');
  addBuilding('3Story_Small', -14.5, 0, 9, Math.PI / 2, 'Green', null, 13.4, 'plc');
  addBuilding('3Story_Slim', -14.5, 0, 9.5, Math.PI / 2, 'Yellow', null, 13.4, 'plc');
  addBuilding('3Story_Slim', -14.5, 0, 9, Math.PI / 2, 'Grey', null, 13.4, 'plc');
  addBuilding('3Story_Balcony', -14.5, 0, 9.5, Math.PI / 2, 'Blue', null, 13.4, 'plc');
  addBuilding('2Story_Wide', -14.5, 0, 7, Math.PI / 2, 'Light', null, 13.4, 'plc');
  // the parked train behind the station — now the real Quaternius modular train
  const bed = new THREE.Mesh(new THREE.PlaneGeometry(90, 6),
    new THREE.MeshStandardMaterial({ color: 0x57503f, roughness: 1 }));
  bed.rotation.x = -Math.PI / 2; bed.position.set(0, 0.03, 558); scene.add(bed);
  for (const tx of [-36, -18, 0, 18, 36]) addBuilding('tr_RailwayTrack_Straight', tx, 558, 0.85, 0);
  // the green commuter train (the earlier HighSpeed bake was a quarter-turn on its side,
  // and blue was not wanted): four passenger wagons, body painted station-yard green
  const trainCar = (tx) => getProp('tr2_Locomotive_PassengerWagon', (g) => {
    g.rotation.x = -Math.PI / 2;              // this FBX is z-up: stand it up before measuring
    g.position.set(tx, 0, 558.2);
    let bb = new THREE.Box3().setFromObject(g);
    g.scale.setScalar(2.95 / (bb.max.y - bb.min.y)); g.updateMatrixWorld(true);
    bb = new THREE.Box3().setFromObject(g);
    g.position.y = -bb.min.y - 0.05;
    g.traverse((o) => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
      if (m.color && (m.color.r * 0.3 + m.color.g * 0.6 + m.color.b * 0.1) > 0.1) m.color.setHex(0x4d8f4a);
    }); });
    g.name = 'trainCar'; scene.add(g); // NOT pushed to bakedProps: the palette tint loop would wash the green back to brown
  }, 558);
  for (const tx of [12.6, 4.25, -4.1, -12.45]) trainCar(tx);
  // a little bank on the plaza's approach corner — station-front high street
  addBuilding('bld_Bank', -14.5, FINISH - 12, 8.5, Math.PI / 2);
  addCar('car_SportsCar', -4.2, FINISH + 3.6, Math.PI + 0.12, 0xf2b01f); // the taxi rank — pack model, corrected wheels, no roof sign
  // plaza pines removed: the round conifers didn't fit the street
  for (const bx of [5.5, -5.5]) { // benches facing the plaza
    const bg = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.9 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x2c2c30, roughness: 0.6, metalness: 0.4 });
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.09, 0.55), wood); seat.position.y = 0.45;
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 0.08), wood); back.position.set(0, 0.75, -0.24);
    bg.add(seat, back);
    for (const lx of [-0.75, 0.75]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.5), iron); leg.position.set(lx, 0.22, 0); bg.add(leg); }
    bg.position.set(bx, 0, FINISH - 1.5); bg.rotation.y = bx > 0 ? -Math.PI / 2 : Math.PI / 2;
    scene.add(bg);
  }
  // the floating RESTART sign, shown only at the plaza
  const rbCv = document.createElement('canvas'); rbCv.width = 512; rbCv.height = 112;
  { const g = rbCv.getContext('2d');
    g.fillStyle = 'rgba(16,14,26,0.35)';
    g.beginPath(); g.roundRect(10, 10, 492, 92, 30); g.fill();
    g.fillStyle = '#f5f2ea'; g.font = '300 44px ui-monospace,monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = 'rgba(255,236,190,0.55)'; g.shadowBlur = 14;
    g.fillText('R E S T A R T', 256, 58);
  }
  restartBtn = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.7),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(rbCv), transparent: true, depthWrite: false, fog: false }));
  restartBtn.position.set(0, 2.05, FINISH + 2.6); restartBtn.visible = false;
  // the maker's plate, hanging under the sign: quiet, only visible when the sign is
  { const pc = document.createElement('canvas'); pc.width = 512; pc.height = 64;
    const pg = pc.getContext('2d');
    pg.fillStyle = 'rgba(222,216,198,0.85)'; pg.font = '300 22px ui-monospace,monospace';
    pg.textAlign = 'center'; pg.textBaseline = 'middle';
    pg.fillText('STEP — made by Shuhei Yoshida', 256, 32);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.24),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(pc), transparent: true, depthWrite: false, fog: false }));
    plate.position.set(0, -0.52, 0.002); restartBtn.add(plate);
  }
  scene.add(restartBtn);
  // street trees: a real suburb has them every ~20m along the road
  for (let tz = 6; tz < 250; tz += 14 + rng() * 10) {
    const ts = rng() < 0.5 ? -1 : 1;
    addTree(rng() < 0.4 ? pick(DEAD_TREES) : pick(OK_TREES), ts * (RW + 8.5 + rng() * 2), tz, 7, 11); // clear of the shoulder line, not over the asphalt
    if (rng() < 0.5) addTree(pick(['Flowers','Grass_2']), ts * (RW + 4.8 + rng() * 2), tz + 3, 0.9, 1.3);
  }
  // weeds dotting the cracked shoulders everywhere
  for (let w = 0; w < 70; w++) {
    const sgn = rng() < 0.5 ? -1 : 1;
    addBaked(rng() < 0.6 ? 'Grass' : 'Grass_Short', sgn * (RW + 1.2 + rng() * 5.5), -8 + rng() * 245, 1, rng() * 6.283);
  }
  // 路肩：枯れ草と土（アメリカ郊外）
  for (const sx of [RW + 2.6, -(RW + 2.6)]) {
    const shMat = new THREE.MeshStandardMaterial({ color: 0xbfb096, roughness: 1 });
    const sdp = new THREE.TextureLoader().load('tex/sand_diff.jpg?v=' + AV);
    sdp.wrapS = sdp.wrapT = THREE.RepeatWrapping; sdp.repeat.set(4, 247); sdp.colorSpace = THREE.SRGBColorSpace; sdp.anisotropy = 8;
    const snp = new THREE.TextureLoader().load('tex/sand_nrm.jpg?v=' + AV);
    snp.wrapS = snp.wrapT = THREE.RepeatWrapping; snp.repeat.set(4, 247); shMat.normalScale = new THREE.Vector2(1.4, 1.4);
    shMat.map = sdp; shMat.normalMap = snp;
    texScroll.push({ t: shMat.map, len: ROAD_LEN / 247 }, { t: shMat.normalMap, len: ROAD_LEN / 247 });
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(5, ROAD_LEN), shMat);
    sh.rotation.x = -Math.PI / 2; sh.position.set(sx, 0.008, ROAD_C);
    scene.add(sh); edgeLines.push(sh);
  }
  // 中央：色褪せたダブルライン／白フェザーライン
  const ymat = new THREE.MeshBasicMaterial({ map: paintTex(0xc9a24a, 1), transparent: true, opacity: 0.85 });
  texScroll.push({ t: ymat.map, len: (ROAD_LEN - 10) / 60 });
  for (const dx of [-0.12, 0.12]) {
    const y = new THREE.Mesh(new THREE.PlaneGeometry(0.11, ROAD_LEN - 10), ymat);
    y.rotation.x = -Math.PI / 2; y.position.set(dx, 0.04, 245);
    scene.add(y); edgeLines.push(y);
  }
  function crumbleTex() {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 512;
    const g = cv.getContext('2d');
    const img = g.createImageData(128, 512);
    for (let y = 0; y < 512; y++) for (let x = 0; x < 128; x++) {
      const i = (y * 128 + x) * 4;
      let a = 1.25 - (x / 128) * 1.5;
      const n = (Math.sin(x * 0.31 + y * 0.043) + Math.sin(x * 0.17 - y * 0.09) + Math.sin((x - y) * 0.061)) / 3 * 0.5 + 0.5;
      a -= n * 0.75;
      if (_sr() < 0.1) a = 0;
      a = Math.max(0, Math.min(1, a)) * (0.7 + _sr() * 0.3);
      const v = 34 + _sr() * 42;
      img.data[i] = v + 8; img.data[i + 1] = v; img.data[i + 2] = v + 16; img.data[i + 3] = a * 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, 71);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const cmat = new THREE.MeshBasicMaterial({ map: crumbleTex(), transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
  texScroll.push({ t: cmat.map, len: ROAD_LEN / 71 });
  for (const sx of [RW + 0.18, -(RW + 0.18)]) {
    const cm = new THREE.Mesh(new THREE.PlaneGeometry(0.9, ROAD_LEN), cmat);
    cm.rotation.x = -Math.PI / 2;
    if (sx < 0) cm.scale.x = -1;
    cm.position.set(sx, 0.05, ROAD_C);
    scene.add(cm); edgeLines.push(cm);
  }
  const gravel = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.04, 0),
    new THREE.MeshStandardMaterial({ color: 0x77705f, roughness: 1, flatShading: true }), 60);
  gravel.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(60 * 3), 3);
  for (let k = 0; k < 60; k++) {
    if (rng() < 0.45) { gravel.setMatrixAt(k, new THREE.Matrix4().scale(new THREE.Vector3(0, 0, 0))); continue; }
    const cl = (k % 4 === 0 && rng() < 0.5) ? (rng() < 0.5 ? RW : -(RW)) : (rng() * 6 - 3);
    const gx = cl + (rng() - 0.5) * 0.5;
    const sc = 0.5 + rng() * 0.9;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 0.6, rng() * Math.PI, rng() * 0.6));
    gravel.setMatrixAt(k, new THREE.Matrix4().compose(new THREE.Vector3(gx, 0.012 * sc, -200 + k * 7 + rng() * 5), q, new THREE.Vector3(sc, sc * 0.6, sc)));
    const t = 0.75 + rng() * 0.5;
    gravel.setColorAt(k, new THREE.Color(t * 0.55, t * 0.52, t * 0.46));
  }
  gravel.instanceMatrix.needsUpdate = true;
  if (gravel.instanceColor) gravel.instanceColor.needsUpdate = true;
  gravel.position.z = 90;
  scene.add(gravel);
  const gravel2 = new THREE.InstancedMesh(gravel.geometry, gravel.material, 60);
  gravel2.instanceMatrix = gravel.instanceMatrix; gravel2.instanceColor = gravel.instanceColor;
  gravel2.position.z = 480; scene.add(gravel2);
  const wmat = new THREE.MeshBasicMaterial({ map: paintTex(0xd9d2c0), transparent: true, opacity: 0.9 });
  texScroll.push({ t: wmat.map, len: STAGE_LEN / 60 });
  for (const wx of [RW - 0.32, -(RW - 0.32)]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(0.13, STAGE_LEN), wmat);
    w.rotation.x = -Math.PI / 2; w.position.set(wx, 0.04, 0);
    scene.add(w); edgeLines.push(w);
  }
  // アスファルトのひび（ごく控えめ）
  const cr = new THREE.InstancedMesh(new THREE.BoxGeometry(0.018, 0.006, 1.0), new THREE.MeshStandardMaterial({ color: 0x39323f, roughness: 1 }), 44);
  for (let k = 0; k < 44; k++) {
    const cx = (rng() - 0.5) * (RW * 2 - 0.8);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (rng() - 0.5) * 0.5, 0));
    cr.setMatrixAt(k, new THREE.Matrix4().compose(new THREE.Vector3(cx, 0.016, -200 + k * 9 + rng() * 5), q, new THREE.Vector3(1, 1, 0.35 + rng() * 0.55)));
  }
  cr.instanceMatrix.needsUpdate = true; cr.position.z = 100; scene.add(cr);
  const cr2 = new THREE.InstancedMesh(cr.geometry, cr.material, 44);
  cr2.instanceMatrix = cr.instanceMatrix; cr2.position.z = 493; scene.add(cr2);
  gravel.userData.pick = cr.userData.pick = true; // dev rod-scan helper
}

// ============ palette tinting: baked props fade with the sunrise ============
function paintProps() {
  paletteAt(player.position.z, pal);
  for (const g of bakedProps) {
    g.traverse((o) => { if (o.isMesh && o.material && o.userData._orig !== undefined) {
      o.material.color.setHex(o.userData._orig).lerp(new THREE.Color(pal.prop), 0.45);
    } });
  }
  for (const g of props) {
    paletteAt(g.position.z, pal);
    g.userData.mat.color.setHex(pal.prop);
    const lc = g.userData.alt ? pal.light2 : pal.light;
    g.userData.lmat.emissive.setHex(lc);
    if (g.userData.glowMat) g.userData.glowMat.color.setHex(lc);
  }
}
setTimeout(paintProps, 0); // player is declared below; paint once the module has finished evaluating
// the fog already hides anything past ~150m; hiding it from the renderer too cuts the
// ============ dev URL hooks: ?z=NNN start there, ?sun=N force sunrise ============

const mZ = location.search.match(/[?&]z=(\d+)/);
if (mZ) setTimeout(() => { player.position.z = +mZ[1]; }, 50);
const mSun = location.search.match(/[?&]sun=([0-9.]+)/);
if (mSun) setTimeout(() => { window.__sun = Math.min(1, +mSun[1]); }, 50);
// ============ city (PLATEAU 仙台 LOD1、実在の街) ============
const WANT_CITY2 = WANT_CITY;
let cityMat = null, cityEdgeMat = null;
if (WANT_CITY) {
  fetch('city.json').then((r) => r.json()).then((data) => {
    const pos = [];
    const OFF_X = 0; // rotation baked into city.json (heading 98, offset 147)
    for (const b of data.buildings) {
      const n0 = b.r.length - 1;
      if (n0 < 3) continue;
      let cx = 0, cz = 0;
      for (let i = 0; i < n0; i++) { cx += b.r[i][0]; cz += b.r[i][1]; }
      cx = cx / n0 + OFF_X; cz = cz / n0;
      if (Math.abs(cx) > 170 || cz < -90 || cz > 1300) continue;
      let area2 = 0;
      for (let i = 0; i < n0; i++) {
        const p1 = b.r[i], p2 = b.r[(i + 1) % n0];
        area2 += p1[0] * p2[1] - p2[0] * p1[1];
      }
      const pts = b.r.slice(0, n0);
      if (area2 > 0) pts.reverse();
      const H = b.h;
      for (let i = 0; i < n0; i++) {
        const p1 = pts[i], p2 = pts[(i + 1) % n0];
        const x1 = p1[0] + OFF_X, z1 = p1[1], x2 = p2[0] + OFF_X, z2 = p2[1];
        pos.push(x1, 0, z1, x2, 0, z2, x2, H, z2);
        pos.push(x1, 0, z1, x2, H, z2, x1, H, z1);
      }
      for (let i = 1; i < n0 - 1; i++) {
        pos.push(pts[0][0] + OFF_X, H, pts[0][1]);
        pos.push(pts[i][0] + OFF_X, H, pts[i][1]);
        pos.push(pts[i + 1][0] + OFF_X, H, pts[i + 1][1]);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    cityMat = new THREE.MeshStandardMaterial({ color: 0x241b3a, roughness: 0.9 });
    scene.add(new THREE.Mesh(geo, cityMat));
    const eg = new THREE.EdgesGeometry(geo, 30);
    cityEdgeMat = new THREE.LineBasicMaterial({ color: 0xff3ec8, transparent: true, opacity: 0.28 });
    scene.add(new THREE.LineSegments(eg, cityEdgeMat));
  });
}

// ============ character (gray-box rigger) ============
const player = new THREE.Group();
scene.add(player);
if (WANT_STAGE) player.position.x = RW - 0.7;   // 白線の-inner、路肩側を歩く（カメラはキャラに付く）
const body = new THREE.Group();
if (WANT_CITY) body.scale.setScalar(1.12);
else if (WANT_STAGE) body.scale.setScalar(0.82);
if (WANT_STAGE) body.visible = false;  // the gray-box rigger never shows in stage mode
player.add(body);
const hips = new THREE.Group();
hips.position.y = 0.92;
body.add(hips);

const matPants = new THREE.MeshStandardMaterial({ color: 0xdde1e8, roughness: 0.72 });
const matJacket = new THREE.MeshStandardMaterial({ color: 0x2e3440, roughness: 0.6 });
const matSkin = new THREE.MeshStandardMaterial({ color: 0xd6a084, roughness: 0.55 });
const matHair = new THREE.MeshStandardMaterial({ color: 0x241d15, roughness: 0.48 });
const matShoe = new THREE.MeshStandardMaterial({ color: 0xd63a50, roughness: 0.5, emissive: 0x1c0408 });
const matSole = new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.8 });

function seg(parent, x, y, len, r, mat, jointR) {
  const g = new THREE.Group(); g.position.set(x, y, 0);
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.012, len - 2 * r), 3, 10), mat);
  m.position.y = -len / 2; g.add(m);
  if (jointR) { const j = new THREE.Mesh(new THREE.SphereGeometry(jointR, 12, 9), mat); g.add(j); }
  parent.add(g); return g;
}
function shoe(parent) {
  const g = new THREE.Group();
  const sole = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.045, 0.285), matSole);
  sole.position.set(0, -0.075, 0.045); g.add(sole);
  const up = new THREE.Mesh(new THREE.CapsuleGeometry(0.056, 0.135, 3, 10), matShoe);
  up.rotation.x = Math.PI / 2; up.position.set(0, -0.038, 0.05); up.scale.y = 0.92; g.add(up);
  const ankle = new THREE.Mesh(new THREE.SphereGeometry(0.052, 10, 8), matShoe);
  g.add(ankle);
  parent.add(g); return g;
}
const thighL = seg(hips, -0.085, 0, 0.42, 0.072, matPants, 0.076);
const shinL = seg(thighL, 0, -0.42, 0.40, 0.056, matPants, 0.062);
shoe(shinL).position.y = -0.40;
const thighR = seg(hips, 0.085, 0, 0.42, 0.072, matPants, 0.076);
const shinR = seg(thighR, 0, -0.42, 0.40, 0.056, matPants, 0.062);
shoe(shinR).position.y = -0.40;

const torso = new THREE.Group(); hips.add(torso);
const chestM = new THREE.Mesh(new THREE.CapsuleGeometry(0.155, 0.14, 4, 14), matJacket);
chestM.position.y = 0.26; chestM.scale.set(1.06, 1, 0.82); torso.add(chestM);
const waistM = new THREE.Mesh(new THREE.CapsuleGeometry(0.134, 0.10, 3, 12), matJacket);
waistM.position.y = 0.06; waistM.scale.set(1.02, 1, 0.85); torso.add(waistM);
const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.105, 14, 10), matPants);
pelvis.scale.set(1.02, 0.55, 0.8); pelvis.position.y = -0.005; hips.add(pelvis);
for (const sx of [-1, 1]) {
  const sh = new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), matJacket);
  sh.position.set(sx * 0.185, 0.42, 0); torso.add(sh);
}
const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.048, 0.08, 10), matSkin);
neck.position.y = 0.505; torso.add(neck);
const headG = new THREE.Group(); headG.position.y = 0.615; torso.add(headG);
const skull = new THREE.Mesh(new THREE.SphereGeometry(0.113, 18, 14), matSkin);
skull.scale.set(1, 1.09, 0.98); skull.position.y = 0.012; headG.add(skull);
const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.088, 14, 10), matSkin);
jaw.scale.set(0.98, 0.8, 1.0); jaw.position.set(0, -0.045, 0.012); headG.add(jaw);
const hair = new THREE.Mesh(new THREE.SphereGeometry(0.121, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), matHair);
hair.scale.set(1.01, 1.02, 1.02); hair.position.set(0, 0.018, -0.006); headG.add(hair);
const hairBack = new THREE.Mesh(new THREE.SphereGeometry(0.098, 12, 10), matHair);
hairBack.scale.set(0.96, 0.9, 0.8); hairBack.position.set(0, -0.012, -0.052); headG.add(hairBack);
const armL = seg(torso, -0.235, 0.44, 0.30, 0.05, matJacket, 0.054);
const foreL = seg(armL, 0, -0.30, 0.26, 0.043, matJacket, 0.047);
const handL = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), matSkin);
handL.scale.set(0.9, 1.05, 0.7); handL.position.y = -0.29; foreL.add(handL);
const armR = seg(torso, 0.235, 0.44, 0.30, 0.05, matJacket, 0.054);
const foreR = seg(armR, 0, -0.30, 0.26, 0.043, matJacket, 0.047);
const handR = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), matSkin);
handR.scale.set(0.9, 1.05, 0.7); handR.position.y = -0.29; foreR.add(handR);

const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20),
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 }));
shadow.rotation.x = -Math.PI / 2;
shadow.position.y = 0.036;
body.add(shadow);

// ---- skeletal character (GLB) for stage mode ----
let skel = null;
function loadMorph() {
  new GLTFLoader().load('./models/RobotExpressive.glb?v=' + AV, (gltf) => {
    const m = gltf.scene;
    const box = new THREE.Box3().setFromObject(m);
    const h = box.max.y - box.min.y;
    m.scale.setScalar(0.68 / h); // Morph: half size, chibi-friend of the roster
    // Sole-truth measurement (union of skinned meshes vs raycast road): at lift
    // 33 mm the walk's deepest frame sat ~14 mm under the asphalt; 49 mm brought
    // it to road-3 mm. 55 mm adds the margin that keeps the ball-feet visibly
    // clear of the road at the phone camera's lower angle.
    m.position.y = MORPH_LIFT;
    player.add(m);
    const mixer = new THREE.AnimationMixer(m);
    const acts = {};
    for (const clip of gltf.animations) acts[clip.name] = mixer.clipAction(clip);
    // THE post-action sink, found by auditing the clip itself: the pack's Walking
    // clip never writes Hips — no position track, no rotation track. Our step clips
    // DO move Hips (hop/yaw/pitch), and when an action crossfades out, nothing pulls
    // Hips back: the robot kept walking with his hips parked wherever the last action
    // left them — sunk or tilted. Pin Hips to its bind transform across the whole
    // Walking clip so any return to walking blends the body back to standing height.
    let hipsBone = null;
    m.traverse((o) => { if (!hipsBone && o.name === 'Hips') hipsBone = o; });
    if (hipsBone) {
      // Defensive pin: strip Hips.position from any pack clip that carries one,
      // so a future clip swap can't reintroduce hip-drift. (Measured on this
      // pack: none of them actually write Hips.position — the sink we chased
      // came from our own step clips leaving Hips parked when they faded out,
      // which the Walking pin below fixes.)
      const p = hipsBone.position, q = hipsBone.quaternion;
      let nPin = 0;
      for (const c of gltf.animations) {
        const keep = c.tracks.filter((t) => t.name !== 'Hips.position');
        if (keep.length !== c.tracks.length) {
          c.tracks = keep.concat([new THREE.VectorKeyframeTrack('Hips.position',
            [0, c.duration], [p.x, p.y, p.z, p.x, p.y, p.z])]);
          mixer.uncacheClip(c);
          nPin++;
        }
      }
      const wc = gltf.animations.find((c) => c.name === 'Walking');
      if (wc) {
        // Walking ships with NO hips tracks at all (that's what left the body
        // parked after actions) — give it both pins explicitly.
        const D = wc.duration;
        wc.tracks.push(new THREE.VectorKeyframeTrack('Hips.position', [0, D],
          [p.x, p.y, p.z, p.x, p.y, p.z]));
        wc.tracks.push(new THREE.QuaternionKeyframeTrack('Hips.quaternion', [0, D],
          [q.x, q.y, q.z, q.w, q.x, q.y, q.z, q.w]));
        mixer.uncacheClip(wc);
      }
      acts.Walking = mixer.clipAction(wc);
    }
    const walk = acts.Walking;
    const idle = acts.Idle || walk;
    const dance = acts.Dance || walk;
    const jump = acts.Jump || walk;
    jump.setLoop(THREE.LoopOnce, 1); jump.clampWhenFinished = true;
    walk.play();
    body.visible = false;
    buildStepClips(mixer, m, acts, RIG_ROBOT, 0.055);
    // the face-plant gag: the head bone pitches down hard when he eats the road
    let headBone = null;
    m.traverse((o) => { if (!headBone && /^\s*(mixamorig)?head\b/i.test(o.name || '')) headBone = o; });
    if (headBone && acts.FacePlant) try {
      const cp = (acts.FacePlant.getClip && acts.FacePlant.getClip()) || acts.FacePlant.clip;
      if (!cp) console.warn('no FacePlant clip:', typeof acts.FacePlant);
      if (cp) {
      const n = Math.round(cp.duration * 24) + 1;
      const tArr = new Float32Array(n), qArr = new Float32Array(n * 4);
      const base = headBone.quaternion.clone();
      const keys = [0,0, 0.5,0.1, 0.9,0.8, 1.3,1.0, 2.2,0.95, 2.7,-0.15, 3.05,0.1, 3.4,0, 4,0];
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1) * 4;
        tArr[i] = i / (n - 1) * cp.duration;
        let a = keys[1];
        for (let j = 0; j + 3 < keys.length; j += 2) {
          if (t >= keys[j] && t <= keys[j+2]) {
            let u = (t - keys[j]) / (keys[j+2] - keys[j]); u = u * u * (3 - 2 * u);
            a = keys[j+1] + (keys[j+3] - keys[j+1]) * u; break;
          } else if (t > keys[j+2]) a = keys[j+3];
        }
        const q = base.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a));
        qArr[i*4] = q.x; qArr[i*4+1] = q.y; qArr[i*4+2] = q.z; qArr[i*4+3] = q.w;
      }
      if (cp.tracks) cp.tracks.push(new THREE.QuaternionKeyframeTrack(headBone.name + '.quaternion', tArr, qArr));
      mixer.uncacheAction(acts.FacePlant);
      acts.FacePlant = mixer.clipAction(cp);
      }
    } catch (e) { console.warn('head gag skipped:', e.message); }
    placeChar(3, { name: 'MORPH', m, mixer, acts, walk, idle, run: dance, dance, jump,
      stepClips: [acts.Skip, acts.IrishHop, acts.FacePlant, acts.JetDash,
        acts.Gallop, acts.Chasse, acts.Polka, acts.KickBall, acts.Running, acts.Grapevine],
      stepNames: ['SKIP', 'IRISH HOP', 'FACE PLANT', 'JET DASH', 'GALLOP', 'CHASSE', 'POLKA', 'KICK-BALL', 'RUNNING', 'GRAPEVINE'],
      jetDash: true, facePlant: true, mixdur: { 2: 2.5, 3: 1.85 },
      ready: true,
      cur: walk, stepTimer: -1, stepDur: 0 });
  });
}

// roster order: 0 boy, 1 girl, 2 aj, 3 robot
const chars = [null, null, null, null];
// ---- start gate: Timmy's mesh + his 4 step clips must all be in ----
let LOADDONE = 0; const LOADTOT = 5;
let STARTABLE = false;
const WANT_PERF = location.search.includes('perf=1');
const _pf = { n: 0, sum: 0, worst: 0, t: 0, last: performance.now() };
const loadFill = document.querySelector('#loadbar i');
window.addEventListener('load', () => { // frame-stop watchdog tells us CPU vs network next time
  renderer.domElement.addEventListener('webglcontextlost', (ev) => { ev.preventDefault(); showErr('GL context lost (graphics memory)'); });
  setInterval(() => {
    if ((!started && starting !== 'world') || window.__wdFired) return;
    const gap = performance.now() - (window.__frameT || performance.now());
    if (gap > 3500) { window.__wdFired = 1; showErr('frames stopped ' + Math.round(gap / 100) / 10 + 's (CPU stall, not network)'); }
  }, 1500);
});
let charsReady = 0;
function barUpdate() {
  if (!loadFill) return; // the bar means: Timmy is ready. the street keeps streaming after
  loadFill.style.width = Math.min(100, Math.round(LOADDONE / LOADTOT * 100)) + '%';
}
window.__barFn = barUpdate; window.__maybeLit = maybeLit;
function maybeLit() {
  if (STARTABLE) return;
  if (LOADDONE < LOADTOT) { barUpdate(); return; }
  STARTABLE = true;
  if (loadFill) loadFill.style.width = '100%';
  document.getElementById('start').classList.add('lit');
  if (window.__armProps) window.__armProps();
}
function tickLoad() {
  LOADDONE++;
  barUpdate();
  maybeLit();
}
// only the opening character loads up front. the other three download the first time
// their button is pressed — no bandwidth fight at start, nothing parsing mid-walk.
let NO_MIXAMO = false; // builds shipped without the Mixamo files: Morph carries the start
loadBoy();
const lazyLoad = [null, loadGirl, loadAj, loadMorph];
let pendingChar = -1;
// Claire/Aj (~35MB) wait for Timmy's gate: they used to fight Timmy's assets for bandwidth
// and their parse landed mid-walk. they load right after the screen lights, and always
// before their buttons can light.
let charIdx = 0;
let userPickedChar = false;
function placeChar(i, chr) {
  console.log('char ready slot ' + i + ' @' + Math.round(performance.now()) + 'ms mvis=' + chr.m.visible + ' skelSlot=' + (skel ? skel.slot : 'none'));
  chr.slot = i;
  charsReady++; maybeLit();
  // the waiting screen shows no character until Timmy is complete
  // parked until the opening character exists: must go in hidden, or whichever
  // loader finishes first (Morph is tiny, so it always wins) stands on the player forever
  // parked until the opening character exists — but in a Mixamo-less build the
  // robot that did load IS the opening character: it goes in visible, as skel
  if (!skel && !(i === 0 && chr.ready) && !NO_MIXAMO) { chr.m.visible = false; chars[i] = chr; refreshCharUI(); return; }
  chr.m.visible = (skel === null);
  if (!skel) { skel = chr; charIdx = i; chr.m.visible = true; }
  else if (!userPickedChar && i < charIdx) {  // roster order wins until the user picks
    skel.m.visible = false;
    skel = chr; charIdx = i; chr.m.visible = true;
  }
  chars[i] = chr;
  refreshCharUI();
  if (pendingChar === i) { pendingChar = -1; setChar(i); }
}
function loadBoy() {
  new GLTFLoader().load('./models/boy/timmy_v2.glb?v=' + AV, (gltf) => {
    const m = gltf.scene;
    const box = new THREE.Box3().setFromObject(m);
    const h = box.max.y - box.min.y;
    m.scale.setScalar(1.02 / h);
    m.visible = false;
    player.add(m);
    const mixer = new THREE.AnimationMixer(m);
    const acts = {};
    for (const c of gltf.animations) acts[c.name] = mixer.clipAction(c);
    buildStepClips(mixer, m, acts, RIG_MIX, 0.05 * h);
    const walk = acts.Walk;
    walk.play();
    console.log('TIMMY walk tracks:', walk.getClip().tracks.map(t => t.name).join(','));
    const chr = { mixdur: {}, mixfx: {}, m, mixer, acts, walk, idle: acts['mixamo.com'] || walk,
      run: walk, dance: acts['mixamo.com'] || walk, jump: acts['mixamo.com'] || walk,
      stepClips: [null, null, null, null],
      cur: walk, stepTimer: -1, stepDur: 0, ready: false,
      want: { 0: false, 1: false, 2: false, 3: false } };
    chr.checkReady = () => {
      chr.ready = chr.want[0] && chr.want[1] && chr.want[2] && chr.want[3];
      if (chr.ready && !chr.placed) { chr.placed = true; placeChar(0, chr); }
    };
    chr.stepNames = BOYSTEPNAMES;
    chr.name = 'TIMMY';
    chr.stopstep = [false, true, true, true];
    tickLoad(); // glb in
    loadMixamoClips(m, mixer, acts, chr);
  }, undefined, () => {
    if (!window.__boyTry) { window.__boyTry = 1; dbg('Timmy retry'); setTimeout(loadBoy, 1500); }
    else { // builds without the Mixamo meshes fall back to the CC0 robot, then light the gate
      NO_MIXAMO = true;
      LOADDONE = LOADTOT; maybeLit();
      if (!chars[3]) loadMorph();
      refreshCharUI();
    }
  });
}

// ---- Girl: same rig, dance clips; every action is a stop step ----
const GIRLCLIPS = [
  ['girl_NorthernSoulSpin', 'SOUL SPIN'],
  ['girl_hiphop2', 'HIP HOP 2'],
  ['girl_RumbaDancing', 'RUMBA'],
  ['girl_HipHopDancing', 'HIP HOP'],
];
const AJCLIPS = [
  ['aj_gangnam', 'GANGNAM STYLE'],
  ['aj_house1', 'HOUSE VAR1'],
  ['aj_house', 'HOUSE'],
  ['aj_shuffle', 'SHUFFLING'],
];

function loadAj() {
  new GLTFLoader().load('./models/clips/aj_v2.glb?v=' + AV, (gltf) => {
    const m = gltf.scene;
    m.traverse(o => { // the Mixamo meshes come out too shiny/plasticky — dull them, keep the colors as-is
      if (!o.material) return;
      for (const mm of [].concat(o.material)) {
        if (mm.roughness !== undefined) mm.roughness = Math.min(0.96, Math.max(mm.roughness, 0.72));
        if (mm.metalness !== undefined) mm.metalness = Math.min(mm.metalness, 0.15);
      }
    });
    const box = new THREE.Box3().setFromObject(m);
    const h = box.max.y - box.min.y;
    m.scale.setScalar(1.28 / h);
    m.visible = false;
    player.add(m);
    const mixer = new THREE.AnimationMixer(m);
    const acts = {};
    const chr = { mixdur: {}, mixfx: {}, m, mixer, acts, walk: null, idle: null,
      run: null, dance: null, jump: null,
      stepClips: [null, null, null, null],
      cur: null, stepTimer: -1, stepDur: 0, ready: false,
      want: { 0: false, 1: false, 2: false, 3: false } };
    chr.checkReady = () => { chr.ready = chr.want[0] && chr.want[1] && chr.want[2] && chr.want[3]; if (chr.ready) console.log((chr.name || 'char') + ' clips ready @' + Math.round(performance.now()) + 'ms'); };
    chr.stepNames = AJCLIPS.map((x) => x[1]);
    chr.name = 'AJ';
    chr.stopstep = [true, true, true, true];
    placeChar(2, chr);
    (async () => {
      for (let slot = 0; slot < 4; slot++) {
        const [file] = AJCLIPS[slot];
        const clip = await loadStepClip('./models/clips/' + file + '.stpc', file);
        acts['A' + file] = mixer.clipAction(clip);
        chr.stepClips[slot] = acts['A' + file];
        const bt = beatify(clip);
        acts['A' + file].timeScale = bt.ts;
        chr.mixdur[slot] = bt.dur;
        chr.mixfx[slot] = (bt.fp !== undefined) ? { fp: bt.fp, per: bt.per } : null;
        chr.want[slot] = true; chr.checkReady();
      }
      const wk = await loadStepClip('./models/clips/aj_walking.stpc', 'AJWalking');
      acts.AJWalking = mixer.clipAction(wk);
      acts.AJWalking.timeScale = wk.duration / (2 * BEAT);
      const wp = pulsesOf(wk);
      chr.walkfx = wp && wp.steps >= 2 ? wp.fp + wk.duration / 4 : 0;
      if (chr.walk === null || chr.walk === acts.AJWalking) {
        chr.walk = acts.AJWalking;
        chr.idle = acts.AJWalking;
        if (!chr.cur) {
          acts.AJWalking.reset().setEffectiveWeight(1).play();
          const ph = ((songPhase() % 2) + 2) % 2;
          acts.AJWalking.time = (ph / 2) * wk.duration / Math.max(acts.AJWalking.timeScale, 1e-4);
          chr.cur = acts.AJWalking;
        }
      }
      if (pendingChar === 2) { pendingChar = -1; setChar(2); }
    })().catch((e) => console.warn('aj clips failed', e));
    refreshCharUI();
  }, undefined, (e) => console.warn('aj mesh failed', e));
}

function loadGirl() {
  // Claire's mesh ships as a pre-baked GLB (converted from the FBX by convert.html;
  // FBX parsing is slow, GLB loads fast — originals kept under models/mixamo/)
  new GLTFLoader().load('./models/clips/claire_v2.glb?v=' + AV, (gltf) => {
    const m = gltf.scene;
    m.traverse(o => { // the Mixamo meshes come out too shiny/plasticky — dull them, keep the colors as-is
      if (!o.material) return;
      for (const mm of [].concat(o.material)) {
        if (mm.roughness !== undefined) mm.roughness = Math.min(0.96, Math.max(mm.roughness, 0.72));
        if (mm.metalness !== undefined) mm.metalness = Math.min(mm.metalness, 0.15);
      }
    });
    const box = new THREE.Box3().setFromObject(m);
    const h = box.max.y - box.min.y;
    m.scale.setScalar(1.28 / h);
    m.visible = false;
    player.add(m);
    const mixer = new THREE.AnimationMixer(m);
    const acts = {};
    const chr = { mixdur: {}, mixfx: {}, m, mixer, acts, walk: null, idle: null,
      run: null, dance: null, jump: null,
      stepClips: [null, null, null, null],
      cur: null, stepTimer: -1, stepDur: 0, ready: false,
      want: { 0: false, 1: false, 2: false, 3: false } };
    chr.checkReady = () => { chr.ready = chr.want[0] && chr.want[1] && chr.want[2] && chr.want[3]; if (chr.ready) console.log((chr.name || 'char') + ' clips ready @' + Math.round(performance.now()) + 'ms'); };
    chr.stepNames = GIRLCLIPS.map((x) => x[1]);
    chr.name = 'CLAIRE';
    chr.stopstep = [true, true, true, true];
    placeChar(1, chr);
    (async () => {
      for (let slot = 0; slot < 4; slot++) {
        const [file] = GIRLCLIPS[slot];
        const clip = await loadStepClip('./models/clips/' + file + '.stpc', file);
        acts['G' + file] = mixer.clipAction(clip);
        chr.stepClips[slot] = acts['G' + file];
        const bt = beatify(clip);
        acts['G' + file].timeScale = bt.ts;
        chr.mixdur[slot] = bt.dur;
        chr.mixfx[slot] = (bt.fp !== undefined) ? { fp: bt.fp, per: bt.per } : null;
        chr.want[slot] = true; chr.checkReady();
      }
      const wk = await loadStepClip('./models/clips/girl_Walking.stpc', 'GWalking');
      acts.GWalking = mixer.clipAction(wk);
      acts.GWalking.timeScale = wk.duration / (2 * BEAT);
      const wp = pulsesOf(wk);
      chr.walkfx = wp && wp.steps >= 2 ? wp.fp + wk.duration / 4 : 0;
      chr.walk = acts.GWalking;
      chr.idle = acts.GWalking;
      if (!chr.cur) {
        acts.GWalking.reset().setEffectiveWeight(1).play();
        const ph = ((songPhase() % 2) + 2) % 2;
        acts.GWalking.time = (ph / 2) * wk.duration / Math.max(acts.GWalking.timeScale, 1e-4);
        chr.cur = acts.GWalking;
      }
      if (pendingChar === 1) { pendingChar = -1; setChar(1); }
    })().catch((e) => console.warn('girl clips failed', e));
    refreshCharUI();
  }, undefined, (e) => console.warn('girl mesh failed', e));
}

const charbar = document.getElementById('charbar');
const stepPad = document.getElementById('pad');
stepPad.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  if (!started) { begin(); return; }
  if (b.id === 'padW') { if (step) endStep(0.15); b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 160); return; }
  triggerStep(+b.dataset.step);
  b.classList.add('hit');
  setTimeout(() => b.classList.remove('hit'), 160);
}, { passive: false });
const cBtns = [document.getElementById('cBoy'), document.getElementById('cGirl'), document.getElementById('cAj'), document.getElementById('cRobot')];
cBtns.forEach((btn, i) => {
  btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); userPickedChar = true; setChar(i); });
});
function refreshCharUI() {
  cBtns.forEach((b, j) => {
    b.classList.toggle('on', j === charIdx);
    // tappable even before a character has downloaded — pressing it IS the download;
    // only the opening character's button waits on its own load
    b.disabled = (j === 0 && !chars[0]) || (NO_MIXAMO && j < 3);
  });
}
function setChar(i) {
  if (NO_MIXAMO && i < 3) return; // slots not shipped in this build
  if (i === charIdx) return;
  if (!chars[i] || !chars[i].walk) {          // model or walk clip still in flight:
    if (lazyLoad[i] && !chars[i] && pendingChar !== i) { pendingChar = i; lazyLoad[i](); }
    else pendingChar = i;                     // finish the switch when the clip lands
    return;
  }
  skel.stepTimer = -1;
  step = null;
  activeStep = null;
  playerYaw = 0;
  skel.m.visible = false;
  charIdx = i;
  skel = chars[charIdx];
  // show only AFTER this character's mixer has really run one frame (below, in tick):
  // a mixer.update(0) alone was not enough — the first frame still flashed the bind pose
  skel.m.visible = false;
  skel._arm = 1;
  if (skel.walk && skel.cur === skel.walk) {
    const D = skel.walk._clip.duration;
    const c0 = skel.walkfx || 0;
    skel.walk.time = (((c0 + songPhase() * (D / 2)) % D) + D) % D / Math.max(skel.walk.timeScale, 1e-4);
  } else if (skel.walk) { skel.cur = skel.walk; skel.walk.reset().play(); }
  // a just-downloaded character's mixer never ran — without this the FIRST frame
  // after switching renders the bind pose (the T-pose flash on Claire/Aj)
  try { skel.mixer.update(0); } catch (e) {}
  hudFlash = skel.name;
  refreshCharUI();
}
function swapChar() {
  // B walks the roster in order, downloading whichever character comes next
  setChar((charIdx + 1) % chars.length);
}

function skelUse(a, fade) {
  if (!skel || !a || skel.cur === a) return;
  a.reset().setEffectiveWeight(1).play();
  if (a === skel.walk) {
    // phase-lock the walk cycle: one L+R cycle = 2 beats, foot contacts on the grid
    const D = a._clip.duration;
    const c0 = skel.walkfx || 0;
    a.time = (((c0 + songPhase() * (D / 2)) % D) + D) % D / Math.max(a.timeScale, 1e-4);
  }
  if (skel.cur) a.crossFadeFrom(skel.cur, fade, false);
  skel.cur = a;
}


// ---- procedural beat-locked step clips for RobotExpressive ----
function loadUAL(m, mixer, acts, chr) {
  new GLTFLoader().load('./models/ual/UAL1_Standard.glb', (g) => {
    const NAMES = {
      mixamorig6Hips: 'pelvis', mixamorig6Spine: 'spine_01', mixamorig6Spine1: 'spine_02',
      mixamorig6Spine2: 'spine_03', mixamorig6Neck: 'neck_01', mixamorig6Head: 'head',
      mixamorig6LeftShoulder: 'clavicle_l', mixamorig6LeftArm: 'upperarm_l',
      mixamorig6LeftForeArm: 'lowerarm_l', mixamorig6LeftHand: 'hand_l',
      mixamorig6RightShoulder: 'clavicle_r', mixamorig6RightArm: 'upperarm_r',
      mixamorig6RightForeArm: 'lowerarm_r', mixamorig6RightHand: 'hand_r',
      mixamorig6LeftUpLeg: 'thigh_l', mixamorig6LeftLeg: 'calf_l',
      mixamorig6LeftFoot: 'foot_l', mixamorig6LeftToeBase: 'ball_l',
      mixamorig6RightUpLeg: 'thigh_r', mixamorig6RightLeg: 'calf_r',
      mixamorig6RightFoot: 'foot_r', mixamorig6RightToeBase: 'ball_r',
    };
    let src = null, tgt = null;
    g.scene.traverse((o) => { if (!src && o.isSkinnedMesh) src = o; });
    m.traverse((o) => { if (!tgt && o.isSkinnedMesh) tgt = o; });
    if (!src || !tgt) return;
    const want = [['UALWalk', 'Walk_Loop'], ['UALJog', 'Jog_Fwd_Loop'],
      ['UALSprint', 'Sprint_Loop'], ['UALJump', 'Jump_Loop'], ['UALDance', 'Dance_Loop']];
    for (const [nm, an] of want) {
      const cl = g.animations.find((a) => a.name === an);
      if (!cl) continue;
      try {
        const rc = retargetClip(tgt, src.skeleton, cl, { names: NAMES });
        for (const t of rc.tracks) {
                    if (t.name.startsWith('.bones[')) {
            const mm = t.name.match(/^\.bones\[(.+)\]\.(.+)$/);
            if (mm) t.name = mm[1] + '.' + mm[2];
          }
        }
        acts[nm] = mixer.clipAction(rc);
      } catch (e) { console.warn('retarget', an, e.message); }
    }
    if (acts.UALWalk) {
      const d = acts.UALWalk.getClip().duration;
      acts.UALWalk.timeScale = d / (2 * BEAT);
      chr.walk = acts.UALWalk;
      skelUse(chr.walk, 0.3);
    }
    if (acts.UALJog) {
      chr.stepClips[5] = acts.UALJog;
      chr.mixdur[5] = acts.UALJog.getClip().duration;
    }
  });
}

async function loadStepClip(url, name) {
  const sep = url.includes('?') ? '&' : '?';
  const buf = await (await fetch(url + sep + 't=' + encodeURIComponent(location.search.slice(1)))).arrayBuffer();
  const dv = new DataView(buf); let o = 0;
  const n = dv.getUint32(o, true); o += 4;
  const dec = new TextDecoder();
  const tracks = []; let dur = 0;
  for (let i = 0; i < n; i++) {
    const nl = dv.getUint32(o, true); o += 4;
    const tname = dec.decode(new Uint8Array(buf, o, nl)); o += nl;
    const kind = dv.getUint8(o); o += 1;
    const nk = dv.getUint32(o, true); o += 4;
    const times = new Float32Array(buf.slice(o, o + nk * 4)); o += nk * 4;
    const dim = kind === 0 ? 4 : 3;
    const values = new Float32Array(buf.slice(o, o + nk * dim * 4)); o += nk * dim * 4;
    if (nk) dur = Math.max(dur, times[nk - 1]);
    tracks.push(kind === 0 ? new THREE.QuaternionKeyframeTrack(tname, times, values)
                           : new THREE.VectorKeyframeTrack(tname, times, values));
  }
  return new THREE.AnimationClip(name, dur, tracks);
}

// auto-fit a dance clip's speed so its step pulses land on the beat grid:
// count hips-Y pulses, then stretch the clip to exactly that many beats
function pulsesOf(clip) {
  const tr = clip.tracks.find((t) => /hips/i.test(t.name) && /position/.test(t.name));
  const D = clip.duration;
  if (!tr || D < 0.5) return null;
  const HZ = 100, N = Math.floor(D * HZ) + 1;
  const ys = new Float32Array(N);
  const tv = tr.times, vv = tr.values;
  for (let i = 0; i < N; i++) {
    const t = D * i / (N - 1);
    let k = 0;
    while (k < tv.length - 2 && tv[k + 1] < t) k++;
    const f = tv[k + 1] > tv[k] ? (t - tv[k]) / (tv[k + 1] - tv[k]) : 0;
    ys[i] = vv[k * 3 + 1] * (1 - f) + vv[(k + 1) * 3 + 1] * f;
  }
  // smooth over ~0.1s
  const sm = new Float32Array(N), W = 5;
  for (let i = 0; i < N; i++) { let a = 0, c = 0; for (let j = i - W; j <= i + W; j++) if (j >= 0 && j < N) { a += ys[j]; c++; } sm[i] = a / c; }
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < N; i++) { if (sm[i] < mn) mn = sm[i]; if (sm[i] > mx) mx = sm[i]; }
  const prom = (mx - mn) * 0.18, gap = Math.round(0.28 * HZ);
  const peaks = [];
  for (let i = 1; i < N - 1; i++) {
    if (sm[i] >= sm[i - 1] && sm[i] > sm[i + 1] && sm[i] - mn > prom * 0.5 && sm[i] > (mx + mn) / 2 - prom) {
      if (!peaks.length || i - peaks[peaks.length - 1] > gap) peaks.push(i);
      else if (sm[i] > sm[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = i;
    }
  }
  const steps = peaks.length;
  const fp = steps ? peaks[0] / HZ : 0;
  const per = steps > 1 ? (peaks[steps - 1] - peaks[0]) / HZ / (steps - 1) : D;
  return { fp, per, steps, D };
}
function beatify(clip) {
  const p = pulsesOf(clip);
  if (!p) return { ts: 1, dur: Math.max(1, Math.round(clip.duration / BEAT)) * BEAT };
  const D = p.D, steps = p.steps;
  console.log('beatify ' + clip.name + ': ' + steps + ' pulses in ' + D.toFixed(2) + 's, per ' + p.per.toFixed(3) + 's, fp ' + p.fp.toFixed(2));
  if (steps < 2) return { ts: 1, dur: Math.max(1, Math.round(D / BEAT)) * BEAT };
  // two honest grid mappings exist for every clip: pulses as whole beats, or as
  // half-beats (double-time). Pick whichever lands the timeScale nearest 1.0 —
  // that is the mapping the clip was performed in, and it's what reads as natural.
  const tsBeat = p.per / BEAT;
  const tsHalf = p.per / (BEAT / 2);
  let ts = Math.abs(Math.log(tsHalf)) < Math.abs(Math.log(tsBeat)) ? tsHalf : tsBeat;
  if (ts < 0.55 || ts > 1.6) return { ts: 1, dur: Math.round(D / BEAT) * BEAT };
  // real playback seconds = clip length ÷ timeScale; ceil so the last stomp
  // always gets room to land before walk takes over
  const bt = { ts, dur: Math.max(1, Math.ceil(D / ts / BEAT - 0.05)) * BEAT, fp: p.fp, per: p.per };
  console.log('beatify ' + clip.name + ': ts ' + ts.toFixed(3) + ', hold ' + bt.dur.toFixed(1) + 's');
  return bt;
}

function loadMixamoClips(m, mixer, acts, chr) {
  // registered steps now load from lossless compact containers (converted from the FBX,
  // originals kept under models/mixamo/); see convert.html
  (async () => {
    for (const [slot, file, act] of [[0, 'moonwalk', 'MxMoonwalk'], [1, 'bboyuprock', 'MxBboy'],
                                     [2, 'uprock3', 'MxBreakUprock'], [3, 'uprock_var1', 'MxBboyUprock']]) {
      const clip = await loadStepClip('./models/clips/' + file + '.stpc', act);
      acts[act] = mixer.clipAction(clip);
      if (slot === 0) {
        acts[act].timeScale = clip.duration / (2 * BEAT);
        chr.mixdur[0] = 4 * BEAT;
      } else {
        const bt = beatify(clip);
        acts[act].timeScale = bt.ts;
        chr.mixdur[slot] = bt.dur;
        chr.mixfx[slot] = (bt.fp !== undefined) ? { fp: bt.fp, per: bt.per } : null;
      }
      chr.stepClips[slot] = acts[act];
      chr.want[slot] = true; chr.checkReady();
      tickLoad();
    }
  })();
  const bones = {};
  m.traverse((o) => { if (o.name) bones[o.name.replace(/[._]/g, '')] = o; });
  const norm = (n) => n.replace(/^mixamorig\d*:?/i, '').replace(/[._]/g, '');
  const rename = (clip, keepMotion) => {
    for (const t of clip.tracks) {
      const dot = t.name.lastIndexOf('.');
      let node = t.name.slice(0, dot);
      if (node.startsWith('"') && node.endsWith('"')) node = node.slice(1, -1);
      const b = bones[norm(node)] || bones[node.replace(/[._]/g, '')];
      for (const k in bones) { if (!b && k.endsWith(norm(node))) { /* fallback */ } }
      const target = b || Object.values(bones).find((x) => x.name.replace(/[._]/g, '').endsWith(norm(node)));
      if (target) t.name = target.name + t.name.slice(dot);
    }
    const hipsBone = Object.values(bones).find((x) => /hips$/i.test(x.name.replace(/[._]/g, '')));
    const restY = hipsBone ? hipsBone.position.y : 0.8;
    for (const t of clip.tracks) {
      if (!/\.position$/.test(t.name)) continue;
      let f = 0.01;
      if (/hips/i.test(t.name) && t.values.length > 3) {
        let ys = 0, cnt = 0;
        for (let k = 1; k < t.values.length; k += 3) { ys += t.values[k]; cnt++; }
        const y0 = (ys / cnt) * 0.01;
        if (y0 > 0.05) f = 0.01 * (restY / y0);
      }
      for (let i = 0; i < t.values.length; i++) t.values[i] *= f;
      if (/hips/i.test(t.name) && t.values.length > 3) {
        const ys = [];
        for (let k = 1; k < t.values.length; k += 3) ys.push(t.values[k]);
        ys.sort((a, b) => a - b);
        const anchor = ys[Math.floor(ys.length * 0.15)];
        for (let k = 1; k < t.values.length; k += 3) t.values[k] += restY - anchor;
      }
      if (/hips/i.test(t.name) && !keepMotion) {
        const bx = hipsBone ? hipsBone.position.x : 0;
        const bz = hipsBone ? hipsBone.position.z : 0;
        for (let i = 0; i + 2 < t.values.length; i += 3) { t.values[i] = bx; t.values[i + 2] = bz; }
      }
    }
    return clip;
  };
  // idle walk comes from the tiny baked container now. these five raw FBX loads — one of them
  // 34MB — used to download and parse in the middle of the walk: that was the stutter.
  loadStepClip('./models/clips/happywalk.stpc', 'HappyWalk').then((clip) => {
    const hb = clip.tracks.find((t) => /Hips\.position$/.test(t.name));
    if (hb) for (let i = 0; i + 2 < hb.values.length; i += 3) { hb.values[i] = 0; hb.values[i + 2] = 0; }
    acts.MxHappyWalk = mixer.clipAction(clip);
    acts.MxHappyWalk.timeScale = clip.duration / (2 * BEAT);
    const wp = pulsesOf(clip);
    chr.walkfx = wp && wp.steps >= 2 ? wp.fp + clip.duration / 4 : 0;
    if (chr.walk === acts.Walk) {
      const prev = chr.cur;
      chr.walk = acts.MxHappyWalk;
      if (prev && prev !== chr.walk) {
        chr.walk.reset().setEffectiveWeight(1).play();
        const ph = ((songPhase() % 2) + 2) % 2;
        chr.walk.time = (ph / 2) * clip.duration / Math.max(chr.walk.timeScale, 1e-4);
        chr.walk.crossFadeFrom(prev, 0.35, false);
        chr.cur = chr.walk;
      }
    }
  });
}

const CHOREO = {
  Walk: { beats: 2,
    Lth:[0,0.55, 1,-0.5, 2,0.55], Rth:[0,-0.5, 1,0.55, 2,-0.5],
    Lkn:[0,0.15, 0.5,0.2, 1,0.5, 1.5,0.65, 2,0.15], Rkn:[0,0.5, 0.5,0.65, 1,0.15, 1.5,0.2, 2,0.5],
    hop:[0,0, 0.5,0.3, 1,0, 1.5,0.3, 2,0] },
  Skip: { beats: 2,
    Lth:[0,0.42, 0.5,-0.3, 1,0.4, 1.5,-0.1, 2,0.42], Rth:[0,-0.3, 0.5,0.1, 1,-0.3, 1.5,0.45, 2,-0.3],
    Lkn:[0,0.15, 0.25,0.55, 0.75,0.1, 1.25,0.55, 1.75,0.1, 2,0.15], Rkn:[0,0.5, 0.5,0.1, 1,0.5, 1.5,0.4, 2,0.5],
    hop:[0,0, 0.5,0.9, 1,0.05, 1.5,0.9, 2,0],
    armL:[0,-0.45, 0.5,0.5, 1,-0.45, 1.5,0.5, 2,-0.45], armR:[0,0.45, 0.5,-0.5, 1,0.45, 1.5,-0.5, 2,0.45],
    foreL:[0,0.25, 0.5,0.95, 1,0.25, 1.5,0.95, 2,0.25], foreR:[0,0.25, 0.5,0.95, 1,0.25, 1.5,0.95, 2,0.25],
    ftL:[0,0.15, 0.25,-0.5, 0.75,0.2, 1,0.15, 1.25,-0.5, 1.75,0.2, 2,0.15],
    ftR:[0,-0.5, 0.25,0.2, 0.5,0.15, 0.75,-0.5, 1.25,0.2, 1.5,0.15, 1.75,-0.5, 2,-0.5],
    hipP:[0,0, 0.5,-0.05, 1,0.01, 1.5,-0.05, 2,0] },
  Gallop: { beats: 2,
    Lth:[0,0.45, 2,0.45], Rth:[0,-0.15, 0.3,0.4, 0.7,-0.2, 1,-0.15, 1.3,0.4, 1.7,-0.2, 2,-0.15],
    Lkn:[0,0.25, 2,0.25], Rkn:[0,0.45, 0.3,0.15, 0.7,0.5, 1.15,0.45, 1.45,0.15, 1.85,0.5, 2,0.45],
    hop:[0,0.15, 0.45,0.95, 0.85,0.1, 1.45,0.95, 1.85,0.15, 2,0.15] },
  Chasse: { beats: 2,
    Lth:[0,0.5, 0.9,0.15, 1.4,-0.25, 2,0.5], Rth:[0,-0.5, 0.9,-0.15, 1.4,0.3, 2,-0.5],
    Lkn:[0,0.15, 1.15,0.45, 1.65,0.12, 2,0.15], Rkn:[0,0.15, 1.15,0.4, 1.65,0.12, 2,0.15],
    hop:[0,0, 0.5,0.15, 1,0.05, 1.5,0.15, 2,0] },
  KickBall: { beats: 2,
    Lth:[0,0.1, 0.25,1.1, 0.5,0.95, 0.75,0.25, 1.25,-0.15, 2,0.1], Rth:[0,-0.1, 0.5,-0.15, 1,-0.4, 1.5,-0.2, 2,-0.1],
    Lkn:[0,0.2, 0.25,0.05, 0.5,0.1, 0.75,0.4, 1.5,0.15, 2,0.2], Rkn:[0,0.25, 0.5,0.3, 1,0.6, 1.5,0.3, 2,0.25],
    hop:[0,0, 0.5,0.1, 1,0.15, 1.5,0.05, 2,0] },
  Running: { beats: 2,
    Lth:[0,0.55, 0.5,-0.25, 1,0.55, 1.5,-0.25, 2,0.55], Rth:[0,-0.25, 0.5,0.55, 1,-0.25, 1.5,0.55, 2,-0.25],
    Lkn:[0,0.6, 0.5,0.2, 1,0.6, 1.5,0.2, 2,0.6], Rkn:[0,0.2, 0.5,0.6, 1,0.2, 1.5,0.6, 2,0.2],
    hop:[0,0.05, 0.5,0.25, 1,0.05, 1.5,0.25, 2,0.05] },
  ChasseTurn: { beats: 2,
    Lth:[0,0.5, 0.9,0.15, 1.4,-0.25, 2,0.5], Rth:[0,-0.5, 0.9,-0.15, 1.4,0.3, 2,-0.5],
    Lkn:[0,0.15, 1.15,0.45, 1.65,0.12, 2,0.15], Rkn:[0,0.15, 1.15,0.4, 1.65,0.12, 2,0.15],
    hop:[0,0, 0.5,0.15, 1,0.1, 1.5,0.2, 2,0],
    yaw:[0,0, 1,0.3, 1.5,3.3, 2,6.28],
    armL:[0,1.05, 0.9,1.25, 1.4,1.05, 2,1.05], armR:[0,-0.25, 1,-0.45, 2,-0.25],
    foreL:[0,0.15, 2,0.15], foreR:[0,0.5, 1,0.95, 1.4,0.5, 2,0.5],
    ftRL:[0,0, 0.9,0, 1.15,0.3, 1.6,-0.18, 2,0],
    ftRR:[0,0, 0.9,0, 1.15,-0.3, 1.6,0.18, 2,0],
    ftL:[0,0.2, 1.15,-0.4, 1.6,0.25, 2,0.2], ftR:[0,0.2, 1.15,0.4, 1.6,-0.25, 2,0.2],
    hipR:[0,0, 1.15,0.05, 1.6,-0.03, 2,0] },
  Grapevine: { beats: 4,
    Lth:[0,0.3, 1,0.1, 2,0.65, 3,0.15, 4,0.3], Rth:[0,-0.15, 1,-0.55, 2,-0.1, 3,-0.6, 4,-0.15],
    Lkn:[0,0.15, 1,0.35, 2,0.5, 3,0.2, 4,0.15], Rkn:[0,0.2, 1,0.45, 2,0.2, 3,0.55, 4,0.2],
    hop:[0,0, 0.5,0.12, 1.5,0.12, 2.5,0.12, 3.5,0.12, 4,0],
    yaw:[0,0.5, 4,0.5] },
  IrishHop: { beats: 2,
    Lth:[0,0.18, 0.5,0.28, 1,0.18, 1.5,0.28, 2,0.18], Rth:[0,0.28, 0.5,0.18, 1,0.28, 1.5,0.18, 2,0.28],
    Lkn:[0,0.12, 0.25,0.42, 0.5,0.12, 0.75,0.42, 1,0.12, 1.25,0.42, 1.5,0.12, 1.75,0.42, 2,0.12],
    Rkn:[0,0.42, 0.25,0.12, 0.5,0.42, 0.75,0.12, 1,0.42, 1.25,0.12, 1.5,0.42, 1.75,0.12, 2,0.42],
    hop:[0,0, 0.25,0.5, 0.5,0.05, 0.75,0.5, 1,0.05, 1.25,0.5, 1.5,0.05, 1.75,0.5, 2,0],
    armL:[0,-0.1, 0.25,-1.05, 0.5,-0.1, 0.75,-1.05, 1,-0.1, 1.25,-1.05, 1.5,-0.1, 1.75,-1.05, 2,-0.1],
    armR:[0,-0.1, 0.25,-1.05, 0.5,-0.1, 0.75,-1.05, 1,-0.1, 1.25,-1.05, 1.5,-0.1, 1.75,-1.05, 2,-0.1],
    foreL:[0,0.3, 0.25,1.45, 0.5,0.3, 0.75,1.45, 1,0.3, 1.25,1.45, 1.5,0.3, 1.75,1.45, 2,0.3],
    foreR:[0,0.3, 0.25,1.45, 0.5,0.3, 0.75,1.45, 1,0.3, 1.25,1.45, 1.5,0.3, 1.75,1.45, 2,0.3],
    ftL:[0,0.35, 0.25,-0.55, 0.5,0.4, 0.75,-0.55, 1,0.4, 1.25,-0.55, 1.5,0.4, 1.75,-0.55, 2,0.4],
    ftR:[0,-0.55, 0.5,0.4, 0.75,-0.55, 1,0.4, 1.25,-0.55, 1.5,0.4, 1.75,-0.55, 2,0.4],
    hipP:[0,0, 0.25,-0.045, 0.75,-0.045, 1.25,-0.045, 1.75,-0.045, 2,0] },
  JetDash: { beats: 3, // Morph's F: a beat of stillness, then the jet takes off upright.
    // no crouch, head stays level through launch and landing; the flight itself
    // (lift, spin, lean, push) rides on the model root
    hop:[0,0, 3,0],
    Lth:[0,0.15, 0.5,0.15, 0.75,-0.6, 1.3,-0.7, 1.7,0.1, 2.0,0.4, 2.3,0.15, 3,0.15],
    Rth:[0,-0.15, 0.5,-0.15, 0.75,0.5, 1.3,0.45, 1.7,-0.05, 2.0,-0.4, 2.3,-0.15, 3,-0.15],
    Lkn:[0,0.2, 0.75,1.05, 1.3,1.1, 1.7,0.3, 2.0,0.65, 2.3,0.25, 3,0.2],
    Rkn:[0,0.2, 0.75,1.0, 1.3,1.05, 1.7,0.3, 2.0,0.6, 2.3,0.25, 3,0.2],
    armL:[0,0, 0.5,0, 0.75,-1.3, 1.4,-1.4, 1.9,-0.5, 2.3,-0.1, 3,0],
    armR:[0,0, 0.5,0, 0.75,-1.3, 1.4,-1.4, 1.9,-0.5, 2.3,-0.1, 3,0],
    foreL:[0,0.2, 0.75,0.5, 1.5,0.45, 2.2,0.25, 3,0.2],
    foreR:[0,0.2, 0.75,0.5, 1.5,0.45, 2.2,0.25, 3,0.2],
    ftL:[0,0.15, 0.75,-0.85, 1.5,-0.75, 2.0,0.15, 3,0.15],
    ftR:[0,0.15, 0.75,-0.85, 1.5,-0.75, 2.0,0.15, 3,0.15] },
  FacePlant: { beats: 4, // Morph's D: slow stumble, lazier face-plant (no ground clipping),
    // a beat of lying in pieces, then an unhurried get-up
    // before the topple: two flustered little steps on one leg (the trip)
    hop:[0,0, 0.16,0.5, 0.32,0, 0.52,0.6, 0.7,0, 2.9,0, 3.3,-0.4, 3.7,0, 4,0],
    Lth:[0,0.15, 0.2,0.05, 0.45,0.2, 0.7,0.1, 0.95,-0.45, 1.4,-0.75, 2.2,-0.35, 2.6,0.2, 3.0,0.3, 3.4,0.1, 4,0.15],
    Rth:[0,-0.15, 0.16,0.4, 0.34,-0.35, 0.55,0.45, 0.75,-0.3, 1.0,0.5, 1.4,0.65, 2.2,0.2, 2.6,-0.15, 3.0,-0.25, 3.4,-0.08, 4,-0.15],
    Lkn:[0,0.2, 0.5,0.3, 0.9,0.5, 1.5,0.6, 2.3,0.4, 3.0,0.7, 3.4,0.3, 4,0.2],
    Rkn:[0,0.2, 0.18,0.7, 0.36,0.25, 0.56,0.8, 0.76,0.3, 1.0,0.55, 1.5,0.6, 2.3,0.4, 3.0,0.65, 3.4,0.28, 4,0.2],
    // arms fling forward and straight, leading the fall — not tucked to the chest
    // bone-hunt: the swing keys drove the FINGER-claw bones to −23 cm (the
    // rig's arm axis turns 'forward' into a backward-down arc on this model).
    // Arms now stay close with elbows bent; nothing points down during the fall
    armL:[0,0, 0.4,0.15, 0.8,0.3, 1.4,0.3, 2.2,0.2, 2.9,0.08, 3.4,0, 4,0],
    armR:[0,0, 0.4,0.12, 0.8,0.28, 1.4,0.3, 2.2,0.18, 2.9,0.06, 3.4,0, 4,0],
    foreL:[0,0.3, 0.8,0.8, 1.5,1.0, 2.4,0.7, 3.2,0.3, 4,0.25],
    foreR:[0,0.3, 0.8,0.8, 1.5,1.05, 2.4,0.65, 3.2,0.3, 4,0.25],
    ftL:[0,0.15, 0.95,-0.5, 1.6,-0.4, 2.4,0.15, 3.2,0.1, 4,0.15],
    ftR:[0,0.15, 0.95,-0.5, 1.6,-0.4, 2.4,0.15, 3.2,0.1, 4,0.15],
    hipR:[0,0, 0.5,0.08, 1.0,-0.06, 1.6,0.03, 2.2,0, 4,0] },
  Polka: { beats: 2,
    Lth:[0,0.5, 0.5,0.2, 1,0.45, 1.5,0], Rth:[0,-0.2, 0.5,0.42, 1,-0.2, 1.5,0.4],
    Lkn:[0,0.45, 0.5,0.1, 1,0.45, 1.5,0.15], Rkn:[0,0.15, 0.5,0.5, 1,0.15, 1.5,0.5],
    hop:[0,0, 0.35,0.85, 0.7,0.1, 1.35,0.85, 1.7,0.1, 2,0] },
  Box: { beats: 3,
    Lth:[0,0.45, 1,0.1, 1.5,-0.15, 2,0.35, 2.5,-0.1, 3,0.45], Rth:[0,-0.2, 0.5,-0.5, 1,-0.15, 1.5,0.4, 2,-0.1, 2.5,-0.35, 3,-0.2],
    Lkn:[0,0.2, 1,0.35, 1.5,0.15, 2.5,0.3, 3,0.2], Rkn:[0,0.2, 1,0.4, 1.5,0.15, 2.5,0.35, 3,0.2],
    hop:[0,0, 0.66,0.2, 1.33,0.05, 2,0.2, 2.66,0.05, 3,0],
    armL:[0,-0.1, 0.5,-1.25, 1,-0.15, 1.5,-0.05, 2,-1.25, 2.5,-0.15, 3,-0.1],
    armR:[0,-0.15, 0.5,-0.05, 1,-1.25, 1.5,-0.15, 2,-0.05, 2.5,-1.25, 3,-0.15],
    foreL:[0,0.5, 0.5,0.12, 1,0.45, 1.5,0.5, 2,0.12, 2.5,0.45, 3,0.5],
    foreR:[0,0.45, 0.5,0.5, 1,0.12, 1.5,0.45, 2,0.5, 2.5,0.12, 3,0.45],
    ftL:[0,0.35, 0.5,-0.55, 1,0.3, 1.5,0.35, 2,-0.55, 2.5,0.3, 3,0.35],
    ftR:[0,0.3, 0.5,0.35, 1,-0.55, 1.5,0.3, 2,0.35, 2.5,-0.55, 3,0.3],
    hipP:[0,0, 0.66,-0.04, 1.33,0.015, 2,-0.04, 2.66,0.015, 3,0] },
};
const RIG_ROBOT = { hips: 'Hips', th: ['UpperLeg_L', 'UpperLeg_R'], kn: ['LowerLeg_L', 'LowerLeg_R'],
  thAxis: [0, 0, 1], knAxis: [1, 0, 0], thSign: 1, knSign: 1, yawAxis: [0, 1, 0],
  ft: ['Foot_L', 'Foot_R'], ftAxis: [1, 0, 0], ftKn: -1.15, ftTh: -0.35,
  arm: ['UpperArm_L', 'UpperArm_R'], fore: ['LowerArm_L', 'LowerArm_R'],
    armDown: [0.05, 0.05], armAxis: [1, 0, 0], swingAxis: [1, 0, 0], swingAmt: 0.42, foreBend: 0.15,
  ftRollAxis: [0, 0, 1] };
const RIG_UE4 = { hips: 'pelvis', th: ['thigh_l', 'thigh_r'], kn: ['calf_l', 'calf_r'],
  thAxis: [1, 0, 0], knAxis: [1, 0, 0], thSign: 1, knSign: 1, yawAxis: [1, 0, 0] };
const RIG_MIX = { hips: 'Hips', th: ['LeftUpLeg', 'RightUpLeg'], kn: ['LeftLeg', 'RightLeg'],
  thAxis: [1, 0, 0], knAxis: [1, 0, 0], thSign: 1, knSign: 1, yawAxis: [0, 1, 0],
  arm: ['LeftArm', 'RightArm'], fore: ['LeftForeArm', 'RightForeArm'],
  armDown: [1.25, -1.25], armAxis: [0, 0, 1], swingAxis: [0, 0, 1], swingAmt: 0.45, foreBend: 0.12 };
function buildStepClips(mixer, root, acts, rig, hopY) {
  const bones = {};
  root.traverse((o) => { if (o.name) bones[o.name.replace(/[._]/g, '')] = o; });
  const gbone = (n) => {
    const key = n.replace(/[._]/g, '');
    if (bones[key]) return bones[key];
    for (const k in bones) if (k.length > key.length && k.endsWith(key)) return bones[k];
    return bones[key];
  };
  const HOP_Y = hopY || 0.055;
  for (const [nm, c] of Object.entries(CHOREO)) {
    const dur = c.beats * BEAT, n = Math.round(dur * 24) + 1;
    const times = new Float32Array(n);
    const hips = gbone(rig.hips);
    const hq = new Float32Array(n * 4), hp = new Float32Array(n * 3);
    const tracks = [];
    const boneTracks = {};
    for (const k of ['Lth','Rth','Lkn','Rkn']) {
      const side = k[1] === 't' ? '' : '';
      const boneName = k === 'Lth' ? rig.th[0] : k === 'Rth' ? rig.th[1] : k === 'Lkn' ? rig.kn[0] : rig.kn[1];
      boneTracks[k] = { b: gbone(boneName), q: new Float32Array(n * 4), keys: c[k] };
    }
    const ftTracks = {};
    const ftAxisV = new THREE.Vector3(...(rig.ftAxis || rig.knAxis));
    if (rig.ft) {
      ftTracks.Lft = { b: gbone(rig.ft[0]), q: new Float32Array(n * 4) };
      ftTracks.Rft = { b: gbone(rig.ft[1]), q: new Float32Array(n * 4) };
    }
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * c.beats;
      times[i] = i / (n - 1) * dur;
      const lin = (keys, tt) => {
        if (tt <= keys[0]) return keys[1];
        for (let j = 0; j + 3 < keys.length; j += 2) {
          if (tt >= keys[j] && tt <= keys[j+2]) {
            let u = (tt - keys[j]) / (keys[j+2] - keys[j]);
            u = u * u * (3 - 2 * u); // ease: kill the linear-snap stiffness
            return keys[j+1] + (keys[j+3] - keys[j+1]) * u;
          }
        }
        return keys[keys.length-1];
      };
      const hy = hips.position.y + HOP_Y * lin(c.hop, t);
      hp[i*3] = hips.position.x; hp[i*3+1] = hy; hp[i*3+2] = hips.position.z;
      const yawArr = c.yaw;
      let hqQ = yawArr
        ? hips.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...rig.yawAxis), lin(yawArr, t)))
        : hips.quaternion.clone();
      if (c.hipP) hqQ = hqQ.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), lin(c.hipP, t)));
      if (c.hipR) hqQ = hqQ.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), lin(c.hipR, t)));
      hq[i*4] = hqQ.x; hq[i*4+1] = hqQ.y; hq[i*4+2] = hqQ.z; hq[i*4+3] = hqQ.w;
      for (const key of Object.keys(boneTracks)) {
        const bt = boneTracks[key];
        const isKn = key === 'Lkn' || key === 'Rkn';
        const axis = new THREE.Vector3(...(isKn ? rig.knAxis : rig.thAxis));
        const ang = lin(bt.keys, t) * (isKn ? rig.knSign : rig.thSign);
        const q = bt.b.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(axis, ang));
        bt.q[i*4] = q.x; bt.q[i*4+1] = q.y; bt.q[i*4+2] = q.z; bt.q[i*4+3] = q.w;
      }
      if (rig.ft) {
        // ankle compensation: cancel most of the knee/thigh rotation so the
        // planted foot stays flat and the swinging foot stays level — no more
        // "leg floats up while the foot is glued to the road"
        const pairs = [['Lft','Lkn','Lth','ftL','ftRL'], ['Rft','Rkn','Rth','ftR','ftRR']];
        const rollAx = new THREE.Vector3(...(rig.ftRollAxis || rig.thAxis));
        for (const [fk, lk, tk, pk, rk] of pairs) {
          const bt = ftTracks[fk];
          const a = -(lin(boneTracks[lk].keys, t) * rig.knSign * rig.ftKn
                      + lin(boneTracks[tk].keys, t) * rig.thSign * rig.ftTh)
                    + (c[pk] ? lin(c[pk], t) : 0); // toe flick / stamp accent
          let q = bt.b.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(ftAxisV, a));
          if (c[rk]) q = q.multiply(new THREE.Quaternion().setFromAxisAngle(rollAx, lin(c[rk], t)));
          bt.q[i*4] = q.x; bt.q[i*4+1] = q.y; bt.q[i*4+2] = q.z; bt.q[i*4+3] = q.w;
        }
      }
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(hips.name + '.quaternion', times, hq));
    tracks.push(new THREE.VectorKeyframeTrack(hips.name + '.position', times, hp));
    for (const key of Object.keys(boneTracks)) {
      const bt = boneTracks[key];
      tracks.push(new THREE.QuaternionKeyframeTrack(bt.b.name + '.quaternion', times, bt.q));
    }
    for (const fk of Object.keys(ftTracks)) {
      const bt = ftTracks[fk];
      if (bt.b) tracks.push(new THREE.QuaternionKeyframeTrack(bt.b.name + '.quaternion', times, bt.q));
    }
    if (rig.arm) {
      const armB = [gbone(rig.arm[0]), gbone(rig.arm[1]), gbone(rig.fore[0]), gbone(rig.fore[1])];
      const qbuf = armB.map(() => new Float32Array(n * 4));
      const hasArmCh = c.armL || c.armR;
      const linA = (keys, tt) => {
        if (!keys) return 0;
        if (tt <= keys[0]) return keys[1];
        for (let j = 0; j + 3 < keys.length; j += 2) {
          if (tt >= keys[j] && tt <= keys[j+2]) {
            let u = (tt - keys[j]) / (keys[j+2] - keys[j]);
            u = u * u * (3 - 2 * u);
            return keys[j+1] + (keys[j+3] - keys[j+1]) * u;
          }
        }
        return keys[keys.length-1];
      };
      for (let i = 0; i < n; i++) {
        const t = (i / (n - 1)) * c.beats;
        const sw = hasArmCh ? 0 : Math.cos(2 * Math.PI * t / c.beats) * rig.swingAmt;
        const dl = hasArmCh ? linA(c.armL, t) : 0;
        const dr = hasArmCh ? linA(c.armR, t) : 0;
        const fl = c.foreL ? linA(c.foreL, t) : rig.foreBend + sw * 0.5;
        const fr = c.foreR ? linA(c.foreR, t) : rig.foreBend - sw * 0.5;
        const aq = [
          armB[0].quaternion.clone()
            .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...rig.armAxis), rig.armDown[0] + dl))
            .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...rig.swingAxis), sw)),
          armB[1].quaternion.clone()
            .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...rig.armAxis), rig.armDown[1] + dr))
            .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...rig.swingAxis), -sw)),
          armB[2].quaternion.clone()
            .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...rig.armAxis), fl)),
          armB[3].quaternion.clone()
            .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...rig.armAxis), -fr)),
        ];
        for (let b = 0; b < 4; b++) {
          qbuf[b][i*4] = aq[b].x; qbuf[b][i*4+1] = aq[b].y; qbuf[b][i*4+2] = aq[b].z; qbuf[b][i*4+3] = aq[b].w;
        }
      }
      for (let b = 0; b < 4; b++)
        tracks.push(new THREE.QuaternionKeyframeTrack(armB[b].name + '.quaternion', times, qbuf[b]));
    }
    const clip = new THREE.AnimationClip(nm, dur, tracks);
    acts[nm] = mixer.clipAction(clip);

  }
}

// ---- pose ----
function neutralPose() {
  return { thighL: 0, thighR: 0, shinL: 0, shinR: 0, armL: 0, armR: 0, elbowL: -0.12, elbowR: -0.12,
    torsoLean: 0.03, hipBob: 0, roll: 0, bodyYaw: 0, bodyY: 0, bodyX: 0 };
}
function walkPose(phase) {
  const p = neutralPose();
  const w = Math.PI * phase; // full L+R cycle = 2 beats: one step per beat
  const c = Math.cos(w);
  p.thighL = -0.46 * c;
  p.thighR = 0.46 * c;
  p.shinL = Math.max(0, Math.sin(-w + 0.9)) * 0.95;
  p.shinR = Math.max(0, Math.sin(-w + 0.9 + Math.PI)) * 0.95;
  p.armL = 0.4 * c;
  p.armR = -0.4 * c;
  p.elbowL = -0.2 - 0.22 * Math.max(0, Math.sin(-w + 0.9));
  p.elbowR = -0.2 - 0.22 * Math.max(0, Math.sin(-w + 0.9 + Math.PI));
  p.hipBob = 0.028 * Math.abs(Math.sin(w)) - 0.012;
  p.roll = 0.045 * c;
  p.torsoLean = 0.06;
  return p;
}
function idlePose(t) {
  const p = neutralPose();
  p.hipBob = 0.012 * Math.sin(t * 2.2);
  p.torsoLean = 0.02 + 0.01 * Math.sin(t * 2.2);
  return p;
}
// ---- steps (キーで出すステップ) ----
const STEPNAMES = ['SKIP', 'GALLOP', 'CHASSE', 'POLKA', 'KICK-BALL', 'RUNNING', 'BOX', 'TURN', 'GRAPEVINE', 'IRISH'];
const BOYSTEPNAMES = ['MOONWALK', 'BREAKDANCE UPROCK', 'BREAK UPROCK VAR2', 'BREAK UPROCK'];
const STEPS = [
  { dur: 1.25, fn(e) {
      const p = neutralPose(), t = e / 1.25;
      const k = Math.sin(Math.PI * Math.min(t * 1.5, 1));
      p.thighR = -1.5 * k; p.shinR = 0.12 * k;
      p.armL = -0.9 * k; p.armR = 0.5 * k; p.elbowL = -0.5 * k; p.elbowR = -0.7 * k;
      p.torsoLean = -0.12 * k; p.roll = 0.08 * k;
      return p;
    } },
  { dur: 2, fn(e) {
      const p = neutralPose(), t = e / 2;
      const s = t * t * (3 - 2 * t);
      p.bodyYaw = Math.PI * 2 * s;
      p.hipBob = -0.12 * Math.sin(Math.PI * t);
      p.armL = -1.1; p.armR = -1.1; p.elbowL = -0.6; p.elbowR = -0.6;
      p.thighL = 0.5 * Math.sin(Math.PI * t * 2); p.thighR = -0.5 * Math.sin(Math.PI * t * 2);
      return p;
    } },
  { dur: 2, fn(e) {
      const p = neutralPose(), t = e / 2;
      p.bodyX = 0.9 * Math.sin(Math.PI * t);
      p.hipBob = -0.3 * Math.sin(Math.PI * Math.min(t * 1.3, 1));
      p.thighL = -0.35 * Math.sin(Math.PI * t); p.thighR = 0.35 * Math.sin(Math.PI * t);
      p.shinL = 0.15 * Math.sin(Math.PI * t); p.shinR = 0.5 * Math.sin(Math.PI * t);
      p.roll = 0.22 * Math.sin(Math.PI * t); p.armL = -1.4; p.armR = 0.2; p.elbowL = -0.3; p.elbowR = -0.5;
      return p;
    } },
  { dur: 1.5, fn(e) {
      const p = neutralPose(), t = e / 1.5;
      if (t < 0.6) {
        const a = t / 0.6;
        p.bodyY = 0.36 * Math.sin(Math.PI * a);
        p.thighL = p.thighR = -0.85 * Math.sin(Math.PI * a);
        p.shinL = p.shinR = 1.15 * Math.sin(Math.PI * a);
        p.armL = p.armR = -1.3 * Math.sin(Math.PI * a); p.elbowL = p.elbowR = -0.9 * Math.sin(Math.PI * a);
      } else {
        const a = (t - 0.6) / 0.4;
        p.hipBob = -0.14 * Math.sin(Math.PI * a);
        p.thighL = p.thighR = -0.2 * Math.sin(Math.PI * a); p.shinL = p.shinR = 0.3 * Math.sin(Math.PI * a);
      }
      return p;
    } },
];
function blend(a, b, w) {
  const p = {};
  for (const k in a) p[k] = a[k] + (b[k] - a[k]) * w;
  return p;
}
function applyPose(p) {
  thighL.rotation.x = p.thighL; thighR.rotation.x = p.thighR;
  shinL.rotation.x = p.shinL; shinR.rotation.x = p.shinR;
  armL.rotation.x = p.armL; armR.rotation.x = p.armR;
  foreL.rotation.x = p.elbowL; foreR.rotation.x = p.elbowR;
  torso.rotation.x = p.torsoLean;
  hips.position.y = 0.92 + p.hipBob;
  hips.rotation.z = p.roll;
  body.rotation.y = p.bodyYaw;
  body.position.set(p.bodyX, p.bodyY, 0);
}

// ---- sparks on step ----
const sparks = [];
const sparkGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
function spawnSparks() {
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: pal.light ?? 0xffffff }));
    m.position.set(player.position.x + (Math.random() - 0.5) * 0.3, 0.1, player.position.z + (Math.random() - 0.5) * 0.3);
    m.userData = { v: new THREE.Vector3((Math.random() - 0.5) * 2, 1.5 + Math.random() * 2.5, (Math.random() - 0.5) * 2), life: 0.7 };
    scene.add(m); sparks.push(m);
  }
}
function updateSparks(dt) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.userData.life -= dt;
    if (s.userData.life <= 0) { scene.remove(s); sparks.splice(i, 1); continue; }
    s.userData.v.y -= 6 * dt;
    s.position.addScaledVector(s.userData.v, dt);
    s.material.opacity = s.userData.life; s.material.transparent = true;
  }
}

// ============ audio (Web Audio clock = 唯一のタイミング) ============
let ctx = null, master, songStart = 0, started = false, starting = false, audioOk = false, wallStart = 0, nextSlot = 0, schedTimer = null;
const KICK = [0, 6, 8, 14], SNARE = [4, 12], OPEN = [3, 7, 11, 15];
const ROOTS = [110, 87.31, 98, 82.41];            // Am - F - G - Em
const BASSLINE = [0, 0, 12, 10, 7, 7, 3, 0];
const CHORD = [[0, 3, 7], [0, 4, 7], [0, 4, 7], [0, 3, 7]];
function slotTime(i) {
  const bar = Math.floor(i / 16), s = i % 16;
  return songStart + (bar * 4 + s * 0.25 + (s % 2 ? CONFIG.swing : 0)) * BEAT;
}
let noiseBuf = null;
function makeNoise() {
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}
function env(g, t, peak, dur) {
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
}
function kick(t) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
  env(g, t, 0.95, 0.28); o.connect(g).connect(master); o.start(t); o.stop(t + 0.3);
}
function snare(t) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.7;
  const g = ctx.createGain(); env(g, t, 0.42, 0.16);
  s.connect(f).connect(g).connect(master); s.start(t); s.stop(t + 0.2);
  const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 190;
  const g2 = ctx.createGain(); env(g2, t, 0.14, 0.08);
  o.connect(g2).connect(master); o.start(t); o.stop(t + 0.1);
}
function hat(t, open) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
  const g = ctx.createGain(); env(g, t, open ? 0.16 : 0.09, open ? 0.26 : 0.045);
  s.connect(f).connect(g).connect(master); s.start(t); s.stop(t + 0.3);
}
function bass(t, freq, dur) {
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320; f.Q.value = 5;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.001, t);
  g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  for (const det of [-5, 5]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = det;
    o.connect(f); o.start(t); o.stop(t + dur + 0.05);
  }
  f.connect(g).connect(master);
}
function pad(t, ch, dur) {
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 850;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.001, t);
  g.gain.linearRampToValueAtTime(0.05, t + 0.35);
  g.gain.linearRampToValueAtTime(0.001, t + dur);
  for (const semi of CHORD[ch]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.value = ROOTS[ch] * 4 * Math.pow(2, semi / 12);
    o.detune.value = (Math.random() - 0.5) * 8;
    o.connect(f); o.start(t); o.stop(t + dur + 0.1);
  }
  f.connect(g).connect(master);
}
function scheduleSlot(i) {
  const bar = Math.floor(i / 16), s = i % 16, t = slotTime(i), ch = bar % 4;
  if (KICK.includes(s)) kick(t);
  if (SNARE.includes(s)) snare(t);
  if (s % 2 === 0) hat(t, false); else if (OPEN.includes(s)) hat(t, true);
  if (s % 2 === 0) {
    const e = s / 2;
    bass(t, ROOTS[ch] * Math.pow(2, BASSLINE[e] / 12), BEAT * 0.42);
  }
  if (s === 0) pad(t, ch, BEAT * 4);
}
function scheduler() {
  while (slotTime(nextSlot) < ctx.currentTime + 0.16) { scheduleSlot(nextSlot); nextSlot++; }
}
function perfPhase() { return (pnow() - wallStart) / BEAT; } // pause-aware wall clock
function songPhase() {
  // iOS can park the context in suspended forever — the walk/animation clock
  // must keep running on wall time and only trust ctx once it's really running
  // while our own pause is on, nothing may drift anywhere: the wall clock
  // itself is frozen, so sway/feet/music-share one stopped time on every engine
  if (paused) return perfPhase();
  if (audioOk && ctx && ctx.state === 'running') return (ctx.currentTime - songStart) / BEAT;
  return perfPhase();
}

// ============ zone music loops (real tracks, beat-matched to the walk grid) ============
// bars 1..19 suburb, 20..63 mid, 64+ city. Loops are pre-baked seamless 8-bar,
// 100 BPM / same key per set. Section points are crossed mid-block on purpose:
// the switch waits for the next 8-bar block boundary, so the new track always
// starts clean at the head of a block, never in the middle of one.
// Side A: one full song across the whole stage. All zone slots name the same
// track; the scheduler detects that and never re-arms, so the song plays
// straight through from the stage start. Baked at exactly 100 BPM with the
// first beat trimmed to t=0, so its grid is the walk grid.
// ============ music: ONE source, looped at the exact bar boundary ============
// Side A is baked at 100 BPM with the first beat at t=0 and cut so that 240.0 s
// is exactly 100 bars; a 3-second crossfade is baked into the file itself, so
// the buffer's own loop seam IS the musical seam. The old design stopped the
// source at every pass and re-armed a fresh one, re-anchoring clocks as it went
// — every re-arm was a chance to drop a beat, leak a second song, or rewind a
// clock that must only run forward. Third and fourth laps kept proving it.
// One looping source has no seams to fall into: after start, nothing touches it.
const SONG_FILE = 'step-sideA';
// 64 bars = 153.6 s: the CORRECT take (the lo-fi song at true 100 BPM).
// the file that played until now was the extended chain built on top of it,
// which carried a second, half-taken pass inside one "song" — that is what
// kept starting pass three in the middle of pass two. this one ends when the
// song ends, then 1.5 s of air, then the head.
// crossfades were tried at the seam and every one of them started the NEXT
// pass inside the listener's current one. the file now simply ENDS: the outro
// fades to silence over its last seconds, the loop turns through clean air, and
// the quiet head walks back in. an ending you can hear is a pass you can count
let SONG_LOOP = 153.6;   // exactly 64 bars; buffer-domain loop end in seconds
let mus = { buf: null, src: null, gain: null };
function barNow() { return Math.max(1, Math.floor(songPhase() / 4) + 1); }
function stopSong(fade) {
  if (!mus.src) return;
  const g = mus.gain, s = mus.src; mus.src = null; mus.gain = null;
  try {
    const now = ctx.currentTime, f = fade || 0.01;
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(g.gain.value, now);
    g.gain.linearRampToValueAtTime(0, now + f);
    s.stop(now + f + 0.02);
  } catch (e) { try { s.stop(); } catch (e2) {} }
}
function playSong(from, fade) { // from = seconds into the song; fade = ramp time
  if (!audioOk || !ctx || !mus.buf) return;
  if (ctx.state !== 'running') { // resuming from pause is async: arm once the state actually lands
    try { ctx.resume().then(() => setTimeout(() => playSong(from, fade), 40)); } catch (e) {}
    return;
  }
  stopSong(0);
  const g = ctx.createGain(); g.gain.value = 0; g.connect(master);
  const s = ctx.createBufferSource(); s.buffer = mus.buf;
  s.loop = true; s.loopStart = 0; s.loopEnd = SONG_LOOP;
  s.connect(g);
  const t0 = ctx.currentTime + 0.03;
  s.start(t0, ((from % SONG_LOOP) + SONG_LOOP) % SONG_LOOP);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.92, t0 + (fade != null ? fade : 0.25));
  mus.src = s; mus.gain = g;
  songStart = t0 - from;  // (ctx.currentTime - songStart) is then seconds into the song
}
async function musicBoot() {
  try {
    const r = await fetch('./audio/' + SONG_FILE + '.mp3?v=M4');
    if (!r.ok) return;
    mus.buf = await ctx.decodeAudioData(await r.arrayBuffer());
    // guard for an older, untrimmed file: loop on a bar boundary, never mid-beat
    if (mus.buf.duration < SONG_LOOP - 0.5) SONG_LOOP = Math.floor(mus.buf.duration / (4 * BEAT)) * 4 * BEAT;
    if (started) playSong(0, 1.6);
  } catch (e) { /* walk in silence rather than die */ }
}

window.__checkWorld = () => {
  if (location.search.includes('map=1') && !window.__dumped && (window.__propDone || 0) >= (window.__propTot || 0) && window.__dumpPlaces) { window.__dumped = 1; window.__dumpPlaces(); }
  if (starting !== 'world' && !started) return;
  if (WANT_STAGE && Date.now() - (window.__sweptAt || 0) > 1500) { window.__sweptAt = Date.now(); // repeating sweep: trees that loaded before (or after) their building
      const blds = []; for (const g of bakedProps) if (g.userData.bld && g.visible !== false) { const bb = new THREE.Box3().setFromObject(g); if (bb.max.y > 2.5) blds.push(bb); }
      for (const g of bakedProps) { if (g.userData.bld || g.name === 'apron' || g.name === 'trainCar' || g.isInstancedMesh) continue; const bb = new THREE.Box3().setFromObject(g); if (bb.max.y - bb.min.y < 1.2) continue;
        for (const bx of blds) { if (!bx.intersectsBox(bb)) continue; const oX = Math.min(bx.max.x, bb.max.x) - Math.max(bx.min.x, bb.min.x); const oZ = Math.min(bx.max.z, bb.max.z) - Math.max(bx.min.z, bb.min.z); if (oX > 0.6 && oZ > 0.6) { g.visible = false; break; } } } }
  if (location.search.includes('dev=1')) { if ((window.__propDone || 0) >= (window.__propTot || 60)) dbg(''); else dbg('props ' + (window.__propDone || 0) + '/' + (window.__propTot || 60)); }
};
function dbg(msg) {
  if (!location.search.includes('dev=1')) return; // production screen stays clean
  let d = document.getElementById('st');
  if (!d) { d = document.createElement('div'); d.id = 'st';
    d.style.cssText = 'position:fixed;left:0;right:0;top:58%;text-align:center;color:#8a93a6;font:11px ui-monospace,monospace;z-index:12';
    document.body.appendChild(d); }
  d.textContent = msg;
}
async function begin() {
  if (starting) return;
  if (!STARTABLE) { dbg('loading ' + LOADDONE + '/' + LOADTOT + ' — wait for the bar'); return; }
  dbg('tap ok');
  await worldLaunch();
}
async function worldLaunch() {
  dbg('launch');
  setTimeout(() => { const d = document.getElementById('st'); if (d) d.textContent = ''; }, 3500);
  starting = true;
  if (!COARSE) { try { renderer.compile(scene, camera); } catch (e) {} }
  if (location.search.includes('dev=1')) { showErr('launch: gate ok'); 
    setTimeout(() => showErr('launch: frame alive, fps meter on'), 1200); }
  started = true;
  wallStart = performance.now() / 1000 + 0.1;
  document.getElementById('start').classList.add('hidden');
  charbar.classList.add('show');
  stepPad.classList.add('show');
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    // a 1-sample silent source is what actually wakes WebAudio on iOS; awaiting
    // resume() can hang forever there, so never block the groove on it
    const unlock = ctx.createBufferSource();
    unlock.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    unlock.connect(ctx.destination); unlock.start(0);
    ctx.resume().catch(() => {});
    const comp = ctx.createDynamicsCompressor();
    master = ctx.createGain(); master.gain.value = 0.55;
    master.connect(comp); comp.connect(ctx.destination);
    makeNoise();
    audioOk = true;
    songStart = ctx.currentTime + 0.12;
    nextSlot = 0;
    // stage mode plays Side A from the head: never arm the synth groove, so no
    // other music can play before the song's decode finishes
    if (!WANT_STAGE) schedTimer = setInterval(scheduler, 25);
    // iOS may not accept the unlock during the same handler that created the
    // context, so keep nudging on a timer until it comes up — the music then
    // starts at game start without needing any pad press
    let tries = 0;
    const wake = setInterval(() => {
      if (!ctx || ctx.state === 'running') return clearInterval(wake);
      const u = ctx.createBufferSource();
      u.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      u.connect(ctx.destination); u.start();
      ctx.resume();
      if (++tries > 60) clearInterval(wake);
    }, 250);
    ctx.onstatechange = () => {
      if (ctx.state !== 'running') return;
      if (!WANT_STAGE && !schedTimer) schedTimer = setInterval(scheduler, 25);
    };
    // one song file, one decode, one loop forever. no probe, no base64 variant,
    // no synth handover: those were earlier lives of this feature and only the
    // song path is used on the stage
    musicBoot().catch(() => {});
  } catch (e) { showErr('audio初期化失敗（映像は動きます）: ' + e); }
}

// ============ input ============
const KEYMAP = {
  KeyA: 0, KeyS: 1, KeyD: 2, KeyF: 3,
  ArrowLeft: 0, ArrowUp: 1, ArrowRight: 2, ArrowDown: 3,
};
const STOPSTEP = [false, true, true, true];
let activeStep = null, lastTrig = -9, stopAmt = 0, playerYaw = 0;
// Morph's jet dash carries real ground distance: an eased push along +z while it plays
// Morph's standing lift. Every writer must use this constant: the fall/jet
// root-motion used to end by writing y=0, which parked the soles 30 mm UNDER
// the road plane — the real "sinks after D/F" the user kept seeing.
const MORPH_LIFT = 0.055;
let jetRun = null; const JET_DIST = 3.0;
// one step state machine drives clip lifetime, facing and stopping
let step = null; // { i, end } in wall-clock seconds; null = plain walk
function stepDurSec(i) {
  const mx = (skel && skel.mixdur && skel.mixdur[i]) || 0;
  if (mx > 0) return mx;
  return ((STEPS[i] ? STEPS[i].dur : 2) * BEAT);
}
function flashStep(i) {
  hudFlash = (skel && skel.stepNames ? skel.stepNames[i] : STEPNAMES[i]); hudT = 0;
}
function triggerStep(i) {
  if (skel) {
    if (skel.stepNames && !skel.ready) return; // registered clips still loading
    if (!(skel.stepClips || [])[i]) return;
    const now = pnow();
    if (step && step.i === i && now < step.end) {
      step.end += stepDurSec(i);       // seamless loop continuation
      flashStep(i);
      return;
    }
    const stepClip = (skel.stepClips || [])[i] || skel.dance;
    if (!stepClip) return;
    step = { i, end: now + Math.max(0.4, stepDurSec(i)) };
    skelUse(stepClip, 0.12);
    if (skel.jetDash && i === 3) jetRun = { t0: now, d: Math.max(1.2, stepDurSec(i)), g: 0, mdl: (skel.m || null), kind: 'jet' };
    if (skel.facePlant && i === 2) jetRun = { t0: now, d: Math.max(1.2, stepDurSec(i)), g: 0, mdl: (skel.m || null), kind: 'fall' };
    // align the dance's own step pulses to the beat grid from the first step
    const fx = skel.mixfx && skel.mixfx[i];
    if (fx) {
      const ph0 = songPhase();
      const gap = (Math.ceil(ph0) - ph0) * BEAT; // real seconds to the next beat
      let tau = fx.fp - gap; // clip time at which to start so first pulse lands on a beat
      while (tau < 0) tau += fx.per;
      while (tau > fx.per) tau -= fx.per;
      stepClip.time = tau / Math.max(stepClip.timeScale, 1e-4);
    }
    spawnSparks();
    flashStep(i);
    return;
  }
  // no-skeleton fallback: procedural body steps
  const ph = songPhase();
  if (activeStep && ph - activeStep.startBeat < STEPS[activeStep.i].dur * 0.45) return;
  if (ph - lastTrig < 0.25) return;
  if (!STEPS[i]) return;
  activeStep = { i, startBeat: Math.ceil((ph + 0.12) / 0.25) * 0.25 };
  lastTrig = activeStep.startBeat;
  spawnSparks();
  flashStep(i);
}
function endStep(fade) {
  if (!step) return;
  step = null;
  if (skel && skel.walk) skelUse(skel.walk, fade);
}
window.addEventListener('keydown', (e) => {
  if (!started) { begin(); return; }
  if (e.code === 'KeyB') { e.preventDefault(); userPickedChar = true; swapChar(); return; }
  if (e.code === 'KeyW') { e.preventDefault(); if (step) endStep(0.15); return; }
  if (e.code === 'KeyR' && finishMode) { e.preventDefault(); resetStage(); return; } // plaza restart
  const i = KEYMAP[e.code];
  if (i !== undefined) { e.preventDefault(); triggerStep(i); }
});
window.addEventListener('touchend', () => { if (!started) begin(); }, { passive: true }); // older iOS: no pointer events
window.addEventListener('click', () => { if (!started) begin(); }); // last-resort fallback
let _tch = 0;
window.addEventListener('touchstart', () => {
  _tch++;
  const v = document.getElementById('ver');
  if (v) v.textContent = 'T:' + _tch;
}, { capture: true, passive: true });
// the pad/charbar stopPropagation, so the unlock retry must run in the CAPTURE
// phase — it fires before any target handler can swallow the event
function audioNudge() {
  if (!ctx || ctx.state === 'running') return;
  const u = ctx.createBufferSource();
  u.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  u.connect(ctx.destination); u.start();
  ctx.resume();
}
window.addEventListener('pointerdown', audioNudge, { capture: true });
window.addEventListener('touchstart', audioNudge, { capture: true, passive: true });

// ---- dev-only warp button (add ?dev=1 to the URL) ----
if (new URLSearchParams(location.search).has('dev')) {
  const wb = document.createElement('button');
  wb.id = 'warp'; wb.textContent = 'WARP →';
  wb.style.cssText = 'position:fixed;top:34px;right:12px;z-index:60;padding:6px 12px;border-radius:8px;' +
    'border:1px solid #ff3ec8;background:rgba(16,14,26,0.7);color:#ff9bdc;font:12px ui-monospace,monospace;cursor:pointer';
  document.body.appendChild(wb);
  wb.addEventListener('pointerdown', (e) => {
    e.stopPropagation(); e.preventDefault();
    if (!started) begin();
    player.position.z = FINISH - 50; // a short stroll from the plaza
  });
  // map scrubbers: step along the promenade in 25m hops, either way
  const mk = (id, label, sign) => {
    const b = document.createElement('button');
    b.id = id; b.textContent = label;
    b.style.cssText = 'position:fixed;top:34px;right:' + (sign > 0 ? 118 : 178) + 'px;z-index:60;padding:6px 10px;border-radius:8px;' +
      'border:1px solid #6ea8ff;background:rgba(16,14,26,0.7);color:#9cc3ff;font:12px ui-monospace,monospace;cursor:pointer';
    document.body.appendChild(b);
    let hold = null;
    const jump = () => {
      if (!started) { begin(); return; }
      finishMode = false;
      player.position.z = Math.max(-5, Math.min(FINISH + 20, player.position.z + sign * 25));
    };
    b.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); jump();
      hold = setInterval(jump, 450); });                      // hold to keep travelling
    const stop = () => { if (hold) { clearInterval(hold); hold = null; } };
    b.addEventListener('pointerup', stop); b.addEventListener('pointerleave', stop);
    b.addEventListener('pointercancel', stop);
    window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop);
  };
  mk('scrubB', '◀ 25m', -1);
  mk('scrubF', '25m ▶', +1);
  // dev minimap: top-down strip of the promenade with meter + bar labels; tap it to teleport there
  const mm = document.createElement('canvas');
  mm.width = 132; mm.height = 430;
  mm.style.cssText = 'position:fixed;left:8px;top:120px;z-index:60;background:rgba(8,10,18,0.8);' +
    'border:1px solid #3a4358;border-radius:8px;touch-action:none;opacity:0.92';
  document.body.appendChild(mm);
  const mc = mm.getContext('2d');
  const Z0 = () => Math.max(-10, Math.min(player.position.z - 18, STAGE_LEN - 130));
  const mmDraw = () => {
    const zTop = Z0(), sc = 410 / 130; // 130 m window
    mc.clearRect(0, 0, 132, 430);
    mc.fillStyle = '#20242e'; mc.fillRect(66 - 8 * sc, 0, 16 * sc, 410); // the road
    for (let zm = Math.ceil(zTop / 25) * 25; zm < zTop + 130; zm += 25) {
      const py = (zTop + 130 - zm) * sc;
      mc.strokeStyle = '#39414f'; mc.beginPath(); mc.moveTo(4, py); mc.lineTo(128, py); mc.stroke();
      mc.fillStyle = '#8fa3c0'; mc.font = '9px ui-monospace,monospace';
      mc.fillText('z' + zm + ' bar' + Math.round(zm / 2.48), 4, py - 3);
    }
    for (const e2 of (window.__bboxes || [])) { const bb = e2.b;
      if (bb.max.z < zTop || bb.min.z > zTop + 130) continue;
      mc.fillStyle = 'rgba(205,110,86,0.85)';
      mc.fillRect(66 - bb.max.x * sc, (zTop + 130 - bb.max.z) * sc, (bb.max.x - bb.min.x) * sc, (bb.max.z - bb.min.z) * sc);
      if (Math.abs((bb.min.z + bb.max.z) / 2 - player.position.z) < 30) { mc.fillStyle = '#e8d9a0'; mc.font = '7px ui-monospace,monospace';
        mc.fillText((e2.n || '').slice(0, 9), 66 - bb.max.x * sc, (zTop + 130 - bb.max.z) * sc - 1); }
    }
    const pz = player.position.z;
    mc.fillStyle = '#7ee787'; mc.beginPath(); mc.arc(66, (zTop + 130 - pz) * sc, 3.5, 0, 6.3); mc.fill();
    mc.fillStyle = '#cfd8e8'; mc.font = '10px ui-monospace,monospace';
    mc.fillText('player z' + Math.round(pz) + ' / bar' + Math.round(pz / 2.48), 6, 425);
  };
  setInterval(mmDraw, 350);
  mmDraw();
  mm.addEventListener('pointerdown', (e) => {
    e.stopPropagation(); e.preventDefault();
    if (!started) { begin(); return; }
    const r = mm.getBoundingClientRect();
    const z = Z0() + (e.clientY - r.top) / (410 / 130);
    finishMode = false;
    player.position.z = Math.max(-5, Math.min(FINISH + 20, z));
  });
}

// ---- the plaza RESTART sign: tap handling + stage reset ----
const _ray = new THREE.Raycaster(), _nd = new THREE.Vector2();
function resetStage() {
  if (paused) togglePause(); // a restart must unfreeze: playSong refuses to start a suspended context
  finishMode = false;
  if (jetRun && jetRun.mdl) { // a reset mid-fall/jet must not leave the body tilted or sunk
    jetRun.mdl.position.y = MORPH_LIFT;
    jetRun.mdl.rotation.set(0, 0, 0);
  }
  jetRun = null;
  endStep(0.2);
  player.position.set(WANT_STAGE ? RW - 0.7 : 0, 0, -5); // restart goes back to the stage's start
  playerYaw = 0; stopAmt = 0;
  wallStart = performance.now() / 1000 + 0.1;
  window.__lyrDone = 0; if (lyricBox) lyricBox.style.display = ''; // a restart gets its words back
  // the song goes back to the head with the stage: same source, restarted,
  // the loop mechanism untouched
  if (mus.buf) playSong(0, 1.6);
  hudFlash = 'GO'; hudT = 0;
}
window.addEventListener('pointerdown', (ev) => {
  if (!restartBtn || !restartBtn.visible) return;
  const r = renderer.domElement.getBoundingClientRect();
  _nd.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  _ray.setFromCamera(_nd, camera);
  if (_ray.intersectObject(restartBtn).length) resetStage();
}, { capture: true });
window.addEventListener('pointerdown', () => {
  if (!started) { begin(); return; }
  if (ctx && ctx.state !== 'running') {
    // iOS only lets a source start during a gesture; retry the silent nudge too
    const u = ctx.createBufferSource();
    u.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    u.connect(ctx.destination); u.start();
    ctx.resume();
  } // tab/app switch parks the context on both platforms
});
document.addEventListener('visibilitychange', () => { if (ctx && ctx.state !== 'running') ctx.resume(); });

// ============ diorama background layer (?bg=1) ============
let bgGroup = null;

// ============ loop ============
const hud = document.getElementById('hud');
// production: the diagnostic bar is gone; lyrics drift right-to-left on the music clock
const LYR = ("Late night, fans spinning low,|A brand-new checkpoint ready to go,|Qwen in the morning, DeepSeek at night,|Weights on the table, open and bright.|Quantized down to fit my RAM,|Q4, Q8, take it as you can,|Tokens per second climbing high,|Watch the numbers fly.|Every step you take,|Every model you make,|Every engine you tune,|I'll be cheering for you.|Every kernel you prune,|Every harness you build,|Every token you stream,|I'll be chasing your dream.|Every bench that you break,|Every risk that you take,|I'll be following you.|Strata's running, TensorFold's in,|MTPLX on a Mac Studio spin,|Built by hands in the dead of night,|Volunteers who code it right.|Apple silicon, NVIDIA green,|Doesn't matter what's on your screen,|Unified memory, CUDA core,|We all want the same thing more.|It's not a war, it's not a race,|Curious minds in every place,|No gate, no key, no cloud to own,|A spark of thought on a machine at home.|Every step you take,|Every model you make,|Every engine you tune,|I'll be cheering for you.|Every kernel you prune,|Every harness you build,|Every token you stream,|I'll be chasing your dream.|Every bench that you break,|Every risk that you take,|I'll be following you.|I'll be following you.|Free to learn, free to try,|Free to ask the reason why,|Every step you take,|I'll be following you.").split('|');
const LYRT = [10.66,12.84,15.1,17.66,20.1,22.5,24.82,26.68,28.36,31.04,32.86,36.18,38.36,40.84,43.36,45.8,48.14,49.76,52.98,57.58,59.38,61.56,64.22,66.5,68.26,70.7,73.76,75.78,78.54,80.88,82.88,95.6,97.82,100.88,102.9,105.7,107.36,109.58,112.74,114.76,116.9,120.2,123.46,129.26,133.94,138.52,148.52]; // measured voice onsets (s from song head)

// transport: pause/play + 8-bar rewind/fast-forward, top right (production)
let paused = false, pauseT0 = 0, pauseOff = 0;
const pnow = () => {
  const p = performance.now() / 1000;
  return paused ? pauseT0 - pauseOff : p - pauseOff; // frozen while paused, not just rebased after
};
function togglePause() {
  if (!started || !ctx) return;
  if (!paused) {
    paused = true; pauseT0 = performance.now() / 1000;
    ctx.suspend();
    tpause.textContent = '\u25b6';
  } else {
    paused = false;
    ctx.resume();
    pauseOff += performance.now() / 1000 - pauseT0;
    tpause.textContent = '\u275a\u275a';
  }
}
function seekSong(d) { // dev transport: move inside the same looping source
  if (!started || !ctx || !mus.buf) return;
  playSong(Math.max(0, (ctx.currentTime - songStart) + d), 0.05);
}
const tpause = document.getElementById('tpause');
const tback = document.getElementById('tback');
const tfwd = document.getElementById('tfwd');
tpause.onclick = togglePause;
// « » nudge the walk position on the map, the song keeps running untouched
const nudge = d => { if (started) player.position.z = Math.max(0, Math.min(FINISH + 9, player.position.z + d)); };
tback.onclick = () => nudge(-38);
tfwd.onclick = () => nudge(38);
if (location.search.includes('dev=1')) document.getElementById('transport').style.display = 'none';
const lyricBox = document.getElementById('lyric');
const MARKS = ['\u266a            \u266b                     \u266c','\u266b      \u266c            \u266a','\u266c            \u266a           \u266b','\u266a     \u266b           \u266c','\u266b            \u266c                  \u266a'];
const lyricCol = document.createElement('div');
// blank head uses nbsp rows: an empty <p> collapses to 0 height and breaks the row math.
for (const L of ['\u00A0', '\u00A0', '\u00A0'].concat(MARKS, LYR)) { const p = document.createElement('p'); p.textContent = L; lyricCol.appendChild(p); }
lyricBox.appendChild(lyricCol);
const lyricBar = document.createElement('div'); lyricBar.id = 'lyrbar';
document.body.appendChild(lyricBar);
let lyricOn = WANT_STAGE && !location.search.includes('dev=1');
if (!lyricOn) { lyricBox.style.display = 'none'; lyricBar.style.display = 'none'; }
else hud.style.display = 'none';
let lyricIdx = -1, lyricLH = 0;

let hudFlash = '', hudT = 0;
const camPos = new THREE.Vector3(0.3, 0.72, -1.9);
let prev = performance.now() / 1000;
// ============ the frame loop ============
function frame() {
  if (WANT_PERF) {
      const _p = performance.now(); const _d = _p - _pf.last; _pf.last = _p;
      _pf.n++; _pf.sum += _d; if (_d > _pf.worst) _pf.worst = _d;
      if (_p - _pf.t > 2000) {
        console.log('PERF t=' + (_p / 1000 | 0) + 's fps=' + (_pf.n * 1000 / _pf.sum).toFixed(1) + ' worst=' + _pf.worst.toFixed(0) + 'ms dc=' + renderer.info.render.calls + ' tri=' + renderer.info.render.triangles);
        _pf.n = 0; _pf.sum = 0; _pf.worst = 0; _pf.t = _p;
      }
    }
  requestAnimationFrame(frame);
  window.__frameT = performance.now();
  const now = pnow(), dt = Math.min(0.05, now - prev); prev = now;
  const z = player.position.z;
  if (restartBtn) {
    const show = WANT_STAGE && finishMode;
    if (restartBtn.visible !== show) restartBtn.visible = show;
    if (show) {
      // just above the dancer's head; phones sit lower and tighter so the sign can't clip the top bar
      restartBtn.position.set(player.position.x, COARSE ? 1.38 : 1.62, player.position.z + (COARSE ? 0.9 : 0.35));
      restartBtn.lookAt(camera.position);
      restartBtn.scale.setScalar((COARSE ? 0.72 : 1) * (1 + 0.06 * Math.sin(now * 3.2)));
    }
  }

  {
    const barNow = started ? Math.floor(songPhase() / 4) + 1 : 1;
    const t = window.__sun != null ? window.__sun : Math.min(1, Math.max(0, (barNow - SUNRISE_START) / BARS_TO_MORNING));
    SUNRISE = t * t * (3 - 2 * t); // smoothstep master clock
    SUNRIF = (function (x) { x = Math.min(1, x / 0.68); return x * x * (3 - 2 * x); })(t); // far side wakes early
    SUNRIN = (function (x) { x = Math.min(1, Math.max(0, (x - 0.34) / 0.66)); return x * x * (3 - 2 * x); })(t); // near side holds the night
    if (sunGlowRef) {
      // the glow stays buried until the sunrise passes ~a quarter, then breaks the horizon
      const r = Math.max(0, (SUNRIF - 0.12) / 0.88);
      sunGlowRef.material.opacity = 0.68 * SUNRIF; // glow rides the far (early) curve
      sunGlowRef.position.y = -26 + 100 * r;
      sunGlowRef.scale.set(340 - 120 * SUNRISE, 36 + 170 * SUNRISE, 1);
      moonDisc.material.opacity = 1 - SUNRIF;
      moonGlow.material.opacity = 0.12 * (1 - SUNRIF);
      for (const f of window.__farBG) f.mat.color.copy(_ca.setHex(f.dusk)).lerp(_cb.setHex(f.morn), SUNRIF);
    }
    key.intensity = 1 + 0.7 * (SUNRIF + SUNRIN) * 0.5;
  }
  paletteAt(z + 12, pal);
  scene.fog.color.setHex(pal.fog);
  scene.background.setHex(pal.sky);
  hemi.color.setHex(pal.hemi);
  skyMat.uniforms.top.value.setHex(pal.zenith);
  skyMat.uniforms.mid.value.setHex(pal.fog);
  skyMat.uniforms.bot.value.setHex(pal.horizon);
  far.position.z = z;
  if (typeof starPts !== 'undefined') {
    starPts.position.z = z;
    starMat.uniforms.uT.value = performance.now() / 1000;
    starMat.uniforms.uNight.value = Math.max(0, 1 - 1.3 * SUNRISE);
  }
  if (WANT_STAGE) { // the lawn carries its own color; palette would brown it out
    ground.material.color.setHex(0xd8e2c2).lerp(_ca.setHex(0x4e5364), 1 - SUNRIN);
    for (const e of edgeLines) if (e.material.normalMap) e.material.color.setHex(0xbfb096).lerp(_ca.setHex(0x6a6258), 1 - SUNRIN);
  } else ground.material.color.setHex(pal.ground);
  if (cityMat) cityMat.color.setHex(pal.prop);
  if (cityEdgeMat) cityEdgeMat.color.setHex(pal.light);
  edgeLines[0].material.color.setHex(pal.light);
  edgeLines[1].material.color.setHex(pal.light);

  if (skel && step && now >= step.end) endStep(0.3);
  const wantYaw = finishMode ? Math.PI : (step && step.i === 0) ? Math.PI : 0;
  playerYaw += (wantYaw - playerYaw) * Math.min(1, dt * 6);
  player.rotation.y = playerYaw;
  if (started) {
    const stops = (skel && skel.stopstep) || STOPSTEP;
    const wantStop = step && stops[step.i] ? 1 : 0;
    stopAmt += (wantStop - stopAmt) * Math.min(1, dt * 8);
    if (!(WANT_STAGE && finishMode)) player.position.z += SPEED * dt * (1 - stopAmt);
    if (jetRun) { // eased forward push matched to the leap's air time
      const u = Math.min(1, (now - jetRun.t0) / jetRun.d);
      const g = u * u * (3 - 2 * u);
            const gz = jetRun.kind === 'fall'
        ? g * 0.5 + 0.2 * Math.min(1, Math.max(0, (u - 0.05) / 0.06)) + 0.2 * Math.min(1, Math.max(0, (u - 0.14) / 0.06))
        : JET_DIST * g;
      player.position.z += gz - jetRun.g;
      jetRun.g = gz;
      if (jetRun.mdl) {
        const seg = (a, b) => { const x = Math.min(1, Math.max(0, (u - a) / (b - a))); return x * x * (3 - 2 * x); };
        if (jetRun.kind === 'fall') { // a real topple: the body pitches over ~100 degrees until it
          // lies flat, origin lifted so the whole robot floats just above the road,
          // holds there a good half-second, then gets up
          const lie = seg(0.12, 0.32), up = seg(0.66, 0.84);
          const w = (lie > 0 && up < 1) ? Math.min(lie, 1 - up) : 0;
          jetRun.mdl.rotation.x = 1.75 * lie - 1.78 * up + 0.06 * Math.sin(13 * u) * w;
          jetRun.mdl.rotation.z = 0.10 * Math.sin(9 * u) * w;
          jetRun.mdl.position.y = MORPH_LIFT + 0.27 * lie - 0.27 * up + 0.035 * Math.sin(10 * u + 1) * w;
        } else {
          const air = Math.min(1, Math.max(0, (u - 0.34) / 0.61));
          jetRun.mdl.position.y = MORPH_LIFT + 0.75 * Math.sin(Math.PI * air); // higher still: 75cm arc
          jetRun.mdl.rotation.x = -0.35 * Math.sin(Math.PI * air);
          jetRun.mdl.rotation.y = Math.PI * 6 * seg(0.36, 0.86);  // three spins, ends facing forward
          // jet exhaust: hot sparks raining out from under the feet while airborne
          // launch burst once, then a continuous exhaust shower
          if (air > 0.06 && !jetRun.burst) {
            jetRun.burst = 1;
            for (let i = 0; i < 22; i++) {
              const a = Math.random() * Math.PI * 2;
              const m = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: [0xffd060, 0xffa040, 0xfff2c0][i % 3], transparent: true }));
              m.position.set(player.position.x + Math.cos(a) * 0.2, 0.1, player.position.z + Math.sin(a) * 0.2);
              m.userData = { v: new THREE.Vector3(Math.cos(a) * (1.5 + Math.random() * 2.5), -1.5 - Math.random() * 2.5, Math.sin(a) * (1.5 + Math.random() * 2.5) - 1.5), life: 0.8 };
              m.scale.setScalar(1 + Math.random() * 1.4);
              scene.add(m); sparks.push(m);
            }
          }
          if (air > 0.06 && air < 0.97) {
            jetRun.st = (jetRun.st || 0) - dt;
            if (jetRun.st <= 0) {
              jetRun.st = 0.045;
              const hot = jetRun.mdl.position.y;
              for (let i = 0; i < 6; i++) {
                const m = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: [0xffcf6e, 0xffb050, 0xffeab0][i % 3], transparent: true }));
                m.position.set(player.position.x + (Math.random() - 0.5) * 0.45,
                  Math.max(0.04, hot * 0.55 + Math.random() * 0.15),
                  player.position.z + (Math.random() - 0.5) * 0.45 - 0.12);
                m.userData = { v: new THREE.Vector3((Math.random() - 0.5) * 2.2, -2 - Math.random() * 2.6, -1.5 - Math.random() * 2.6), life: 0.8 };
                m.scale.setScalar(0.8 + Math.random() * 1.3);
                scene.add(m); sparks.push(m);
              }
            }
          }
        }
      }
      if (u >= 1) {
        if (jetRun.kind !== 'fall') { spawnSparks(); spawnSparks(); } // landing puff, double
        if (jetRun.mdl) { jetRun.mdl.position.y = MORPH_LIFT; jetRun.mdl.rotation.x = 0; jetRun.mdl.rotation.y = 0; jetRun.mdl.rotation.z = 0; }
        jetRun = null;
      }
    }
    if (WANT_STAGE && !finishMode && player.position.z >= FINISH + 10) { // plaza center, right at the RESTART sign
      finishMode = true;
      hudFlash = 'STATION PLAZA'; hudT = 0;
      triggerStep(1 + (Math.random() * 3 | 0));
    }
    if (WANT_STAGE && finishMode) {
      // the show: face the camera and keep dancing until RESTART
      if (!step) triggerStep(1 + (Math.floor(performance.now() / 1000 * 7919) % 3));
      player.position.z = FINISH + 10; // hold the show at the plaza's center, at the sign (this old snap to the plaza mouth was the real 'kicked back to the boundary' bug)
    }
  }
  if (skel) {
    if (false) {
      skel.stepTimer += dt;
      if (skel.stepTimer >= skel.stepDur) { skel.stepTimer = -1; skelUse(skel.walk, 0.25); }
    }
    if (skel.walk) {
      const w = skel.walk;
      w.timeScale = w.getClip().duration / (2 * BEAT); // one step per beat
      // continuous phase lock: nudge the walk cycle onto the beat grid every frame.
      // walkfx.c0 = the clip time of a foot contact, so contacts (not clip starts) hit the beats
      const D = w._clip.duration;
      const c0 = w.parent && skel.walkfx !== undefined ? skel.walkfx : 0;
      const ph = songPhase();
      const target = (((c0 + ph * (D / 2)) % D) + D) % D / Math.max(w.timeScale, 1e-4);
      const cur = ((w.time % D) + D) % D;
      let diff = target - cur;
      if (diff > D / 2) diff -= D;
      if (diff < -D / 2) diff += D;
      w.time += diff * Math.min(1, dt * 2.5);
    }
    skel.mixer.update(dt);
    if (skel._arm) { skel._arm = 0; skel.m.visible = true; }
  }
  recycleAlong(dashes, 240, z, 20);
  recycleAlong(laneDashes, 220, z, 18);
  if (!WANT_STAGE) for (const g of props) { // stage props are a fixed promenade, not recycled
    if (g.position.z < z - 14) {
      g.position.z += PROP_COUNT * PROP_SPACING;
      paletteAt(g.position.z, pal);
      g.userData.mat.color.setHex(pal.prop);
      const lc = g.userData.alt ? pal.light2 : pal.light;
      g.userData.lmat.emissive.setHex(lc);
      if (g.userData.glowMat) g.userData.glowMat.color.setHex(lc);
    }
  }
  if (COARSE && renderer.shadowMap.enabled) {
    scene.userData._shf = (scene.userData._shf || 0) + 1;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = (scene.userData._shf % 4) === 0;
  }
  if (WANT_STAGE) {
    window.__pz = player.position.z;
    if (window.__pump) window.__pump();
  }
  if (WANT_STAGE && now - (scene.userData._bakeT || 0) > 0.5) {
    scene.userData._bakeT = now;
    if (window.__cullProps) window.__cullProps();
    if (window.__stats) window.__stats(renderer);
    for (const g of bakedProps) {
      paletteAt(g.position.z, pal);
      const tint = _cb.setHex(pal.prop);
      g.traverse((o) => { if (o.isMesh && o.material && o.userData._orig !== undefined)
        o.material.color.setHex(o.userData._orig).lerp(tint, 0.45); });
    }
  }
  if (!WANT_STAGE) {
    ground.position.set(0, 0, z);
    road.position.set(0, 0.03, z);
    for (const ts of texScroll) ts.t.offset.y = -z / ts.len;
  }
  // stage1: ground/road sit static for the whole 570m run; no plane follow, no texture offset,
  // so asphalt, paint lines, cracks and gravel are all simply fixed to the world.
  if (!WANT_STAGE) for (const e of edgeLines) e.position.z = z;
  for (const sp of stagePosts) sp.o.position.z = z - (z % sp.p);
  if (bgGroup) bgGroup.position.set(0, 0.66, z + bgGroup.userData.dist);

  // pose
  let pose;
  if (!started) pose = idlePose(now);
  else {
    const ph = songPhase();
    pose = walkPose(ph);
    if (activeStep) {
      const st = STEPS[activeStep.i];
      if (!st) activeStep = null;
      const e = activeStep ? ph - activeStep.startBeat : 0;
      if (activeStep && e >= st.dur) activeStep = null;
      else if (activeStep && st.fn && e >= 0) {
        const w = Math.max(0, Math.min(1, Math.min(e / 0.1, (st.dur - e) / 0.35)));
        pose = blend(pose, st.fn(e), w);
      }
    }
  }
  applyPose(pose);
  updateSparks(dt);

  // camera
  const ph2 = started ? songPhase() : 0;
  const sway = started ? 0.05 * Math.sin(ph2 * Math.PI) : 0.06 * Math.sin(now * 0.5);
  camPos.lerp(new THREE.Vector3(player.position.x + sway + 0.32, WANT_CITY ? 0.74 : (WANT_STAGE ? 0.6 : 0.66), player.position.z - (WANT_CITY ? 2.15 : (WANT_STAGE ? 1.8 : 1.95))), 0.12);
  camera.position.copy(camPos);
  camera.lookAt(player.position.x, WANT_CITY ? 0.66 : (WANT_STAGE ? 0.55 : 0.6), player.position.z + (WANT_CITY ? 3.2 : 2.8));

  if (hudFlash && hudT < 1.2) { hudT += dt; } else hudFlash = '';
  if (started) {
    const bar = Math.max(1, Math.floor(songPhase() / 4) + 1);
    if (lyricOn && window.__lyrDone && !location.search.includes('lyrdbg')) {
      lyricBox.style.display = 'none'; // one song, one pass of words: after the first full run the window is done
      lyricOn = false;
    }
    if (lyricOn) {
      // lyrics ride the sung line's real onset time, not a fixed grid: the
      // onsets were measured off the finished track (see LYRT)
      // before the audio actually starts (fetch/decode lag after the click) the
      // clock stays negative: the mark intro waits on the first note row until sound is live
      // the one looping source IS the lyric clock: seconds since its head, capped
      // at the first pass — the words ride pass one and never come back
      const raw = (ctx && started && mus.src) ? ctx.currentTime - songStart : -1;
      let lsec = Math.min(SONG_LOOP, raw);

      if (!lyricLH) { const ps = lyricCol.children; lyricLH = ps[1].offsetTop - ps[0].offsetTop || 26; }
      // LEAD: when a line rides into the middle slot, measured against its sung onset.
      // negative = the text follows the voice slightly, which reads as in-step
      const LEAD = -0.6;
      let idx;
      if (lsec < LYRT[0] + LEAD) {
        // sound-mark intro: marks ride up through blank air, nothing sung shows yet
        const pos = Math.max(0, Math.min(MARKS.length - 1, Math.floor(Math.max(0, lsec) / ((LYRT[0] + LEAD) / MARKS.length))));
        idx = 3 + pos; // column = 3 blanks + MARKS + LYR
      } else {
        let li = LYRT.length - 1;
        while (li > 0 && LYRT[li] > lsec + LEAD) li--;
        idx = MARKS.length + 3 + li;
        // first pass over = words done, whether by the last line's rest or by
        // the loop itself; raw is monotonic, so no wrap-detection tricks needed
        if (raw >= SONG_LOOP) window.__lyrDone = 1;
      }
      // one row down: the box's bright middle row must carry the line being
      // SUNG right now; the next line waits faded at the bottom, not running
      // ahead in the middle. row idx-1 tops the window so row idx centers it
      if (idx !== lyricIdx) { lyricIdx = idx; lyricCol.style.transform = 'translateY(' + (-(idx - 1) * lyricLH) + 'px)'; }
      if (location.search.includes('lyrdbg=1')) document.title = 'LYR lsec=' + (lsec<0?'-':lsec.toFixed(1)) + ' raw=' + (ctx&&started&&mus.src?(ctx.currentTime-songStart).toFixed(1):'-') + ' idx=' + (idx - MARKS.length - 3) + ' [' + (ctx?ctx.state:'noctx') + (mus.src?']src':']----') + (mus.buf?'B':'-') + (audioOk?'ok':'--') + ']';
    } else
    hud.textContent = `BPM ${CONFIG.bpm}  bar ${String(bar).padStart(3, '0')}  ` + (mus && mus.buf ? 'MUSIC ' + SONG_FILE : 'SYNTH shuffle') + (audioOk ? `  AUD ${ctx.state} ${Math.round(ctx.sampleRate / 100) / 10}k` : '  AUD --') + (hudFlash ? `   [ ${hudFlash} ]` : '');
    if (hudFlash) hudT += 0; // keep
  } else hud.textContent = '';
  renderer.render(scene, camera);
}
frame();
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
