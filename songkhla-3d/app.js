import * as THREE from './vendor/three.module.js';

const W = 1080, H = 1920;
export const TOTAL = 75;

// ---------- helpers ----------
let seed = 11;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const rr = (a, b) => a + (b - a) * rnd();
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = u => (u = clamp(u), u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const lerpV = (a, b, u) => a.clone().lerp(b, u);
const col = c => new THREE.Color(c);

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const pmrem = new THREE.PMREMGenerator(renderer);

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: .8, flatShading: true, ...o });
const mesh = (geo, mat, { cast = true, recv = true } = {}) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = recv; return m; };

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function makeSky(top, mid, bot) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: col(top) }, mid: { value: col(mid) }, bot: { value: col(bot) } },
    vertexShader: 'varying vec3 vp; void main(){ vp = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: `uniform vec3 top, mid, bot; varying vec3 vp;
      void main(){ float h = normalize(vp).y;
        vec3 c = h > 0. ? mix(mid, top, pow(clamp(h*1.6,0.,1.), .6)) : mix(mid, bot, clamp(-h*6.,0.,1.));
        gl_FragColor = vec4(c,1.);
        #include <colorspace_fragment>
      }`
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat);
  m.renderOrder = -10;
  return m;
}

const glowTex = canvasTex(256, 256, (g, w) => {
  const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.25, 'rgba(255,240,200,.6)'); gr.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, w);
});
function makeSun(color, r) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16), new THREE.MeshBasicMaterial({ color, fog: false, toneMapped: false })));
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
  s.scale.setScalar(r * 7); g.add(s);
  return g;
}

function makeWater(size, seg, color, amp = .35, o = {}) {
  const geo = new THREE.PlaneGeometry(size, size, seg, seg); geo.rotateX(-Math.PI / 2);
  const m = mesh(geo, std(color, { roughness: .12, metalness: .35, ...o }), { cast: false });
  const pos = geo.attributes.position, base = Float32Array.from(pos.array);
  m.userData.update = t => {
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3], z = base[i * 3 + 2];
      pos.array[i * 3 + 1] = amp * (Math.sin(x * .16 + t * 1.3) + .8 * Math.sin(z * .21 + t * 1.05) + .35 * Math.sin((x + z) * .43 + t * 2.2));
    }
    pos.needsUpdate = true;
  };
  return m;
}

function baseScene({ top, mid, bot, fog = [60, 600], sun = null, sunPos = V(0, 40, -300), light = {} }) {
  const scene = new THREE.Scene();
  const sky = makeSky(top, mid, bot); scene.add(sky);
  scene.fog = new THREE.Fog(col(mid), fog[0], fog[1]);
  const env = new THREE.Scene(); env.add(makeSky(top, mid, bot));
  let sunObj = null;
  if (sun) { sunObj = makeSun(sun.color, sun.r); sunObj.position.copy(sunPos); scene.add(sunObj); const s2 = makeSun(sun.color, sun.r); s2.position.copy(sunPos).normalize().multiplyScalar(500); env.add(s2); }
  scene.environment = pmrem.fromScene(env, .02, .1, 1000).texture;
  scene.environmentIntensity = light.env ?? .9;
  scene.add(new THREE.HemisphereLight(light.sky ?? '#cfe8ff', light.ground ?? '#6b5a3a', light.hemi ?? .8));
  const d = new THREE.DirectionalLight(light.color ?? '#fff1d6', light.dir ?? 2.2);
  d.position.copy(light.pos ?? V(30, 50, 20)); d.castShadow = true;
  const a = light.area ?? 30; Object.assign(d.shadow.camera, { left: -a, right: a, top: a, bottom: -a, near: 1, far: 200 });
  d.shadow.mapSize.set(1024, 1024); d.shadow.bias = -.0005; d.shadow.normalBias = .03;
  if (light.target) d.target.position.copy(light.target);
  scene.add(d, d.target);
  const cam = new THREE.PerspectiveCamera(50, W / H, .1, 2000);
  const updaters = [];
  return { scene, cam, sky, sunObj, updaters, dirLight: d };
}

// ---------- reusable models ----------
const gold = () => new THREE.MeshStandardMaterial({ color: '#ffae2b', metalness: .8, roughness: .28, emissive: '#6a3c00', emissiveIntensity: .35 });

function limb(a, b, r, mat) {
  const len = a.distanceTo(b);
  const m = mesh(new THREE.CapsuleGeometry(r, len, 6, 16), mat);
  m.position.copy(a).add(b).multiplyScalar(.5);
  m.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

function makeMermaid() {
  const g = new THREE.Group(), m = gold();
  const tail = new THREE.CatmullRomCurve3([V(0, .25, 0), V(.5, .05, .35), V(1, -.25, .3), V(1.45, -.4, -.1), V(1.8, -.25, -.5)]);
  for (let i = 0; i <= 40; i++) {
    const u = i / 40, p = tail.getPoint(u), s = mesh(new THREE.SphereGeometry(.34 * (1 - u * .75), 20, 14), m);
    s.position.copy(p); g.add(s);
  }
  const end = tail.getPoint(1);
  for (const sgn of [-1, 1]) {
    const f = mesh(new THREE.ConeGeometry(.28, .7, 16), m);
    f.scale.set(1, 1, .18); f.position.copy(end).add(V(.18, .1 * sgn + .1, -.2 + .1 * sgn));
    f.rotation.set(sgn * .5, .6, -1.1 - sgn * .35); g.add(f);
  }
  const torso = mesh(new THREE.LatheGeometry([[0, .15], [.31, .2], [.33, .38], [.22, .68], [.27, .88], [.25, 1.04], [.13, 1.14], [0, 1.16]].map(([r, y]) => new THREE.Vector2(r, y)), 32), m);
  g.add(torso);
  const head = mesh(new THREE.SphereGeometry(.23, 24, 18), m); head.position.set(-.03, 1.38, .05); g.add(head);
  g.add(limb(V(-.02, 1.1, 0), V(-.03, 1.2, .03), .1, m));             // neck
  const hair = new THREE.CatmullRomCurve3([V(.05, 1.58, -.02), V(-.2, 1.5, -.08), V(-.36, 1.25, -.02), V(-.4, .95, .08), V(-.35, .7, .12)]);
  g.add(mesh(new THREE.TubeGeometry(hair, 30, .08, 10), m));
  g.add(limb(V(.2, 1.05, 0), V(.02, 1.18, .28), .065, m), limb(V(.02, 1.18, .28), V(-.3, 1.1, .16), .06, m));
  g.add(limb(V(-.24, 1.05, 0), V(-.42, .95, .1), .065, m));
  return g;
}

function makeRock(scale = 1) {
  const g = new THREE.Group(), mat = std('#6d6a72', { roughness: .9 });
  const parts = [[0, 0, 0, 1.8, .9], [1.2, -.2, .5, 1.2, .7], [-1.1, -.25, -.3, 1.3, .7], [.3, -.3, 1.2, 1, .6]];
  for (const [x, y, z, r, sy] of parts) { const m = mesh(new THREE.DodecahedronGeometry(r, 0), mat); m.position.set(x, y, z); m.scale.set(1, sy, 1); m.rotation.y = x; g.add(m); }
  g.scale.setScalar(scale);
  return g;
}

function makeIsland(r, h, color = '#3f8f55') {
  const g = new THREE.Group();
  const top = mesh(new THREE.IcosahedronGeometry(r, 1), std(color)); top.scale.set(1, h / r, .8); g.add(top);
  const sand = mesh(new THREE.CylinderGeometry(r * 1.05, r * 1.15, .6, 14), std('#e9d29b')); sand.position.y = -.1; g.add(sand);
  return g;
}

function makePine(h = 6) {
  const g = new THREE.Group();
  const trunk = mesh(new THREE.CylinderGeometry(.12, .2, h * .5, 6), std('#6b4a2b')); trunk.position.y = h * .25; g.add(trunk);
  for (let i = 0; i < 3; i++) { const c = mesh(new THREE.ConeGeometry(h * (.32 - i * .07), h * .45, 7), std(i % 2 ? '#2f6b3d' : '#3a7d48')); c.position.y = h * (.42 + i * .2); g.add(c); }
  return g;
}

function makeTree(s = 1, green = '#2f8a4a') {
  const g = new THREE.Group();
  const t = mesh(new THREE.CylinderGeometry(.15 * s, .25 * s, 2 * s, 6), std('#5a3d24')); t.position.y = s; g.add(t);
  const c = mesh(new THREE.IcosahedronGeometry(1.3 * s, 0), std(green)); c.position.y = 2.6 * s; c.scale.y = .9; g.add(c);
  return g;
}

function makePalm(h = 6) {
  const g = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3([V(0, 0, 0), V(.4, h * .5, 0), V(1.2, h, 0)]);
  g.add(mesh(new THREE.TubeGeometry(curve, 12, .2, 6), std('#7a5a35')));
  for (let i = 0; i < 7; i++) {
    const leaf = mesh(new THREE.SphereGeometry(1, 8, 4), std(i % 2 ? '#2e8b46' : '#3aa158'));
    leaf.scale.set(1.9, .12, .45); const a = i / 7 * Math.PI * 2;
    leaf.position.set(1.2 + Math.cos(a) * 1.4, h - .35, Math.sin(a) * 1.4); leaf.rotation.set(0, -a, -.45); g.add(leaf);
  }
  return g;
}

function label(text, { color = '#ff5a5f', size = 1.6, dot = true } = {}) {
  const fs = 64, padX = 40;
  const meas = document.createElement('canvas').getContext('2d'); meas.font = `800 ${fs}px K`;
  const w = Math.ceil(meas.measureText(text).width) + padX * 2 + (dot ? 60 : 0), h = 110;
  const tex = canvasTex(w, h, g => {
    g.fillStyle = 'rgba(255,255,255,.96)'; g.beginPath(); g.roundRect(0, 0, w, h, 55); g.fill();
    if (dot) { g.fillStyle = color; g.beginPath(); g.arc(padX + 18, h / 2, 18, 0, 7); g.fill(); }
    g.fillStyle = '#1d2b3a'; g.font = `800 ${fs}px K`; g.textBaseline = 'middle'; g.fillText(text, padX + (dot ? 60 : 0), h / 2 + 4);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, toneMapped: false, fog: false }));
  s.scale.set(size * w / h, size, 1); s.renderOrder = 10;
  return s;
}

// ---------- scenes ----------
function sceneOcean({ cta = false } = {}) {
  const S = baseScene(cta
    ? { top: '#2b1055', mid: '#ff8c69', bot: '#7a2c5c', sun: { color: '#ffd08a', r: 26 }, sunPos: V(0, 22, -420), fog: [80, 650], light: { color: '#ffb48a', pos: V(-10, 18, -60), dir: 2.6, sky: '#ffb0a0', ground: '#40204a', area: 14 } }
    : { top: '#4a7bd8', mid: '#ffcf9a', bot: '#ff9f6b', sun: { color: '#fff1b8', r: 24 }, sunPos: V(0, 0, -420), fog: [80, 650], light: { color: '#ffd9a8', pos: V(-10, 25, -60), dir: 2.4 } });
  const water = makeWater(500, 130, cta ? '#5a3c8a' : '#1a7fb0', .45); S.scene.add(water); S.updaters.push(water.userData.update);
  const isl = [[-70, -220, 22, 12], [60, -260, 16, 8], [-20, -330, 12, 5], [110, -180, 9, 4]];
  for (const [x, z, r, h] of isl) { const i = makeIsland(r, h, cta ? '#3b2a55' : '#3f8f55'); i.position.set(x, 0, z); S.scene.add(i); }
  let mermaid;
  if (cta) {
    const rock = makeRock(1); rock.position.set(0, .2, 0); S.scene.add(rock);
    mermaid = makeMermaid(); mermaid.position.set(0, 1.25, 0); mermaid.rotation.y = .9; S.scene.add(mermaid);
  }
  // birds
  const birds = [];
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Group(), m = std(cta ? '#2a1238' : '#5a3020');
    const l = mesh(new THREE.BoxGeometry(1.4, .08, .35), m), r = l.clone();
    l.position.x = -.65; r.position.x = .65; b.add(l, r); b.userData = { l, r, o: rr(0, 6), x: rr(-30, 30), y: rr(14, 26), z: rr(-90, -40) };
    birds.push(b); S.scene.add(b);
  }
  S.update = (t, u) => {
    for (const f of S.updaters) f(t);
    if (!cta) S.sunObj.position.y = -10 + 70 * ease(clamp(u * 1.2));
    for (const b of birds) { const d = b.userData; b.position.set(d.x + t * 6, d.y + Math.sin(t + d.o), d.z); const f = Math.sin(t * 9 + d.o) * .5; d.l.rotation.z = f; d.r.rotation.z = -f; }
    if (cta) {
      const e = ease(u);
      S.cam.position.copy(lerpV(V(2.6, 2.2, 4.2), V(4, 4.5, 15), e)); S.cam.lookAt(lerpV(V(0, 2.2, 0), V(-1, 6, -20), e));
    } else {
      S.cam.position.set(Math.sin(u * 2) * 2, 3.5 + u * 5, 40 - 70 * u); S.cam.lookAt(0, 75 + u * 10, -300); S.cam.rotation.z += Math.sin(u * 3) * .03;
    }
  };
  return S;
}

const MAP = {
  land: [[-18, -8], [-14, -15], [-6, -18], [2, -17], [6, -12], [5, -6], [7, 0], [6, 6], [8, 12], [4, 16], [-4, 18], [-12, 15], [-18, 8]],
  lake: [[-8, 2], [-4, -1], [0, 1], [2, 6], [0, 11], [-4, 12], [-7, 8]],
  pins: { city: [4, 4], samila: [5.6, 7.4], koyo: [-2.5, 5], hatyai: [-2, -7], tonngachang: [-11, -9] }
};
const mp = ([x, y], h = 1) => V(x, h, -y);
function inPoly(x, y, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }

function sceneMap({ route = false } = {}) {
  seed = route ? 77 : 31;
  const S = baseScene({ top: '#3b8fe0', mid: '#bfe6ff', bot: '#9fd3f0', fog: [120, 500], light: { pos: V(25, 45, 30), dir: 2.4, area: 28 } });
  const base = mesh(new THREE.CylinderGeometry(22, 22, 3, 64), std('#24506e', { flatShading: false })); base.position.y = -1.55; S.scene.add(base);
  const disc = mesh(new THREE.CircleGeometry(21.95, 64), std('#1f9ad1', { roughness: .15, metalness: .3, flatShading: false }), { cast: false }); disc.rotation.x = -Math.PI / 2; disc.position.y = .02; S.scene.add(disc);
  const shape = new THREE.Shape(MAP.land.map(([x, y]) => new THREE.Vector2(x, y)));
  shape.holes.push(new THREE.Path(MAP.lake.map(([x, y]) => new THREE.Vector2(x, y))));
  const landGeo = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: true, bevelSize: .4, bevelThickness: .3, bevelSegments: 2 }); landGeo.rotateX(-Math.PI / 2);
  const land = mesh(landGeo, [std('#6cc070'), std('#c9a46a')]); S.scene.add(land);
  const lakeGeo = new THREE.ShapeGeometry(new THREE.Shape(MAP.lake.map(([x, y]) => new THREE.Vector2(x, y)))); lakeGeo.rotateX(-Math.PI / 2);
  const lake = mesh(lakeGeo, std('#4fc3e8', { roughness: .1, metalness: .3, flatShading: false }), { cast: false }); lake.position.y = .55; S.scene.add(lake);
  const koyo = mesh(new THREE.CylinderGeometry(1, 1.3, .9, 10), std('#4fae5c')); koyo.position.copy(mp(MAP.pins.koyo, .6)); S.scene.add(koyo);
  // trees + towns
  for (let i = 0; i < 160; i++) {
    const x = rr(-18, 8), y = rr(-18, 18);
    if (!inPoly(x, y, MAP.land) || inPoly(x, y, MAP.lake) || Math.hypot(x - 4, y - 4) < 2.5 || Math.hypot(x + 2, y + 7) < 3) continue;
    const t = makeTree(rr(.25, .4), rnd() > .5 ? '#2f8a4a' : '#3fa35a'); t.position.copy(mp([x, y], 1.3)); S.scene.add(t);
  }
  const town = ([cx, cy], n, rad) => { for (let i = 0; i < n; i++) { const h = rr(.4, 2.2), b = mesh(new THREE.BoxGeometry(.6, h, .6), std(['#f4f1ea', '#ffd8a8', '#cfe3ff', '#ffb4a8'][i % 4])); const a = rnd() * 7, r = rnd() * rad; b.position.copy(mp([cx + Math.cos(a) * r, cy + Math.sin(a) * r], 1.3 + h / 2)); S.scene.add(b); } };
  town(MAP.pins.hatyai, 26, 2.4); town(MAP.pins.city, 14, 1.6);
  // pins
  const P = [['city', 'เมืองสงขลา', '#ff5a5f'], ['samila', 'หาดสมิหลา', '#ffb400'], ['koyo', 'เกาะยอ', '#8e5cff'], ['hatyai', 'หาดใหญ่', '#ff2d87'], ['tonngachang', 'น้ำตกโตนงาช้าง', '#1fbf75']];
  const pins = P.map(([k, name, c], i) => {
    const g = new THREE.Group(), m = std(c, { flatShading: false, roughness: .35, metalness: .1 });
    const ball = mesh(new THREE.SphereGeometry(.55, 24, 16), m); ball.position.y = 1.8; g.add(ball);
    const cone = mesh(new THREE.ConeGeometry(.42, 1.3, 20), m); cone.rotation.x = Math.PI; cone.position.y = .9; g.add(cone);
    const lb = label(name, { color: c, size: 1.25 }); lb.position.y = 3.3; g.add(lb);
    g.position.copy(mp(MAP.pins[k], k === 'koyo' ? 1.05 : 1.3)); g.userData = { i, base: g.position.y }; S.scene.add(g);
    return g;
  });
  const extra = [[label('ทะเลสาบสงขลา', { dot: false, size: 1 }), mp([-4, 9], 2.2)], [label('อ่าวไทย', { dot: false, size: 1.2 }), mp([14, 2], 1.5)]];
  for (const [s, p] of extra) { s.position.copy(p); S.scene.add(s); }
  // route
  let tube, car, curve;
  if (route) {
    curve = new THREE.CatmullRomCurve3([mp(MAP.pins.hatyai, 1.5), mp([1, -2], 1.6), mp(MAP.pins.city, 1.5), mp(MAP.pins.samila, 1.5), mp([3, 6.5], 1.6), mp([0, 5], 1.2), mp(MAP.pins.koyo, 1.3)]);
    tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 200, .2, 8), new THREE.MeshStandardMaterial({ color: '#ffd84a', emissive: '#ffb400', emissiveIntensity: .8 }));
    S.scene.add(tube);
    car = mesh(new THREE.SphereGeometry(.45, 20, 14), new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#ffffff', emissiveIntensity: 1.5 })); S.scene.add(car);
  }
  S.update = (t, u) => {
    for (const p of pins) { const d = p.userData, k = clamp((t - .8 - d.i * .35) / .9); const b = k < 1 ? (1 - k) * 14 - Math.sin(k * Math.PI) * 1.2 : 0; p.position.y = d.base + b + (k >= 1 ? Math.sin(t * 2 + d.i) * .12 : 0); p.visible = k > 0; }
    if (route) {
      const k = clamp((t - 1) / 5.2), n = tube.geometry.index.count;
      tube.geometry.setDrawRange(0, Math.floor(n * k / 3) * 3); car.position.copy(curve.getPoint(Math.max(.001, k))).add(V(0, .3, 0));
      const a = .6 + u * .9; S.cam.position.set(Math.sin(a) * 38, 36 - u * 6, Math.cos(a) * 38); S.cam.lookAt(0, -2, 2);
    } else {
      const a = -.5 + u * 1.1; S.cam.position.set(Math.sin(a) * 42, 38 - u * 8, Math.cos(a) * 42); S.cam.lookAt(-1, -3, 2);
    }
  };
  return S;
}

function sceneSamila() {
  seed = 5;
  const S = baseScene({ top: '#2f8fe8', mid: '#cdeeff', bot: '#9edcf0', sun: { color: '#fff6d8', r: 14 }, sunPos: V(-120, 160, -300), fog: [60, 520], light: { pos: V(-20, 40, -10), dir: 2.6, area: 14 } });
  const water = makeWater(400, 140, '#18a7cf', .22); S.scene.add(water); S.updaters.push(water.userData.update);
  const sandGeo = new THREE.PlaneGeometry(260, 140, 60, 30); sandGeo.rotateX(-Math.PI / 2);
  const sp = sandGeo.attributes.position;
  for (let i = 0; i < sp.count; i++) { const z = sp.getZ(i) + 72; sp.setY(i, -1.2 + .085 * z + Math.sin(sp.getX(i) * .2) * .15); }
  const sand = mesh(sandGeo, std('#f1d9a0', { roughness: 1 }), { cast: false }); sand.position.z = 72; S.scene.add(sand);
  const rock = makeRock(1); rock.position.set(0, .1, -2); S.scene.add(rock);
  const mer = makeMermaid(); mer.position.set(0, 1.2, -2); mer.rotation.y = .4; S.scene.add(mer);
  const nu = makeIsland(22, 14, '#3a8a50'); nu.position.set(-45, 0, -170); S.scene.add(nu);
  const maeo = makeIsland(13, 7, '#45995b'); maeo.position.set(30, 0, -200); S.scene.add(maeo);
  for (const [s, p] of [[label('เกาะหนู', { dot: false, size: 6.5 }), V(-45, 22, -170)], [label('เกาะแมว', { dot: false, size: 6 }), V(30, 15, -200)]]) { s.position.copy(p); S.scene.add(s); }
  for (let i = 0; i < 26; i++) { const p = makePine(rr(6, 9)); p.position.set(rr(-60, 60), 0, rr(16, 40)); p.position.y = -1.2 + .085 * p.position.z; S.scene.add(p); }
  const umb = [['#ff5a5f', -8, 9], ['#ffb400', 7, 11], ['#2bb3ff', 14, 7]];
  for (const [c, x, z] of umb) { const g = new THREE.Group(); g.add(mesh(new THREE.CylinderGeometry(.06, .06, 2.4), std('#ddd'))); const top = mesh(new THREE.ConeGeometry(1.5, .6, 10), std(c)); top.position.y = 1.3; g.add(top); g.position.set(x, -1.2 + .085 * z + 1.1, z); S.scene.add(g); }
  S.update = (t, u) => {
    for (const f of S.updaters) f(t);
    const a = .95 - u * 1.5, r = 7.5 - u * 1.2;
    S.cam.position.set(Math.sin(a) * r, 2.6 + Math.sin(u * 3) * .4, -2 + Math.cos(a) * r); S.cam.lookAt(0, 2.2, -2);
  };
  return S;
}

function sceneLake() {
  seed = 9;
  const S = baseScene({ top: '#3a1d6e', mid: '#ff9a7a', bot: '#a3497a', sun: { color: '#ffcf80', r: 30 }, sunPos: V(40, 18, -460), fog: [100, 700], light: { color: '#ffb080', pos: V(30, 20, -80), dir: 2.4, sky: '#ffb3c8', ground: '#3a2050', area: 60, target: V(0, 0, -20) } });
  const water = makeWater(600, 140, '#7a4f9a', .3, { roughness: .08, metalness: .5 }); S.scene.add(water); S.updaters.push(water.userData.update);
  const hills = [[-150, -380, 60, 18], [-40, -420, 50, 12], [160, -400, 70, 20], [260, -330, 40, 10]];
  for (const [x, z, r, h] of hills) { const i = makeIsland(r, h, '#4a2d63'); i.position.set(x, 0, z); S.scene.add(i); }
  const deck = new THREE.CatmullRomCurve3([V(-220, 6, -10), V(-80, 10, -30), V(40, 12, -40), V(200, 6, -20)]);
  const concrete = std('#d9cbd6', { roughness: .7 }), lampMat = new THREE.MeshStandardMaterial({ color: '#fff3c0', emissive: '#ffd27a', emissiveIntensity: 3 });
  const N = 140;
  for (let i = 0; i < N; i++) {
    const p = deck.getPoint(i / N), q = deck.getPoint((i + 1) / N), seg = mesh(new THREE.BoxGeometry(1, 1, 1), concrete);
    seg.position.copy(p).add(q).multiplyScalar(.5); seg.scale.set(9, .9, p.distanceTo(q) + .2); seg.quaternion.setFromUnitVectors(V(0, 0, 1), q.clone().sub(p).normalize());
    S.scene.add(seg);
    if (i % 3 === 0) { const pil = mesh(new THREE.CylinderGeometry(.6, .8, p.y + 2, 8), concrete); pil.position.set(p.x, (p.y - 2) / 2, p.z); S.scene.add(pil); }
    if (i % 2 === 0) for (const side of [-4.2, 4.2]) {
      const dir = q.clone().sub(p).normalize(), n = V(-dir.z, 0, dir.x).multiplyScalar(side);
      const pole = mesh(new THREE.CylinderGeometry(.06, .06, 2.4), std('#333')); pole.position.copy(p).add(n).add(V(0, 1.5, 0)); S.scene.add(pole);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(.28, 10, 8), lampMat); lamp.position.copy(pole.position).add(V(0, 1.3, 0)); S.scene.add(lamp);
    }
  }
  const boats = [];
  for (const [x, z, c] of [[-20, 30, '#ffe7f0'], [25, 55, '#ffd27a'], [-45, 70, '#c9f0ff']]) {
    const b = new THREE.Group();
    const hull = mesh(new THREE.CylinderGeometry(1.2, .6, 7, 6, 1), std('#2a1b3a')); hull.rotation.z = Math.PI / 2; hull.scale.set(1, 1, .6); b.add(hull);
    const mast = mesh(new THREE.CylinderGeometry(.08, .08, 7), std('#2a1b3a')); mast.position.y = 3.5; b.add(mast);
    const sailG = new THREE.BufferGeometry().setFromPoints([V(0, 1, 0), V(0, 7, 0), V(3.5, 1.2, 0)]); sailG.computeVertexNormals();
    const sail = mesh(sailG, std(c, { side: THREE.DoubleSide, flatShading: false })); b.add(sail);
    b.position.set(x, .3, z); b.userData.o = x; boats.push(b); S.scene.add(b);
  }
  const sign = label('สะพานติณสูลานนท์', { color: '#ffb400', size: 4 }); sign.position.set(-40, 22, -26); S.scene.add(sign);
  S.update = (t, u) => {
    for (const f of S.updaters) f(t);
    for (const b of boats) { b.position.y = .3 + Math.sin(t * 1.6 + b.userData.o) * .3; b.rotation.z = Math.sin(t * 1.3 + b.userData.o) * .05; b.position.x = b.userData.o + t * 1.2; }
    const e = ease(u);
    S.cam.position.copy(lerpV(V(-110, 9, 70), V(10, 20, 45), e)); S.cam.lookAt(lerpV(V(-30, 8, -30), V(60, 6, -60), e));
  };
  return S;
}

function facade(color, signText) {
  return canvasTex(512, 768, (g, w, h) => {
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,.08)'; for (let y = 0; y < h; y += 24) g.fillRect(0, y, w, 2);
    g.fillStyle = '#fff8ea'; g.fillRect(0, 0, w, 40); g.fillRect(0, 395, w, 26);
    const arch = (x, y, ww, hh, fill) => { g.fillStyle = fill; g.beginPath(); g.moveTo(x, y + hh); g.lineTo(x, y + ww / 2); g.arc(x + ww / 2, y + ww / 2, ww / 2, Math.PI, 0); g.lineTo(x + ww, y + hh); g.closePath(); g.fill(); };
    for (const x of [70, 300]) {
      arch(x - 14, 96, 170, 270, '#fff8ea'); arch(x, 110, 142, 248, '#2d4b5a');
      g.fillStyle = '#2f8f6a'; g.fillRect(x - 40, 140, 36, 218); g.fillRect(x + 146, 140, 36, 218);
      g.strokeStyle = '#fff8ea'; g.lineWidth = 6; g.beginPath(); g.moveTo(x + 71, 110); g.lineTo(x + 71, 358); g.stroke();
    }
    g.fillStyle = '#7d2a17'; g.fillRect(40, 440, 432, 70);
    g.fillStyle = '#ffd56b'; g.font = '800 48px K'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(signText, w / 2, 478);
    arch(150, 530, 212, 238, '#4a2c1a');
    g.fillStyle = '#ffe2a6'; g.fillRect(170, 600, 172, 168);
    g.fillStyle = '#4a2c1a'; for (let x = 170; x < 342; x += 28) g.fillRect(x, 600, 6, 168);
  });
}

function sceneOldTown() {
  seed = 21;
  const S = baseScene({ top: '#7fc3f5', mid: '#ffe9c8', bot: '#ffe0b0', sun: { color: '#fff3d0', r: 10 }, sunPos: V(-60, 120, -200), fog: [40, 160], light: { pos: V(-25, 40, 10), dir: 2.6, area: 40, target: V(0, 0, 10) } });
  const road = mesh(new THREE.PlaneGeometry(10, 200), std('#7d7470', { roughness: 1 }), { cast: false }); road.rotation.x = -Math.PI / 2; road.position.z = 10; S.scene.add(road);
  const walk = std('#d9c6a5');
  for (const x of [-6.5, 6.5]) { const w = mesh(new THREE.BoxGeometry(3, .3, 200), walk); w.position.set(x, .15, 10); S.scene.add(w); }
  const colors = ['#9fd8c4', '#f6a9a0', '#ffd56b', '#9cc7ea', '#f7b980', '#c9b4e8', '#a8e0a0'];
  const signs = ['โกปี้', 'ขนมบ้าน', 'ร้านน้ำชา', 'ผ้าทอ', 'ของฝาก', 'ติ่มซำ', 'ร้านเก่า'];
  const texCache = colors.map((c, i) => facade(c, signs[i]));
  let k = 0;
  for (const side of [-1, 1]) for (let z = 60; z > -50; z -= 6.2) {
    const h = rr(8.5, 10.5), ci = k++ % 7, front = new THREE.MeshStandardMaterial({ map: texCache[ci], roughness: .9 }), plain = std(colors[ci], { flatShading: false });
    const mats = side < 0 ? [front, plain, plain, plain, plain, plain] : [plain, front, plain, plain, plain, plain];
    const b = mesh(new THREE.BoxGeometry(8, h, 6), mats); b.position.set(side * 12, h / 2, z); S.scene.add(b);
    const roof = mesh(new THREE.BoxGeometry(9, .5, 6.4), std('#b5452a')); roof.position.set(side * 11.6, h + .5, z); roof.rotation.z = side * -.18; S.scene.add(roof);
    const plant = mesh(new THREE.IcosahedronGeometry(.6, 0), std('#3f9a4f')); plant.position.set(side * 7.4, .9, z + 2); S.scene.add(plant);
  }
  const lanterns = [];
  const red = new THREE.MeshStandardMaterial({ color: '#e53935', emissive: '#c62828', emissiveIntensity: .6, roughness: .5 }), cap = std('#ffd56b');
  for (let z = 50; z > -40; z -= 9) {
    const line = new THREE.CatmullRomCurve3([V(-8, 8.6, z), V(0, 7.2, z), V(8, 8.6, z)]);
    S.scene.add(new THREE.Mesh(new THREE.TubeGeometry(line, 20, .03, 4), std('#3a2a20')));
    for (let i = 1; i < 8; i++) {
      const p = line.getPoint(i / 8), g = new THREE.Group();
      const body = mesh(new THREE.SphereGeometry(.42, 16, 12), red); body.scale.y = 1.25; body.position.y = -.65; g.add(body);
      const c1 = mesh(new THREE.CylinderGeometry(.22, .22, .12, 12), cap); c1.position.y = -.1; g.add(c1);
      const c2 = c1.clone(); c2.position.y = -1.2; g.add(c2);
      g.position.copy(p); g.userData.o = i + z; lanterns.push(g); S.scene.add(g);
    }
  }
  const bike = new THREE.Group(); // simple bicycle
  for (const x of [-.7, .7]) { const w = mesh(new THREE.TorusGeometry(.45, .05, 8, 24), std('#222')); w.position.x = x; bike.add(w); }
  bike.add(limb(V(-.7, 0, 0), V(.2, .6, 0), .04, std('#e53935')), limb(V(.2, .6, 0), V(.7, 0, 0), .04, std('#e53935')));
  bike.position.set(-6, .75, 14); bike.rotation.y = Math.PI / 2; S.scene.add(bike);
  S.update = (t, u) => {
    for (const l of lanterns) l.rotation.z = Math.sin(t * 1.8 + l.userData.o) * .12;
    const z = 46 - u * 38;
    S.cam.position.set(Math.sin(u * 4) * .6, 2.4 + Math.sin(t * 5) * .04 + u * 1.5, z); S.cam.lookAt(Math.sin(u * 3) * 2.5, 5.2, z - 20);
  };
  return S;
}

function windowsTex(lit) {
  return canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    for (let y = 16; y < h; y += 42) for (let x = 14; x < w; x += 40) {
      if (rnd() < lit) { g.fillStyle = rnd() > .3 ? '#ffd27a' : '#8ff0ff'; g.globalAlpha = rr(.5, 1); g.fillRect(x, y, 24, 26); g.globalAlpha = 1; }
    }
  });
}

function sceneHatYai() {
  seed = 45;
  const S = baseScene({ top: '#05051a', mid: '#3a1a6b', bot: '#1a0a30', fog: [60, 420], light: { color: '#8a7aff', pos: V(20, 60, 40), dir: .5, sky: '#6a4aff', ground: '#1a0a30', hemi: .4, env: .5, area: 80 } });
  const ground = mesh(new THREE.PlaneGeometry(600, 600), std('#120a24', { roughness: .4, metalness: .4 }), { cast: false }); ground.rotation.x = -Math.PI / 2; S.scene.add(ground);
  const stars = new THREE.BufferGeometry(), sp = [];
  for (let i = 0; i < 900; i++) { const a = rnd() * 7, e = rr(.15, 1.4), r = 800; sp.push(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r); }
  stars.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  S.scene.add(new THREE.Points(stars, new THREE.PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: false, fog: false })));
  const texs = [windowsTex(.55), windowsTex(.4), windowsTex(.7)];
  for (let gx = -6; gx <= 6; gx++) for (let gz = -14; gz <= 6; gz++) {
    if (Math.abs(gx) < 1) continue;
    const w = rr(7, 11), d = rr(7, 11), h = rr(12, 48) * (Math.abs(gx) < 3 ? 1 : 1.3);
    const tx = texs[(gx + gz + 20) % 3].clone(); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.repeat.set(w / 8, h / 16); tx.needsUpdate = true;
    const side = new THREE.MeshStandardMaterial({ color: rnd() > .5 ? '#1b1340' : '#241a4f', emissive: '#ffffff', emissiveMap: tx, emissiveIntensity: 1.3, roughness: .5 });
    const roof = std('#140c2e');
    const b = mesh(new THREE.BoxGeometry(w, h, d), [side, side, roof, roof, side, side], { cast: false }); b.position.set(gx * 15, h / 2, gz * 15); S.scene.add(b);
  }
  const neon = (txt, c, size) => {
    const tex = canvasTex(1024, 256, (g, w, h) => { g.font = '900 170px K'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.shadowColor = c; g.shadowBlur = 40; g.fillStyle = '#fff'; for (let i = 0; i < 3; i++) g.fillText(txt, w / 2, h / 2 + 10); });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size * 4, size), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, fog: false, depthWrite: false }));
    return m;
  };
  const n1 = neon('หาดใหญ่', '#ff2d87', 9); n1.position.set(-9.5, 34, -40); n1.rotation.y = Math.PI / 2; S.scene.add(n1);
  const n2 = neon('ตลาดกิมหยง', '#2de1ff', 5); n2.position.set(9.5, 18, -10); n2.rotation.y = -Math.PI / 2; S.scene.add(n2);
  const cars = [];
  const cm = [new THREE.MeshBasicMaterial({ color: '#ff3a3a', toneMapped: false }), new THREE.MeshBasicMaterial({ color: '#fff3c0', toneMapped: false })];
  for (let i = 0; i < 40; i++) { const c = new THREE.Mesh(new THREE.BoxGeometry(.5, .3, rr(3, 6)), cm[i % 2]); c.userData = { lane: i % 2 ? 3 : -3, o: rr(0, 300), v: rr(14, 24) * (i % 2 ? -1 : 1) }; c.position.y = .5; cars.push(c); S.scene.add(c); }
  S.update = (t, u) => {
    for (const c of cars) { const d = c.userData; c.position.x = d.lane; c.position.z = ((d.o + t * d.v) % 300 + 300) % 300 - 220; }
    const e = ease(u);
    S.cam.position.copy(lerpV(V(0, 3, 70), V(0, 46, -10), e)); S.cam.lookAt(lerpV(V(0, 12, -40), V(0, 10, -150), e));
  };
  return S;
}

function sceneFalls() {
  seed = 61;
  const S = baseScene({ top: '#5fb8e8', mid: '#d8f5e0', bot: '#bfe8c8', sun: { color: '#fff8e0', r: 10 }, sunPos: V(80, 160, -200), fog: [50, 300], light: { pos: V(20, 50, 30), dir: 2.4, area: 35, target: V(0, 10, -10) } });
  const ground = mesh(new THREE.PlaneGeometry(400, 400, 40, 40), std('#2f7d3f'), { cast: false }); ground.rotation.x = -Math.PI / 2; S.scene.add(ground);
  const rock = std('#6f7a6a', { roughness: .95 });
  const flowTex = canvasTex(128, 512, (g, w, h) => {
    g.fillStyle = 'rgba(220,250,255,.85)'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) { g.fillStyle = rnd() > .5 ? 'rgba(255,255,255,.95)' : 'rgba(150,215,240,.7)'; g.fillRect(rr(0, w), rr(0, h), rr(2, 8), rr(30, 120)); }
  });
  flowTex.wrapS = flowTex.wrapT = THREE.RepeatWrapping;
  const waterMat = new THREE.MeshStandardMaterial({ map: flowTex, transparent: true, opacity: .92, roughness: .2, emissive: '#bfefff', emissiveIntensity: .25, side: THREE.DoubleSide });
  const poolMat = std('#5cc8e6', { roughness: .1, metalness: .3, flatShading: false });
  for (let i = 0; i < 7; i++) {
    const y = i * 3.6, z = -i * 4, w = 18 - i * 1.4;
    const tier = mesh(new THREE.BoxGeometry(w + 10, 3.6, 5), rock); tier.position.set(0, y + 1.8, z - 2.5); S.scene.add(tier);
    for (const sx of [-1, 1]) { const bl = mesh(new THREE.DodecahedronGeometry(rr(2, 3.2), 0), rock); bl.position.set(sx * (w / 2 + rr(4, 6)), y + 3.2, z - 2); S.scene.add(bl); }
    const fw = w * .55, fall = new THREE.Mesh(new THREE.PlaneGeometry(fw, 3.7), waterMat); fall.position.set(0, y + 1.85, z + .02); S.scene.add(fall);
    const pool = mesh(new THREE.BoxGeometry(fw + 1.5, .15, 3.6), poolMat, { cast: false }); pool.position.set(0, y + 3.62, z - 2.4); S.scene.add(pool);
    const lab = label(`ชั้น ${i + 1}`, { color: '#1fbf75', size: 1.1 }); lab.position.set(w / 2 + 2, y + 4.4, z); S.scene.add(lab);
  }
  const pond = mesh(new THREE.CylinderGeometry(14, 14, .3, 40), poolMat, { cast: false }); pond.position.set(0, .1, 6); S.scene.add(pond);
  for (let i = 0; i < 110; i++) {
    const x = rr(-80, 80), z = rr(-90, 30); if (Math.abs(x) < 20 && z > -32 && z < 22) continue;
    const t = makeTree(rr(1.2, 2.4), ['#2f8a4a', '#3fa35a', '#257a3c'][i % 3]); t.position.set(x, Math.max(0, (-z - 10) * .35) * (Math.abs(x) < 40 ? 1 : .6), z); S.scene.add(t);
  }
  for (const [x, z, r, h] of [[-60, -80, 40, 34], [60, -90, 45, 40], [0, -120, 60, 45]]) { const m = mesh(new THREE.IcosahedronGeometry(r, 1), std('#2a6e3a')); m.scale.y = h / r; m.position.set(x, 0, z); S.scene.add(m); }
  const mist = [];
  for (let i = 0; i < 8; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: .35, depthWrite: false })); s.position.set(rr(-6, 6), rr(1, 3), rr(1, 4)); s.scale.setScalar(rr(5, 8)); s.userData.o = rnd() * 6; mist.push(s); S.scene.add(s); }
  S.update = (t, u) => {
    flowTex.offset.y = t * 1.4;
    for (const m of mist) m.material.opacity = .25 + .15 * Math.sin(t * 2 + m.userData.o);
    const e = ease(u), a = -.35 + e * .6;
    S.cam.position.set(Math.sin(a) * 52, 8 + e * 16, 6 + Math.cos(a) * 48); S.cam.lookAt(0, 11 + e * 3, -12);
  };
  return S;
}

function sceneFood() {
  seed = 88;
  const S = baseScene({ top: '#ff7a3d', mid: '#ffd27a', bot: '#ffb36b', fog: [60, 400], light: { pos: V(10, 30, 30), dir: 2, area: 20 } });
  const floor = mesh(new THREE.CylinderGeometry(14, 14, .6, 64), std('#fff1d6', { flatShading: false })); floor.position.y = -.3; S.scene.add(floor);
  const dishes = [['🍗', 'ไก่ทอดหาดใหญ่', 'กรอบนอก นุ่มใน'], ['🥟', 'ติ่มซำ', 'มื้อเช้าสไตล์หาดใหญ่'], ['🫓', 'โรตี–ชาชัก', 'คู่หูยามเช้า'], ['🦐', 'ซีฟู้ดทะเลสาบ', 'กุ้ง ปู ปลากะพง'], ['🍚', 'ข้าวยำปักษ์ใต้', 'สมุนไพรเพียบ'], ['🍮', 'ขนมพื้นเมือง', 'ร้านเก่าแก่เมืองเก่า']];
  const ring = new THREE.Group(); S.scene.add(ring);
  dishes.forEach(([e, name, sub], i) => {
    const tex = canvasTex(600, 760, (g, w, h) => {
      g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect(0, 0, w, h, 60); g.fill();
      g.fillStyle = '#fff1d6'; g.beginPath(); g.arc(w / 2, 270, 190, 0, 7); g.fill();
      g.font = '230px "Noto Color Emoji"'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(e, w / 2, 285);
      g.fillStyle = '#4a1d00'; g.font = '800 68px K'; g.fillText(name, w / 2, 560);
      g.fillStyle = '#a0521c'; g.font = '400 44px K'; g.fillText(sub, w / 2, 650);
    });
    const card = new THREE.Group();
    const front = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 5.32), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
    const back = mesh(new THREE.BoxGeometry(4.3, 5.42, .25), std('#ff8a3d', { flatShading: false })); back.position.z = -.14;
    card.add(front, back);
    const a = i / 6 * Math.PI * 2; card.position.set(Math.sin(a) * 7.2, 3.4, Math.cos(a) * 7.2); card.rotation.y = a; card.userData.i = i;
    ring.add(card);
  });
  const conf = [];
  for (let i = 0; i < 70; i++) { const c = mesh(new THREE.BoxGeometry(.3, .3, .06), std(['#ff5a5f', '#ffb400', '#2bb3ff', '#1fbf75', '#ffffff'][i % 5], { flatShading: false }), { cast: false }); c.position.set(rr(-14, 14), rr(0, 18), rr(-14, 10)); c.userData = { o: rnd() * 6, s: rr(.5, 1.5) }; conf.push(c); S.scene.add(c); }
  S.update = (t, u) => {
    ring.rotation.y = -u * Math.PI * 2 * .85 + .2;
    ring.children.forEach(c => { c.position.y = 3.4 + Math.sin(t * 2 + c.userData.i) * .25; });
    for (const c of conf) { c.rotation.set(t * c.userData.s, t * c.userData.s * .7, 0); c.position.y = 18 - ((t * c.userData.s * 2 + c.userData.o * 3) % 18); }
    S.cam.position.set(0, 9, 27); S.cam.lookAt(0, 2.2, 0);
  };
  return S;
}

function scenePlane() {
  seed = 99;
  const S = baseScene({ top: '#1d5fd1', mid: '#9fd8ff', bot: '#e8f6ff', sun: { color: '#fffbe8', r: 14 }, sunPos: V(-150, 120, -300), fog: [80, 500], light: { pos: V(-30, 50, 20), dir: 2.4, area: 20 } });
  const white = std('#ffffff', { flatShading: false, roughness: .4, metalness: .2 }), blue = std('#1d5fd1', { flatShading: false });
  const plane = new THREE.Group();
  const body = mesh(new THREE.CapsuleGeometry(1, 9, 10, 24), white); body.rotation.x = Math.PI / 2; plane.add(body);
  const stripe = mesh(new THREE.CylinderGeometry(1.02, 1.02, 7, 24, 1, true), blue); stripe.rotation.x = Math.PI / 2; stripe.scale.set(1, 1, .25); stripe.position.y = -.1; plane.add(stripe);
  const wing = mesh(new THREE.BoxGeometry(14, .2, 2.4), white); wing.position.z = .5; plane.add(wing);
  const tail = mesh(new THREE.BoxGeometry(.2, 3, 2), blue); tail.position.set(0, 1.8, 5); tail.rotation.x = -.4; plane.add(tail);
  const htail = mesh(new THREE.BoxGeometry(5, .15, 1.4), white); htail.position.set(0, .4, 5.2); plane.add(htail);
  for (const x of [-3.2, 3.2]) { const e = mesh(new THREE.CylinderGeometry(.5, .45, 2, 16), blue); e.rotation.x = Math.PI / 2; e.position.set(x, -.6, -.2); plane.add(e); }
  const winGlass = std('#22334a', { flatShading: false, roughness: .1, metalness: .6 });
  for (let z = -3.5; z < 3.5; z += .7) for (const x of [-.98, .98]) { const w = mesh(new THREE.SphereGeometry(.13, 8, 6), winGlass); w.position.set(x, .25, z); plane.add(w); }
  S.scene.add(plane);
  const clouds = [];
  for (let i = 0; i < 60; i++) {
    const c = new THREE.Group(), m = std('#ffffff', { roughness: 1 });
    for (let k = 0; k < 5; k++) { const s = mesh(new THREE.IcosahedronGeometry(rr(3, 7), 1), m, { cast: false }); s.position.set(rr(-8, 8), rr(-1, 2), rr(-5, 5)); c.add(s); }
    c.position.set(rr(-120, 120), rr(-26, -12), rr(-300, 60)); c.userData.z = c.position.z; clouds.push(c); S.scene.add(c);
  }
  const sea = mesh(new THREE.PlaneGeometry(1200, 1200), std('#2a8fd0', { roughness: .3 }), { cast: false }); sea.rotation.x = -Math.PI / 2; sea.position.y = -60; S.scene.add(sea);
  S.update = (t, u) => {
    for (const c of clouds) c.position.z = ((c.userData.z + 300 + t * 45) % 360) - 300;
    plane.rotation.z = Math.sin(t * .8) * .12; plane.position.y = Math.sin(t * 1.1) * .6;
    const a = 2.3 - u * 1.4;
    S.cam.position.set(Math.sin(a) * 22, 5 + u * 3, Math.cos(a) * 22); S.cam.lookAt(0, 0, 0);
  };
  return S;
}

// ---------- timeline ----------
export const SCENES = [];
export async function build() {
  const defs = [[0, 6, () => sceneOcean()], [6, 7, () => sceneMap()], [13, 7, sceneSamila], [20, 7, sceneLake], [27, 7, sceneOldTown], [34, 7, sceneHatYai], [41, 7, sceneFalls], [48, 7, sceneFood], [55, 7, () => sceneMap({ route: true })], [62, 6, scenePlane], [68, 7, () => sceneOcean({ cta: true })]];
  for (const [s, d, f] of defs) SCENES.push({ s, d, ...f() });
  pmrem.dispose();
}

const fadeEl = document.getElementById('fade');
export function renderAt(t) {
  let sc = SCENES[SCENES.length - 1];
  for (const x of SCENES) if (t >= x.s && t < x.s + x.d) { sc = x; break; }
  const lt = t - sc.s, u = clamp(lt / sc.d);
  sc.update(lt, u);
  sc.sky.position.copy(sc.cam.position);
  renderer.render(sc.scene, sc.cam);
  let f = clamp(1 - t / .5);
  for (const x of SCENES.slice(1)) f = Math.max(f, clamp(1 - Math.abs(t - x.s) / .3));
  f = Math.max(f, clamp((t - (TOTAL - .8)) / .8));
  fadeEl.style.opacity = f;
}
