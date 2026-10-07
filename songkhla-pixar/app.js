import * as THREE from 'three';
import { EffectComposer } from './vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from './vendor/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from './vendor/jsm/postprocessing/UnrealBloomPass.js';
import { BokehPass } from './vendor/jsm/postprocessing/BokehPass.js';
import { OutputPass } from './vendor/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from './vendor/jsm/postprocessing/ShaderPass.js';
import { RoundedBoxGeometry } from './vendor/jsm/geometries/RoundedBoxGeometry.js';

const SCALE = +(new URLSearchParams(location.search).get('scale') || .75);
const FLAGS = new URLSearchParams(location.search).get('off') || '';
const W = Math.round(1080 * SCALE), H = Math.round(1920 * SCALE);
export const TOTAL = 75;

// ---------------------------------------------------------------- helpers
let seed = 11;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const rr = (a, b) => a + (b - a) * rnd();
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = u => (u = clamp(u), u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const lerpV = (a, b, u) => a.clone().lerp(b, u);
const col = c => new THREE.Color(c);
const PI = Math.PI;

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = .92;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = FLAGS.includes('vsm') ? THREE.PCFSoftShadowMap : THREE.VSMShadowMap;
const pmrem = new THREE.PMREMGenerator(renderer);

// soft "clay / plastic" Pixar-ish materials
const mat = (color, o = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: .55, sheen: .35, sheenRoughness: .5, sheenColor: col('#ffffff'), ...o });
const matte = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: .8, ...o });
const gloss = (color, o = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: .25, clearcoat: 1, clearcoatRoughness: .12, ...o });
const mesh = (geo, m, { cast = true, recv = true } = {}) => { const x = new THREE.Mesh(geo, m); x.castShadow = cast; x.receiveShadow = recv; return x; };
const sphere = (r, m, ws = 32, hs = 24) => mesh(new THREE.SphereGeometry(r, ws, hs), m);
const rbox = (w, h, d, r, m) => mesh(new RoundedBoxGeometry(w, h, d, 4, r), m);

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// organic smooth blob (rocks, bushes, clouds, islands)
function blobGeo(r, amp = .15, s = 1, ws = 40, hs = 28) {
  const g = new THREE.SphereGeometry(r, ws, hs), p = g.attributes.position, v = new THREE.Vector3();
  const a = rr(0, 9) + s, b = rr(0, 9), c = rr(0, 9);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); const n = v.clone().normalize();
    const d = 1 + amp * (Math.sin(n.x * 3.1 + a) * Math.sin(n.y * 2.7 + b) + .6 * Math.sin(n.z * 4.3 + c) * Math.sin(n.x * 2.2 + a) + .3 * Math.sin(n.y * 7 + c));
    p.setXYZ(i, n.x * r * d, n.y * r * d, n.z * r * d);
  }
  g.computeVertexNormals();
  return g;
}

// tube whose radius follows rf(u)
function taperTube(curve, segs, radial, rf) {
  const geo = new THREE.TubeGeometry(curve, segs, 1, radial, false), pos = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const u = i / segs, c = curve.getPointAt(u), r = rf(u);
    for (let j = 0; j <= radial; j++) { const k = i * (radial + 1) + j; v.fromBufferAttribute(pos, k).sub(c).multiplyScalar(r).add(c); pos.setXYZ(k, v.x, v.y, v.z); }
  }
  geo.computeVertexNormals();
  return geo;
}

function limbBetween(a, b, r, m) {
  const x = mesh(new THREE.CapsuleGeometry(r, a.distanceTo(b), 8, 20), m);
  x.position.copy(a).add(b).multiplyScalar(.5);
  x.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
  return x;
}

function makeSky(top, mid, bot) {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: col(top) }, mid: { value: col(mid) }, bot: { value: col(bot) } },
    vertexShader: 'varying vec3 vp; void main(){ vp = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: `uniform vec3 top, mid, bot; varying vec3 vp;
      void main(){ float h = normalize(vp).y;
        vec3 c = h > 0. ? mix(mid, top, pow(clamp(h*1.5,0.,1.), .55)) : mix(mid, bot, clamp(-h*6.,0.,1.));
        gl_FragColor = vec4(c,1.);
        #include <colorspace_fragment>
      }`
  });
  const s = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), m); s.renderOrder = -10;
  return s;
}

const glowTex = canvasTex(256, 256, (g, w) => {
  const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.25, 'rgba(255,240,210,.55)'); gr.addColorStop(1, 'rgba(255,200,140,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, w);
});
function makeSun(color, r) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16), new THREE.MeshBasicMaterial({ color: col(color).multiplyScalar(2.2), fog: false })));
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
  s.scale.setScalar(r * 8); g.add(s);
  return g;
}

function makeWater(size, seg, color, amp = .25, o = {}) {
  const geo = new THREE.PlaneGeometry(size, size, seg, seg); geo.rotateX(-PI / 2);
  const m = mesh(geo, new THREE.MeshPhysicalMaterial({ color, roughness: .14, metalness: 0, clearcoat: .35, clearcoatRoughness: .08, ior: 1.33, specularIntensity: .45, envMapIntensity: .4, ...o }), { cast: false });
  const pos = geo.attributes.position, base = Float32Array.from(pos.array);
  m.userData.update = t => {
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3], z = base[i * 3 + 2];
      pos.array[i * 3 + 1] = amp * (Math.sin(x * .13 + t * 1.2) + .8 * Math.sin(z * .19 + t * .95) + .35 * Math.sin((x - z) * .41 + t * 2.1) + .2 * Math.sin((x + z) * .9 + t * 2.8));
    }
    pos.needsUpdate = true; geo.computeVertexNormals();
  };
  return m;
}

function baseScene(o) {
  const { top, mid, bot, fog = [60, 600], sun = null, sunPos = V(0, 40, -300) } = o, L = o.light ?? {};
  const scene = new THREE.Scene();
  const sky = makeSky(top, mid, bot); scene.add(sky);
  scene.fog = new THREE.Fog(col(mid), fog[0], fog[1]);
  const env = new THREE.Scene(); env.add(makeSky(top, mid, bot));
  let sunObj = null;
  if (sun) { sunObj = makeSun(sun.color, sun.r); sunObj.position.copy(sunPos); scene.add(sunObj); const s2 = makeSun(sun.color, sun.r * 1.5); s2.position.copy(sunPos).normalize().multiplyScalar(500); env.add(s2); }
  scene.environment = pmrem.fromScene(env, .03, .1, 1000).texture;
  scene.environmentIntensity = L.env ?? .55;
  // key (warm, soft shadow) + fill (sky hemi) + rim (cool, from behind)
  scene.add(new THREE.HemisphereLight(L.sky ?? '#cfe6ff', L.ground ?? '#8a6a4a', L.hemi ?? .55));
  const key = new THREE.DirectionalLight(L.color ?? '#fff0d8', L.dir ?? 2.6);
  key.position.copy(L.pos ?? V(30, 50, 20)); key.castShadow = true;
  const a = L.area ?? 30; Object.assign(key.shadow.camera, { left: -a, right: a, top: a, bottom: -a, near: 1, far: 300 });
  key.shadow.mapSize.set(1024, 1024); key.shadow.radius = (L.soft ?? 8) / 2; key.shadow.blurSamples = 16; key.shadow.bias = -.0004;
  if (L.target) key.target.position.copy(L.target);
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(L.rimColor ?? '#bfe0ff', L.rim ?? 1.1); rim.position.copy(L.rimPos ?? V(-20, 25, -40)); scene.add(rim);
  const cam = new THREE.PerspectiveCamera(o.fov ?? 45, W / H, .1, 2000);
  return { scene, cam, sky, sunObj, updaters: [], focus: V(0, 0, 0), aperture: o.aperture ?? .0015, ao: o.ao ?? 1, bloom: o.bloom ?? [.25, .4, 1.3] };
}

// ---------------------------------------------------------------- post FX
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, vig: { value: .28 }, sat: { value: 1.18 }, warm: { value: V(1.03, 1.0, .965) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float vig, sat; uniform vec3 warm; varying vec2 vUv;
    void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(.299,.587,.114)); c = mix(vec3(l), c, sat) * warm;
      c = c + .025 * (1. - c) * vec3(1., .85, .75);                     // gentle warm lift in the shadows
      vec2 d = (vUv - .5) * vec2(1., 1.25); c *= 1. - vig * smoothstep(.35, .95, length(d) * 1.35);
      gl_FragColor = vec4(c, 1.); }`
};
function makeComposer(S) {
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 });
  const c = new EffectComposer(renderer, rt);
  c.addPass(new RenderPass(S.scene, S.cam));
  // depth-based passes must not see sprites (sun glow, labels) or they turn into solid quads
  const hideSprites = pass => { const r = pass.render.bind(pass); pass.render = (...a) => { const hid = []; S.scene.traverse(o => { if (o.isSprite && o.visible) { o.visible = false; hid.push(o); } }); r(...a); hid.forEach(o => o.visible = true); }; return pass; };
  if (S.ao > 0 && !FLAGS.includes('ao')) {
    const ao = hideSprites(new GTAOPass(S.scene, S.cam, W / 2, H / 2));
    ao.blendIntensity = S.ao; ao.updateGtaoMaterial({ radius: S.aoRadius ?? 1.4, distanceExponent: 1.5, thickness: 2, scale: 1.2, samples: 12 });
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    c.addPass(ao);
    ao.setSize = (w, h) => GTAOPass.prototype.setSize.call(ao, Math.round(w / 2), Math.round(h / 2)); ao.setSize(W, H);
  }
  if (!FLAGS.includes('bloom')) c.addPass(new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), ...S.bloom));
  const bokeh = hideSprites(new BokehPass(S.scene, S.cam, { focus: 10, aperture: S.aperture, maxblur: .005 })); if (S.aperture > 0 && !FLAGS.includes('dof')) c.addPass(bokeh); S.bokeh = bokeh;
  c.addPass(new OutputPass());
  c.addPass(new ShaderPass(GradeShader));
  return c;
}

// ---------------------------------------------------------------- characters & props
function makeEye(r = .13) {
  const g = new THREE.Group();
  g.add(sphere(r, gloss('#ffffff', { roughness: .15 })));
  const iris = sphere(r * .64, gloss('#6b3a1a', { roughness: .2 })); iris.scale.z = .45; iris.position.z = r * .72; g.add(iris);
  const pupil = sphere(r * .38, gloss('#0d0705', { roughness: .1 })); pupil.scale.z = .35; pupil.position.z = r * .84; g.add(pupil);
  const glint = new THREE.Mesh(new THREE.SphereGeometry(r * .15, 16, 12), new THREE.MeshBasicMaterial({ color: '#ffffff' })); glint.position.set(r * .25, r * .28, r * .93); g.add(glint);
  const glint2 = glint.clone(); glint2.scale.setScalar(.5); glint2.position.set(-r * .2, -r * .22, r * .95); g.add(glint2);
  return g;
}
function addLid(eye, r, m) {
  const lid = mesh(new THREE.SphereGeometry(r * 1.13, 32, 16, 0, 2 * PI, 0, PI / 2), m.clone(), { cast: false });
  lid.material.side = THREE.DoubleSide; eye.add(lid); eye.userData.lid = lid; lid.rotation.x = -.62;
  return lid;
}
const blinkAt = (t, period = 3.1, off = 0) => { const k = ((t + off) % period) / .18; return k < 1 ? Math.sin(k * PI) : 0; };

function makeMermaid() {
  const g = new THREE.Group();
  const skin = mat('#ffc690', { roughness: .5, sheen: .5, sheenColor: col('#ff9a6a') });
  const tailM = new THREE.MeshPhysicalMaterial({ color: '#ffb224', metalness: .75, roughness: .28, clearcoat: 1, clearcoatRoughness: .1, iridescence: .25 });
  const hairM = mat('#e68a00', { roughness: .4, sheen: .8, sheenColor: col('#ffd070'), clearcoat: .5 });
  // tail
  const tail = new THREE.Group(); g.add(tail);
  const tc = new THREE.CatmullRomCurve3([V(0, .3, 0), V(.32, .02, .28), V(.8, -.3, .38), V(1.28, -.47, .1), V(1.58, -.38, -.28), V(1.72, -.12, -.58)]);
  tail.add(mesh(taperTube(tc, 80, 32, u => .07 + .3 * Math.pow(1 - u, 1.25) * (1 + .12 * Math.sin(u * PI))), tailM));
  const tip = tc.getPointAt(1), tan = tc.getTangentAt(1);
  const fin = new THREE.Group(); fin.position.copy(tip); fin.quaternion.setFromUnitVectors(V(1, 0, 0), tan); tail.add(fin);
  const lobe = new THREE.Shape(); lobe.moveTo(0, 0); lobe.bezierCurveTo(.15, .12, .45, .32, .62, .2); lobe.bezierCurveTo(.5, .1, .3, .02, 0, 0);
  for (const s of [-1, 1]) {
    const l = mesh(new THREE.ExtrudeGeometry(lobe, { depth: .02, bevelEnabled: true, bevelThickness: .025, bevelSize: .025, bevelSegments: 5, curveSegments: 24 }), tailM);
    l.scale.y = s; l.rotation.x = .3; fin.add(l);
  }
  // torso + coral top
  const torso = mesh(new THREE.LatheGeometry([[0, .1], [.31, .16], [.33, .34], [.24, .6], [.28, .8], [.26, .96], [.15, 1.08], [.08, 1.14], [0, 1.15]].map(([r, y]) => new THREE.Vector2(r, y)), 48), skin);
  torso.scale.z = .82; g.add(torso);
  const top = mesh(new THREE.TorusGeometry(.27, .065, 20, 48), mat('#ff6f91', { sheen: .8 })); top.rotation.x = PI / 2; top.position.y = .84; top.scale.set(1, .82, 1); g.add(top);
  const belt = mesh(new THREE.TorusGeometry(.32, .05, 16, 48), tailM); belt.rotation.x = PI / 2; belt.position.y = .3; belt.scale.set(1, .82, 1); g.add(belt);
  // arms (shoulder -> elbow -> hand)
  const arm = side => {
    const sh = new THREE.Group(); sh.position.set(side * .27, 1.0, 0);
    sh.add(limbBetween(V(0, 0, 0), V(0, -.3, 0), .06, skin));
    const el = new THREE.Group(); el.position.y = -.3; sh.add(el);
    el.add(limbBetween(V(0, 0, 0), V(0, -.28, 0), .055, skin));
    const hand = sphere(.075, skin); hand.position.y = -.33; hand.scale.set(1, 1.15, .7); el.add(hand);
    sh.userData.el = el; g.add(sh); return sh;
  };
  const armR = arm(-1), armL = arm(1);
  // head
  const head = new THREE.Group(); head.position.y = 1.2; g.add(head);
  head.add(limbBetween(V(0, -.1, 0), V(0, .12, 0), .07, skin));
  const skull = sphere(.42, skin, 48, 36); skull.position.y = .44; skull.scale.set(1, .96, .95); head.add(skull);
  const eyes = [-1, 1].map(s => { const e = makeEye(.13); e.position.set(s * .155, .47, .3); e.rotation.y = s * .14; addLid(e, .13, skin); head.add(e); return e; });
  for (const s of [-1, 1]) {
    const brow = mesh(new THREE.TorusGeometry(.08, .016, 8, 16, PI * .8), hairM); brow.position.set(s * .16, .66, .36); brow.rotation.set(-.25, 0, PI * .1 + (s > 0 ? -.15 : .15)); head.add(brow);
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(.07, 24, 16), new THREE.MeshStandardMaterial({ color: '#ff7f86', transparent: true, opacity: .5, roughness: .6 }));
    cheek.position.set(s * .26, .33, .31); cheek.scale.set(1, .7, .35); cheek.lookAt(cheek.position.clone().multiplyScalar(2)); head.add(cheek);
  }
  const nose = sphere(.04, skin); nose.position.set(0, .4, .41); head.add(nose);
  const smile = mesh(new THREE.TorusGeometry(.085, .022, 12, 32, PI), mat('#b23a48', { roughness: .5 }), { cast: false }); smile.position.set(0, .29, .37); smile.rotation.set(-.35, 0, PI); head.add(smile);
  // hair: cap, bangs, long locks, flower
  const cap = mesh(blobGeo(.47, .05), hairM); cap.position.set(0, .54, -.13); cap.scale.set(1.04, 1, 1); head.add(cap);
  head.add(mesh(taperTube(new THREE.CatmullRomCurve3([V(-.36, .66, .18), V(-.1, .86, .33), V(.2, .82, .32), V(.4, .58, .2)]), 40, 20, u => .11 * Math.sin(.15 + u * 2.8) + .02), hairM));
  const locks = new THREE.Group(); head.add(locks);
  locks.add(mesh(taperTube(new THREE.CatmullRomCurve3([V(0, .7, -.32), V(.12, .2, -.5), V(.06, -.35, -.45), V(-.08, -.75, -.32)]), 50, 24, u => .26 * (1 - u) + .05), hairM));
  locks.add(mesh(taperTube(new THREE.CatmullRomCurve3([V(-.34, .55, -.05), V(-.46, .15, .1), V(-.4, -.2, .22), V(-.3, -.42, .26)]), 40, 20, u => .13 * (1 - u) + .035), hairM));
  const flower = new THREE.Group(); flower.position.set(.33, .78, .17);
  for (let i = 0; i < 5; i++) { const p = sphere(.055, mat('#ff8fb3', { sheen: 1 }), 16, 12); const a = i / 5 * 2 * PI; p.position.set(Math.cos(a) * .06, Math.sin(a) * .06, 0); p.scale.z = .5; flower.add(p); }
  const fc = sphere(.035, mat('#ffd84a'), 16, 12); fc.position.z = .02; flower.add(fc); flower.lookAt(V(1, 1.5, 1)); head.add(flower);

  g.userData.animate = (t, { wave = true } = {}) => {
    torso.scale.y = 1 + Math.sin(t * 2.2) * .012;
    head.rotation.z = Math.sin(t * 1.3) * .08; head.rotation.x = Math.sin(t * .9) * .05; head.rotation.y = Math.sin(t * .7) * .12;
    const b = blinkAt(t, 3.2, .7); for (const e of eyes) e.userData.lid.rotation.x = -.62 + b * 1.05;
    for (const e of eyes) { e.children[1].position.x = e.children[2].position.x = Math.sin(t * .8) * .012; }
    locks.rotation.x = Math.sin(t * 1.6) * .05; locks.rotation.z = Math.sin(t * 1.1) * .04;
    tail.rotation.x = Math.sin(t * 1.4) * .04; fin.rotation.x = Math.sin(t * 3) * .25;
    if (wave) { armR.rotation.z = -2.5 + Math.sin(t * 2) * .08; armR.rotation.x = -.2; armR.userData.el.rotation.z = -.35 + Math.sin(t * 8) * .45; }
    else { armR.rotation.z = -.3; armR.userData.el.rotation.z = -.2; }
    armL.rotation.z = .35; armL.rotation.x = .25; armL.userData.el.rotation.z = .3;
  };
  g.userData.animate(0);
  return g;
}

function makeCrab() {
  const g = new THREE.Group(), shell = gloss('#ff5b3a', { roughness: .35, clearcoat: .6 }), leg = mat('#ff7a4f');
  const body = mesh(blobGeo(.36, .04), shell); body.scale.set(1.45, .7, 1.05); body.position.y = .38; g.add(body);
  const eyes = [-1, 1].map(s => { const st = limbBetween(V(s * .16, .55, .2), V(s * .2, .82, .26), .035, leg); g.add(st); const e = makeEye(.09); e.position.set(s * .2, .88, .27); g.add(e); return e; });
  const smile = mesh(new THREE.TorusGeometry(.08, .018, 10, 24, PI), mat('#7a1f12'), { cast: false }); smile.position.set(0, .4, .37); smile.rotation.z = PI; g.add(smile);
  const claws = [-1, 1].map(s => {
    const c = new THREE.Group(); c.position.set(s * .55, .45, .2);
    c.add(limbBetween(V(0, 0, 0), V(s * .22, .18, .12), .05, leg));
    const pincer = mesh(blobGeo(.17, .03), shell); pincer.scale.set(1, .8, .7); pincer.position.set(s * .3, .3, .16); c.add(pincer);
    const jaw = mesh(new THREE.ConeGeometry(.08, .28, 20), shell); jaw.position.set(s * .32, .48, .2); jaw.rotation.z = -s * .4; c.add(jaw);
    c.userData.jaw = jaw; g.add(c); return c;
  });
  const legs = [];
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
    const l = new THREE.Group(); l.position.set(s * .38, .32, -.15 + i * .17);
    l.add(limbBetween(V(0, 0, 0), V(s * .25, .1, 0), .035, leg), limbBetween(V(s * .25, .1, 0), V(s * .38, -.3, 0), .03, leg));
    g.add(l); legs.push(l);
  }
  g.userData.animate = t => {
    legs.forEach((l, i) => l.rotation.z = Math.sin(t * 14 + i * 1.7) * .25);
    claws.forEach((c, i) => { c.rotation.z = Math.sin(t * 3 + i) * .15; c.userData.jaw.rotation.x = Math.max(0, Math.sin(t * 6 + i * 2)) * .5; });
    body.position.y = .38 + Math.abs(Math.sin(t * 14)) * .02;
    eyes.forEach(e => e.scale.y = 1 - blinkAt(t, 2.7, 1.3) * .9);
  };
  return g;
}

function makeGull() {
  const g = new THREE.Group(), white = mat('#ffffff', { sheen: .8 }), grey = mat('#9fb3c8');
  const body = mesh(new THREE.CapsuleGeometry(.35, .9, 10, 20), white); body.rotation.x = PI / 2; g.add(body);
  const head = sphere(.3, white); head.position.set(0, .2, .7); g.add(head);
  const beak = mesh(new THREE.ConeGeometry(.08, .35, 16), mat('#ffb020')); beak.rotation.x = PI / 2; beak.position.set(0, .15, 1.05); g.add(beak);
  for (const s of [-1, 1]) { const e = sphere(.05, gloss('#111')); e.position.set(s * .17, .3, .9); g.add(e); }
  const wings = [-1, 1].map(s => { const w = new THREE.Group(); w.position.set(s * .25, .1, 0); const f = sphere(1, white, 24, 12); f.scale.set(1.1, .06, .42); f.position.x = s * 1; w.add(f); const tipw = sphere(.4, grey, 16, 10); tipw.scale.set(1, .08, .5); tipw.position.x = s * 1.9; w.add(tipw); g.add(w); return w; });
  g.userData.animate = t => { const f = Math.sin(t * 7) * .6; wings[0].rotation.z = -f; wings[1].rotation.z = f; };
  return g;
}

function makeCat(color = '#f2a45a') {
  const g = new THREE.Group(), fur = mat(color, { sheen: 1, sheenColor: col('#fff1d6'), roughness: .7 }), white = mat('#fff7ea', { sheen: 1 });
  const body = mesh(blobGeo(.4, .02), fur); body.scale.set(.9, 1, 1.1); body.position.y = .4; g.add(body);
  const head = new THREE.Group(); head.position.set(0, .95, .2); g.add(head);
  head.add(sphere(.34, fur, 40, 30));
  const muzzle = sphere(.15, white); muzzle.position.set(0, -.08, .27); muzzle.scale.set(1.3, .8, .7); head.add(muzzle);
  for (const s of [-1, 1]) {
    const ear = mesh(new THREE.ConeGeometry(.13, .25, 24), fur); ear.position.set(s * .2, .3, 0); ear.rotation.z = -s * .35; head.add(ear);
    const e = makeEye(.1); e.position.set(s * .13, .06, .27); head.add(e); e.userData.l = addLid(e, .1, fur);
  }
  const nose = sphere(.035, gloss('#ff7f8e')); nose.position.set(0, -.02, .38); head.add(nose);
  const tail = mesh(taperTube(new THREE.CatmullRomCurve3([V(0, .2, -.35), V(.3, .3, -.6), V(.4, .7, -.55), V(.25, 1, -.45)]), 30, 16, u => .08 - .03 * u), fur); g.add(tail);
  for (const s of [-1, 1]) { const p = sphere(.1, white); p.scale.set(1, .6, 1.3); p.position.set(s * .17, .06, .32); g.add(p); }
  g.userData.animate = t => { tail.rotation.y = Math.sin(t * 2) * .35; head.rotation.z = Math.sin(t * 1.1) * .12; head.children.filter(c => c.userData.l).forEach(e => e.userData.l.rotation.x = -.62 + blinkAt(t, 2.9, .4) * 1.05); };
  return g;
}

function cottonTree(s = 1, green = '#58b84f') {
  const g = new THREE.Group();
  const trunk = mesh(taperTube(new THREE.CatmullRomCurve3([V(0, 0, 0), V(.1 * s, 1.2 * s, 0), V(-.05 * s, 2.3 * s, 0)]), 16, 12, u => (.28 - .12 * u) * s), mat('#8a5a3a'));
  g.add(trunk);
  const m = mat(green, { sheen: .9, sheenColor: col('#d8ff9a'), roughness: .75 });
  for (const [x, y, z, r] of [[0, 3, 0, 1.35], [.8, 2.6, .3, .95], [-.75, 2.65, -.2, 1], [.1, 3.7, -.2, .9]]) { const b = mesh(blobGeo(r * s, .07), m); b.position.set(x * s, y * s, z * s); g.add(b); }
  return g;
}
function makePine(h = 7) {
  const g = new THREE.Group(), m = mat('#3f8f4f', { sheen: .6, sheenColor: col('#bfffb0') });
  g.add(mesh(new THREE.CylinderGeometry(.13, .22, h * .55, 16), mat('#7a5034')));
  for (let i = 0; i < 4; i++) { const c = mesh(blobGeo(h * (.22 - i * .035), .06), m); c.scale.y = 1.4; c.position.y = h * (.42 + i * .17); g.add(c); }
  return g;
}
function makePalm(h = 6) {
  const g = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3([V(0, 0, 0), V(.4, h * .5, 0), V(1.2, h, 0)]);
  g.add(mesh(taperTube(curve, 24, 14, u => .26 - .1 * u), mat('#9a7448')));
  const leafM = mat('#3fae5c', { sheen: 1, sheenColor: col('#c8ffb0') });
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * 2 * PI, d = V(Math.cos(a), 0, Math.sin(a));
    const c = new THREE.CatmullRomCurve3([V(1.2, h, 0), V(1.2, h, 0).add(d.clone().multiplyScalar(1.3)).add(V(0, .5, 0)), V(1.2, h, 0).add(d.clone().multiplyScalar(2.6)).add(V(0, -.6, 0))]);
    const leaf = mesh(taperTube(c, 20, 10, u => .32 * Math.sin(u * PI) + .02), leafM); leaf.scale.y = 1; g.add(leaf);
  }
  const nut = mat('#6a4a2a'); for (let i = 0; i < 3; i++) { const n = sphere(.22, nut); n.position.set(1.1 + Math.cos(i * 2) * .25, h - .3, Math.sin(i * 2) * .25); g.add(n); }
  return g;
}
function makeIsland(r, h, green = '#4fae5c', palms = 3) {
  const g = new THREE.Group();
  const top = mesh(blobGeo(r, .12), mat(green, { sheen: .8, sheenColor: col('#d8ffb0') })); top.scale.set(1, h / r, .85); g.add(top);
  const sand = mesh(new THREE.CylinderGeometry(r * 1.06, r * 1.18, .8, 48), mat('#f5dca6')); sand.position.y = -.1; g.add(sand);
  for (let i = 0; i < palms; i++) { const p = makePalm(r * .45); p.position.set(rr(-r * .4, r * .4), h * .75, rr(-r * .3, r * .3)); p.rotation.y = rr(0, 6); g.add(p); }
  return g;
}
function makeRock(scale = 1) {
  const g = new THREE.Group(), m = mat('#8b8fa3', { roughness: .85, sheen: .2 });
  for (const [x, y, z, r, sy] of [[0, 0, 0, 1.8, .8], [1.3, -.25, .5, 1.2, .7], [-1.2, -.3, -.3, 1.3, .65], [.3, -.35, 1.2, 1, .55]]) { const b = mesh(blobGeo(r, .12), m); b.position.set(x, y, z); b.scale.y = sy; g.add(b); }
  g.scale.setScalar(scale);
  return g;
}
function makeClouds(n, area, y, tint = '#ffffff') {
  const g = new THREE.Group(), m = mat(tint, { roughness: 1, sheen: 1, sheenColor: col('#ffffff') });
  for (let i = 0; i < n; i++) {
    const c = new THREE.Group();
    for (let k = 0; k < 5; k++) { const b = mesh(blobGeo(rr(4, 8), .05, k, 24, 16), m, { cast: false }); b.position.set(rr(-9, 9), rr(-1, 2.5), rr(-4, 4)); b.scale.y = .75; c.add(b); }
    c.position.set(rr(-area, area), y + rr(-10, 15), rr(-area * 1.5, -area * .3)); g.add(c);
  }
  return g;
}

function label(text, { color = '#ff5a5f', size = 1.6, dot = true } = {}) {
  const fs = 64, padX = 40, meas = document.createElement('canvas').getContext('2d'); meas.font = `800 ${fs}px K`;
  const w = Math.ceil(meas.measureText(text).width) + padX * 2 + (dot ? 60 : 0), h = 110;
  const tex = canvasTex(w, h, g => {
    g.fillStyle = 'rgba(255,255,255,.97)'; g.beginPath(); g.roundRect(0, 0, w, h, 55); g.fill();
    if (dot) { g.fillStyle = color; g.beginPath(); g.arc(padX + 18, h / 2, 18, 0, 7); g.fill(); }
    g.fillStyle = '#1d2b3a'; g.font = `800 ${fs}px K`; g.textBaseline = 'middle'; g.fillText(text, padX + (dot ? 60 : 0), h / 2 + 4);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, toneMapped: false, fog: false }));
  s.scale.set(size * w / h, size, 1); s.renderOrder = 10;
  return s;
}

// ---------------------------------------------------------------- scenes
function sceneOcean({ cta = false } = {}) {
  seed = cta ? 140 : 3;
  const S = baseScene(cta
    ? { top: '#3a1a6e', mid: '#ff9b78', bot: '#8a3a68', sun: { color: '#ffc27a', r: 26 }, sunPos: V(-30, 24, -420), fog: [90, 700], aperture: .0004, bloom: [.35, .4, 1.5],
        light: { color: '#ffb27a', pos: V(-12, 14, -40), dir: 3, sky: '#ffb6c8', ground: '#4a2050', area: 10, rimColor: '#ff9f7a', rimPos: V(-10, 12, -40), rim: 2.2, target: V(0, 1, 0) } }
    : { top: '#5b86e0', mid: '#ffd2a6', bot: '#ffaf7a', sun: { color: '#fff0c0', r: 24 }, sunPos: V(0, 0, -420), fog: [90, 700], aperture: 0, bloom: [.3, .4, 1.5],
        light: { color: '#ffd8a8', pos: V(-10, 22, -60), dir: 2.4 } });
  const water = makeWater(520, 150, cta ? '#6a4c9c' : '#1f86c4', .32); S.scene.add(water); S.updaters.push(water.userData.update);
  for (const [x, z, r, h] of [[-75, -230, 24, 12], [62, -270, 17, 8], [-18, -340, 13, 6], [115, -190, 10, 5]]) { const i = makeIsland(r, h, cta ? '#5a3d7a' : '#4fae5c', 3); i.position.set(x, 0, z); S.scene.add(i); }
  S.scene.add(makeClouds(9, 220, 70, cta ? '#ffc6b0' : '#fff4ea'));
  const gulls = [];
  for (let i = 0; i < 4; i++) { const b = makeGull(); b.scale.setScalar(cta ? .5 : 1.2); b.userData.o = i * 1.7; b.userData.p = cta ? V(-6 + i * 3, 6 + i, -10 - i * 4) : V(-14 + i * 6, 16 + i * 2, -40 - i * 8); gulls.push(b); S.scene.add(b); }
  let mer, crab;
  if (cta) {
    const rock = makeRock(.9); rock.position.set(0, .1, 0); S.scene.add(rock);
    mer = makeMermaid(); mer.position.set(0, 1.15, 0); mer.rotation.y = .55; S.scene.add(mer);
    crab = makeCrab(); crab.scale.setScalar(.6); crab.position.set(1.5, .95, .9); crab.rotation.y = .3; S.scene.add(crab);
  }
  S.update = (t, u) => {
    for (const f of S.updaters) f(t);
    if (!cta) S.sunObj.position.y = -12 + 70 * ease(clamp(u * 1.15));
    for (const b of gulls) { const d = b.userData; b.userData.animate(t + d.o); b.position.copy(d.p).add(V(t * (cta ? 1.5 : 5), Math.sin(t + d.o) * .6, 0)); b.rotation.set(0, PI / 2, Math.sin(t * .8 + d.o) * .2); }
    if (cta) {
      mer.userData.animate(t); crab.userData.animate(t);
      const e = ease(u);
      S.cam.position.copy(lerpV(V(2.4, 3.1, 4.6), V(5, 5, 15), e)); S.focus.set(0, 2.6, 0); S.cam.lookAt(lerpV(V(0, 2.6, 0), V(-1, 7, -20), e));
    } else {
      S.cam.position.set(Math.sin(u * 2) * 2, 4 + u * 5, 40 - 70 * u); S.cam.lookAt(0, 75 + u * 10, -300); S.focus.set(0, 20, -200);
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
  const S = baseScene({ top: '#5aa0ea', mid: '#d8f0ff', bot: '#b8e2f5', fog: [140, 520], aperture: .0012, ao: 1.2, light: { pos: V(25, 45, 30), dir: 2.6, area: 28, soft: 10 } });
  const table = mesh(new THREE.CylinderGeometry(30, 30, 1, 96), mat('#c98a55', { roughness: .5, clearcoat: .5 })); table.position.y = -3.6; S.scene.add(table);
  const base = mesh(new THREE.CylinderGeometry(22, 22.6, 3, 96), mat('#3a6f95', { roughness: .4 })); base.position.y = -1.55; S.scene.add(base);
  const disc = mesh(new THREE.CircleGeometry(21.98, 96), new THREE.MeshPhysicalMaterial({ color: '#3fb4e6', roughness: .05, clearcoat: 1 }), { cast: false }); disc.rotation.x = -PI / 2; disc.position.y = .02; S.scene.add(disc);
  const shape = new THREE.Shape(MAP.land.map(([x, y]) => new THREE.Vector2(x, y)));
  shape.holes.push(new THREE.Path(MAP.lake.map(([x, y]) => new THREE.Vector2(x, y))));
  const landGeo = new THREE.ExtrudeGeometry(shape, { depth: .8, bevelEnabled: true, bevelSize: .6, bevelThickness: .4, bevelSegments: 6, curveSegments: 24 }); landGeo.rotateX(-PI / 2);
  S.scene.add(mesh(landGeo, [mat('#7fd06a', { sheen: .8, sheenColor: col('#e8ffb0') }), mat('#e6c38a')]));
  const lakeGeo = new THREE.ShapeGeometry(new THREE.Shape(MAP.lake.map(([x, y]) => new THREE.Vector2(x, y)))); lakeGeo.rotateX(-PI / 2);
  const lake = mesh(lakeGeo, new THREE.MeshPhysicalMaterial({ color: '#6fd6f5', roughness: .05, clearcoat: 1 }), { cast: false }); lake.position.y = .5; S.scene.add(lake);
  const koyo = mesh(blobGeo(1.1, .1), mat('#6cc35f')); koyo.scale.y = .5; koyo.position.copy(mp(MAP.pins.koyo, .6)); S.scene.add(koyo);
  for (let i = 0; i < 150; i++) {
    const x = rr(-18, 8), y = rr(-18, 18);
    if (!inPoly(x, y, MAP.land) || inPoly(x, y, MAP.lake) || Math.hypot(x - 4, y - 4) < 2.5 || Math.hypot(x + 2, y + 7) < 3) continue;
    const t = cottonTree(rr(.2, .32), ['#58b84f', '#6cc35f', '#48a845'][i % 3]); t.position.copy(mp([x, y], 1.2)); t.rotation.y = rr(0, 6); S.scene.add(t);
  }
  const pastel = ['#fff3e0', '#ffd6a5', '#cfe3ff', '#ffb5a8', '#d9c7ff'];
  const town = ([cx, cy], n, rad) => { for (let i = 0; i < n; i++) { const h = rr(.5, 2.2), a = rnd() * 7, r = rnd() * rad, b = rbox(.7, h, .7, .12, mat(pastel[i % 5])); b.position.copy(mp([cx + Math.cos(a) * r, cy + Math.sin(a) * r], 1.2 + h / 2)); S.scene.add(b); } };
  town(MAP.pins.hatyai, 26, 2.4); town(MAP.pins.city, 14, 1.6);
  const P = [['city', 'เมืองสงขลา', '#ff5a5f'], ['samila', 'หาดสมิหลา', '#ffb400'], ['koyo', 'เกาะยอ', '#8e5cff'], ['hatyai', 'หาดใหญ่', '#ff2d87'], ['tonngachang', 'น้ำตกโตนงาช้าง', '#1fbf75']];
  const pins = P.map(([k, name, c], i) => {
    const g = new THREE.Group(), m = gloss(c);
    const ball = sphere(.6, m); ball.position.y = 1.9; g.add(ball);
    const cone = mesh(new THREE.ConeGeometry(.45, 1.35, 32), m); cone.rotation.x = PI; cone.position.y = .9; g.add(cone);
    const dot = sphere(.24, gloss('#ffffff')); dot.position.set(0, 1.95, .45); g.add(dot);
    const lb = label(name, { color: c, size: 1.25 }); lb.position.y = 3.4; g.add(lb);
    g.position.copy(mp(MAP.pins[k], k === 'koyo' ? 1.0 : 1.2)); g.userData = { i, base: g.position.y }; S.scene.add(g);
    return g;
  });
  for (const [s, p] of [[label('ทะเลสาบสงขลา', { dot: false, size: 1 }), mp([-4, 9], 2.2)], [label('อ่าวไทย', { dot: false, size: 1.2 }), mp([14, 2], 1.5)]]) { s.position.copy(p); S.scene.add(s); }
  const boat = new THREE.Group(); boat.add(rbox(1.4, .35, .6, .15, mat('#ffffff'))); const sail = mesh(new THREE.ConeGeometry(.4, 1, 3), mat('#ff6f91')); sail.position.y = .7; boat.add(sail); S.scene.add(boat);
  let tube, car, curve;
  if (route) {
    curve = new THREE.CatmullRomCurve3([mp(MAP.pins.hatyai, 1.5), mp([1, -2], 1.6), mp(MAP.pins.city, 1.5), mp(MAP.pins.samila, 1.5), mp([3, 6.5], 1.6), mp([0, 5], 1.2), mp(MAP.pins.koyo, 1.3)]);
    tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 240, .2, 12), new THREE.MeshStandardMaterial({ color: '#ffd84a', emissive: '#ffb400', emissiveIntensity: 1.6 }));
    S.scene.add(tube);
    car = new THREE.Group(); car.add(rbox(.9, .45, .55, .18, gloss('#ff5a5f'))); const cab = rbox(.5, .35, .5, .15, gloss('#ffffff')); cab.position.y = .35; car.add(cab); S.scene.add(car);
  }
  S.update = (t, u) => {
    for (const p of pins) { const d = p.userData, k = clamp((t - .8 - d.i * .35) / .9); const b = k < 1 ? (1 - k) * 14 - Math.sin(k * PI) * 1.2 : 0; p.position.y = d.base + b + (k >= 1 ? Math.sin(t * 2 + d.i) * .12 : 0); p.visible = k > 0; const sq = k >= 1 ? 1 + Math.max(0, Math.sin((t - 1.7 - d.i * .35) * 10)) * .15 * Math.exp(-(t - 1.7 - d.i * .35) * 3) : 1; p.scale.set(sq, 2 - sq, sq); }
    boat.position.set(12 + Math.sin(t * .3) * 3, .25 + Math.sin(t * 2) * .05, -8 + t * .6); boat.rotation.y = 1.2;
    if (route) {
      const k = clamp((t - 1) / 5.2), n = tube.geometry.index.count;
      tube.geometry.setDrawRange(0, Math.floor(n * k / 3) * 3);
      const p = curve.getPoint(Math.max(.001, k)), q = curve.getPoint(Math.min(1, k + .01)); car.position.copy(p).add(V(0, .35, 0)); car.lookAt(q.x, car.position.y, q.z); car.rotateY(PI / 2);
      const a = .6 + u * .9; S.cam.position.set(Math.sin(a) * 38, 36 - u * 6, Math.cos(a) * 38); S.cam.lookAt(0, -2, 2); S.focus.set(0, 1, 0);
    } else {
      const a = -.5 + u * 1.1; S.cam.position.set(Math.sin(a) * 42, 38 - u * 8, Math.cos(a) * 42); S.cam.lookAt(-1, -3, 2); S.focus.set(0, 1, 0);
    }
  };
  return S;
}

function sceneSamila() {
  seed = 5;
  const S = baseScene({ top: '#3d93ea', mid: '#d6f1ff', bot: '#a6e0f0', sun: { color: '#fff4d6', r: 14 }, sunPos: V(-120, 160, -300), fog: [60, 560], aperture: .0005, ao: 1.1, bloom: [.25, .4, 1.05],
    light: { pos: V(-14, 22, 18), dir: 2.8, area: 9, soft: 10, target: V(0, 1, -2), rimPos: V(10, 12, -30), rim: 2 } });
  const water = makeWater(420, 160, '#18a9cf', .18); S.scene.add(water); S.updaters.push(water.userData.update);
  const sandGeo = new THREE.PlaneGeometry(260, 140, 80, 40); sandGeo.rotateX(-PI / 2);
  const sp = sandGeo.attributes.position;
  for (let i = 0; i < sp.count; i++) { const z = sp.getZ(i) + 72; sp.setY(i, -1.2 + .085 * z + Math.sin(sp.getX(i) * .2) * .15); }
  sandGeo.computeVertexNormals();
  const sand = mesh(sandGeo, mat('#f6e0ae', { roughness: 1, sheen: .5, sheenColor: col('#fff6e0') }), { cast: false }); sand.position.z = 72; S.scene.add(sand);
  const rock = makeRock(1); rock.position.set(0, .05, -2); S.scene.add(rock);
  const mer = makeMermaid(); mer.position.set(0, 1.1, -2); mer.rotation.y = .35; S.scene.add(mer);
  const crab = makeCrab(); crab.scale.setScalar(.75); S.scene.add(crab);
  const nu = makeIsland(24, 15, '#46a35a', 4); nu.position.set(-45, 0, -170); S.scene.add(nu);
  const maeo = makeIsland(14, 8, '#56b366', 3); maeo.position.set(30, 0, -200); S.scene.add(maeo);
  for (const [s, p] of [[label('เกาะหนู', { dot: false, size: 6.5 }), V(-45, 24, -170)], [label('เกาะแมว', { dot: false, size: 6 }), V(30, 16, -200)]]) { s.position.copy(p); S.scene.add(s); }
  S.scene.add(makeClouds(7, 160, 60));
  for (let i = 0; i < 24; i++) { const p = makePine(rr(6, 9)); const z = rr(18, 42); p.position.set(rr(-60, 60), -1.2 + .085 * z, z); S.scene.add(p); }
  for (const [c, x, z] of [['#ff5a5f', -8, 9], ['#ffb400', 7, 11], ['#2bb3ff', 14, 7]]) {
    const g = new THREE.Group(); g.add(mesh(new THREE.CylinderGeometry(.06, .06, 2.4, 12), mat('#eee')));
    const top = mesh(new THREE.SphereGeometry(1.6, 32, 12, 0, 2 * PI, 0, PI * .4), mat(c, { side: THREE.DoubleSide })); top.position.y = .2; g.add(top);
    g.position.set(x, -1.2 + .085 * z + 1.1, z); S.scene.add(g);
  }
  const gull = makeGull(); gull.scale.setScalar(.6); S.scene.add(gull);
  S.update = (t, u) => {
    for (const f of S.updaters) f(t);
    mer.userData.animate(t); crab.userData.animate(t); gull.userData.animate(t);
    crab.position.set(2.6 + Math.sin(t * .9) * .9, -1.2 + .085 * 4.5 + .02, 2.5); crab.rotation.y = -.5;
    gull.position.set(-8 + t * 2.2, 6 + Math.sin(t) * .4, -6); gull.rotation.y = PI / 2;
    const a = .85 - u * 1.1, r = 6.6 - u * .8;
    S.cam.position.set(Math.sin(a) * r, 2.7 + Math.sin(u * 3) * .25, -2 + Math.cos(a) * r); S.cam.lookAt(0, 2.25, -2); S.focus.set(0, 2.6, -2);
  };
  return S;
}

function sceneLake() {
  seed = 9;
  const S = baseScene({ top: '#3a1d6e', mid: '#ffa07a', bot: '#a3497a', sun: { color: '#ffc27a', r: 30 }, sunPos: V(40, 20, -460), fog: [100, 720], aperture: 0, bloom: [.4, .4, 1.5],
    light: { color: '#ffae7a', pos: V(30, 20, -80), dir: 2.6, sky: '#ffb3c8', ground: '#3a2050', area: 60, target: V(0, 0, -20), rimColor: '#ff9a8a', rim: 1.6 } });
  const water = makeWater(620, 160, '#7a4a9c', .25); S.scene.add(water); S.updaters.push(water.userData.update);
  for (const [x, z, r, h] of [[-150, -380, 60, 18], [-40, -420, 50, 12], [160, -400, 70, 20], [260, -330, 40, 10]]) { const i = makeIsland(r, h, '#6a3f86', 0); i.position.set(x, 0, z); S.scene.add(i); }
  S.scene.add(makeClouds(8, 260, 80, '#ffb8a8'));
  const deck = new THREE.CatmullRomCurve3([V(-220, 6, -10), V(-80, 10, -30), V(40, 12, -40), V(200, 6, -20)]);
  const concrete = mat('#efe0ea', { roughness: .6 }), lampMat = new THREE.MeshStandardMaterial({ color: '#fff3c0', emissive: '#ffcf70', emissiveIntensity: 6 });
  const N = 140;
  for (let i = 0; i < N; i++) {
    const p = deck.getPoint(i / N), q = deck.getPoint((i + 1) / N), seg = rbox(1, 1, 1, .1, concrete);
    seg.position.copy(p).add(q).multiplyScalar(.5); seg.scale.set(9, .9, p.distanceTo(q) + .2); seg.quaternion.setFromUnitVectors(V(0, 0, 1), q.clone().sub(p).normalize());
    S.scene.add(seg);
    if (i % 3 === 0) { const pil = mesh(new THREE.CylinderGeometry(.6, .9, p.y + 2, 20), concrete); pil.position.set(p.x, (p.y - 2) / 2, p.z); S.scene.add(pil); }
    if (i % 2 === 0) for (const side of [-4.2, 4.2]) {
      const dir = q.clone().sub(p).normalize(), n = V(-dir.z, 0, dir.x).multiplyScalar(side);
      const pole = mesh(new THREE.CylinderGeometry(.06, .06, 2.4, 8), matte('#3a2a40')); pole.position.copy(p).add(n).add(V(0, 1.5, 0)); S.scene.add(pole);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(.3, 16, 12), lampMat); lamp.position.copy(pole.position).add(V(0, 1.3, 0)); S.scene.add(lamp);
    }
  }
  const boats = [];
  for (const [x, z, c] of [[-20, 30, '#ffe7f0'], [25, 55, '#ffd27a'], [-45, 70, '#c9f0ff']]) {
    const b = new THREE.Group();
    const hull = mesh(blobGeo(1, .02), mat('#5a2e4a')); hull.scale.set(3.6, .7, 1.1); b.add(hull);
    const stripe = mesh(new THREE.TorusGeometry(1, .08, 8, 48), mat('#ffd27a')); stripe.rotation.x = PI / 2; stripe.scale.set(3.55, 1.08, 1); stripe.position.y = .3; b.add(stripe);
    const mast = mesh(new THREE.CylinderGeometry(.08, .08, 7, 12), mat('#4a2a3a')); mast.position.y = 3.5; b.add(mast);
    const sail = mesh(new THREE.SphereGeometry(3, 24, 16, 0, PI * .5, PI * .1, PI * .4), mat(c, { side: THREE.DoubleSide })); sail.position.set(-.2, 3.4, 0); sail.scale.set(1.2, 1.3, .5); b.add(sail);
    const lantern = new THREE.Mesh(new THREE.SphereGeometry(.22, 16, 12), lampMat); lantern.position.set(2.2, 1.2, 0); b.add(lantern);
    b.position.set(x, .3, z); b.userData.o = x; boats.push(b); S.scene.add(b);
  }
  const sign = label('สะพานติณสูลานนท์', { color: '#ffb400', size: 4 }); sign.position.set(-40, 22, -26); S.scene.add(sign);
  S.update = (t, u) => {
    for (const f of S.updaters) f(t);
    for (const b of boats) { b.position.y = .4 + Math.sin(t * 1.6 + b.userData.o) * .25; b.rotation.z = Math.sin(t * 1.3 + b.userData.o) * .05; b.position.x = b.userData.o + t * 1.2; }
    const e = ease(u);
    S.cam.position.copy(lerpV(V(-110, 9, 70), V(10, 20, 45), e)); const tg = lerpV(V(-30, 8, -30), V(60, 6, -60), e); S.cam.lookAt(tg); S.focus.copy(tg);
  };
  return S;
}

function facade(color, signText) {
  return canvasTex(512, 768, (g, w, h) => {
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, 'rgba(255,255,255,.12)'); grd.addColorStop(1, 'rgba(0,0,0,.12)'); g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff8ea'; g.fillRect(0, 0, w, 40); g.fillRect(0, 395, w, 26);
    const arch = (x, y, ww, hh, fill) => { g.fillStyle = fill; g.beginPath(); g.moveTo(x, y + hh); g.lineTo(x, y + ww / 2); g.arc(x + ww / 2, y + ww / 2, ww / 2, PI, 0); g.lineTo(x + ww, y + hh); g.closePath(); g.fill(); };
    for (const x of [70, 300]) {
      arch(x - 14, 96, 170, 270, '#fff8ea'); arch(x, 110, 142, 248, '#34505e');
      g.fillStyle = '#ffe6a6'; g.globalAlpha = .35; arch(x + 10, 120, 122, 228, '#ffe6a6'); g.globalAlpha = 1;
      g.fillStyle = '#2f9a74'; g.fillRect(x - 40, 140, 36, 218); g.fillRect(x + 146, 140, 36, 218);
      g.strokeStyle = '#fff8ea'; g.lineWidth = 6; g.beginPath(); g.moveTo(x + 71, 110); g.lineTo(x + 71, 358); g.stroke();
      g.fillStyle = '#d0453a'; for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(x + 20 + k * 34, 372, 13, 0, 7); g.fill(); }
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
  const S = baseScene({ top: '#86c6f5', mid: '#ffe7c2', bot: '#ffe0b0', sun: { color: '#fff1c8', r: 10 }, sunPos: V(-60, 90, -200), fog: [70, 260], aperture: 0, ao: 1.3, bloom: [.25, .4, 1.3],
    light: { color: '#ffd9a8', pos: V(-22, 26, -8), dir: 3, area: 40, soft: 9, target: V(0, 0, 10), rimPos: V(20, 15, -40), rim: 1.2 } });
  const road = mesh(new THREE.PlaneGeometry(10, 200), mat('#8a807a', { roughness: 1 }), { cast: false }); road.rotation.x = -PI / 2; road.position.z = 10; S.scene.add(road);
  for (const x of [-6.5, 6.5]) { const w = rbox(3, .35, 200, .12, mat('#e2cfac')); w.position.set(x, .17, 10); S.scene.add(w); }
  const colors = ['#9fd8c4', '#f6a9a0', '#ffd56b', '#9cc7ea', '#f7b980', '#c9b4e8', '#a8e0a0'];
  const signs = ['โกปี้', 'ขนมบ้าน', 'ร้านน้ำชา', 'ผ้าทอ', 'ของฝาก', 'ติ่มซำ', 'ร้านเก่า'];
  const tex = colors.map((c, i) => facade(c, signs[i]));
  let k = 0;
  for (const side of [-1, 1]) for (let z = 60; z > -50; z -= 6.2) {
    const h = rr(8.5, 10.5), ci = k++ % 7, front = new THREE.MeshPhysicalMaterial({ map: tex[ci], roughness: .8, sheen: .2 }), plain = mat(colors[ci]);
    const mats = side < 0 ? [front, plain, plain, plain, plain, plain] : [plain, front, plain, plain, plain, plain];
    const b = mesh(new RoundedBoxGeometry(8, h, 6, 3, .25), mats); b.position.set(side * 12, h / 2, z); S.scene.add(b);
    const roof = rbox(9, .5, 6.4, .2, mat('#c4523a')); roof.position.set(side * 11.6, h + .5, z); roof.rotation.z = side * -.18; S.scene.add(roof);
    const pot = new THREE.Group(); pot.add(mesh(new THREE.CylinderGeometry(.35, .25, .5, 24), mat('#c96a3a'))); const bush = mesh(blobGeo(.55, .1), mat('#56b04f', { sheen: 1 })); bush.position.y = .55; pot.add(bush); pot.position.set(side * 7.4, .55, z + 2); S.scene.add(pot);
  }
  const lanterns = [], red = new THREE.MeshPhysicalMaterial({ color: '#e53935', emissive: '#ff4a2a', emissiveIntensity: .6, roughness: .45, sheen: .5 }), cap = gloss('#ffd56b');
  for (let z = 50; z > -40; z -= 9) {
    const line = new THREE.CatmullRomCurve3([V(-8, 8.6, z), V(0, 7.2, z), V(8, 8.6, z)]);
    S.scene.add(new THREE.Mesh(new THREE.TubeGeometry(line, 24, .03, 6), matte('#3a2a20')));
    for (let i = 1; i < 8; i++) {
      const p = line.getPoint(i / 8), g = new THREE.Group();
      const body = sphere(.42, red, 32, 20); body.scale.y = 1.25; body.position.y = -.65; g.add(body);
      const c1 = mesh(new THREE.CylinderGeometry(.22, .22, .12, 24), cap); c1.position.y = -.1; g.add(c1);
      const c2 = c1.clone(); c2.position.y = -1.2; g.add(c2);
      g.position.copy(p); g.userData.o = i + z; lanterns.push(g); S.scene.add(g);
    }
  }
  const cat = makeCat(); cat.scale.setScalar(1.1); cat.position.set(-6.2, .35, 22); cat.rotation.y = .9; S.scene.add(cat);
  const bike = new THREE.Group();
  for (const x of [-.7, .7]) { const w = mesh(new THREE.TorusGeometry(.45, .06, 12, 32), mat('#333')); w.position.x = x; bike.add(w); }
  bike.add(limbBetween(V(-.7, 0, 0), V(.2, .6, 0), .045, gloss('#3fa9f5')), limbBetween(V(.2, .6, 0), V(.7, 0, 0), .045, gloss('#3fa9f5')));
  const basket = rbox(.45, .3, .4, .06, mat('#c9955a')); basket.position.set(.8, .75, 0); bike.add(basket);
  bike.position.set(6.2, .8, 14); bike.rotation.y = -PI / 2; S.scene.add(bike);
  S.update = (t, u) => {
    for (const l of lanterns) l.rotation.z = Math.sin(t * 1.8 + l.userData.o) * .12;
    cat.userData.animate(t);
    const z = 46 - u * 36;
    S.cam.position.set(Math.sin(u * 4) * .6, 2.4 + Math.sin(t * 5) * .04 + u * 1.5, z); const tg = V(Math.sin(u * 3) * 2.5 - 1, 4.6, z - 20); S.cam.lookAt(tg); S.focus.set(0, 3, z - 14);
  };
  return S;
}

function windowsTex(lit) {
  return canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    for (let y = 16; y < h; y += 42) for (let x = 14; x < w; x += 40) {
      if (rnd() < lit) { g.fillStyle = rnd() > .3 ? '#ffcf7a' : '#8ff0ff'; g.globalAlpha = rr(.5, 1); g.beginPath(); g.roundRect(x, y, 24, 26, 5); g.fill(); g.globalAlpha = 1; }
    }
  });
}

function sceneHatYai() {
  seed = 45;
  const S = baseScene({ top: '#0a0a2a', mid: '#4a2280', bot: '#1a0a30', fog: [70, 420], aperture: 0, ao: .8, bloom: [.8, .5, .7],
    light: { color: '#a08aff', pos: V(20, 60, 40), dir: .6, sky: '#7a5aff', ground: '#1a0a30', hemi: .5, env: .6, area: 80, rimColor: '#ff6ab0', rim: 1.2 } });
  const ground = mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshPhysicalMaterial({ color: '#160c2c', roughness: .25, clearcoat: 1 }), { cast: false }); ground.rotation.x = -PI / 2; S.scene.add(ground);
  const stars = new THREE.BufferGeometry(), sp = [];
  for (let i = 0; i < 900; i++) { const a = rnd() * 7, e = rr(.15, 1.4), r = 800; sp.push(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r); }
  stars.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  S.scene.add(new THREE.Points(stars, new THREE.PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: false, fog: false })));
  const texs = [windowsTex(.55), windowsTex(.4), windowsTex(.7)];
  for (let gx = -6; gx <= 6; gx++) for (let gz = -14; gz <= 6; gz++) {
    if (Math.abs(gx) < 1) continue;
    const w = rr(7, 11), d = rr(7, 11), h = rr(12, 48) * (Math.abs(gx) < 3 ? 1 : 1.3);
    const tx = texs[(gx + gz + 20) % 3].clone(); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.repeat.set(w / 8, h / 16); tx.needsUpdate = true;
    const side = new THREE.MeshPhysicalMaterial({ color: rnd() > .5 ? '#2a1d58' : '#33246a', emissive: '#ffffff', emissiveMap: tx, emissiveIntensity: 2.2, roughness: .35, clearcoat: .4 });
    const roof = mat('#1c1240');
    const b = mesh(new RoundedBoxGeometry(w, h, d, 2, .5), [side, side, roof, roof, side, side], { cast: false }); b.position.set(gx * 15, h / 2, gz * 15); S.scene.add(b);
  }
  const neon = (txt, c, size) => {
    const tex = canvasTex(1024, 256, (g, w, h) => { g.font = '900 170px K'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.shadowColor = c; g.shadowBlur = 30; g.fillStyle = '#fff'; for (let i = 0; i < 2; i++) g.fillText(txt, w / 2, h / 2 + 10); });
    return new THREE.Mesh(new THREE.PlaneGeometry(size * 4, size), new THREE.MeshBasicMaterial({ map: tex, color: col(c).multiplyScalar(2.5), transparent: true, fog: false, depthWrite: false }));
  };
  const n1 = neon('หาดใหญ่', '#ff4fa0', 9); n1.position.set(-9.6, 34, -40); n1.rotation.y = PI / 2; S.scene.add(n1);
  const n2 = neon('ตลาดกิมหยง', '#4fe8ff', 5); n2.position.set(9.6, 18, -10); n2.rotation.y = -PI / 2; S.scene.add(n2);
  const cars = [], cm = [new THREE.MeshBasicMaterial({ color: col('#ff3a3a').multiplyScalar(3) }), new THREE.MeshBasicMaterial({ color: col('#fff3c0').multiplyScalar(3) })];
  for (let i = 0; i < 40; i++) { const c = new THREE.Mesh(new THREE.CapsuleGeometry(.18, rr(3, 6), 4, 8), cm[i % 2]); c.rotation.x = PI / 2; c.userData = { lane: i % 2 ? 3 : -3, o: rr(0, 300), v: rr(14, 24) * (i % 2 ? -1 : 1) }; c.position.y = .5; cars.push(c); S.scene.add(c); }
  S.update = (t, u) => {
    for (const c of cars) { const d = c.userData; c.position.x = d.lane; c.position.z = ((d.o + t * d.v) % 300 + 300) % 300 - 220; }
    const e = ease(u);
    S.cam.position.copy(lerpV(V(0, 3, 70), V(0, 46, -10), e)); const tg = lerpV(V(0, 12, -40), V(0, 10, -150), e); S.cam.lookAt(tg); S.focus.set(0, 20, S.cam.position.z - 60);
  };
  return S;
}

function sceneFalls() {
  seed = 61;
  const S = baseScene({ top: '#5fb8e8', mid: '#dff7e6', bot: '#bfe8c8', sun: { color: '#fff8e0', r: 10 }, sunPos: V(80, 160, -200), fog: [50, 320], aperture: 0, ao: 1.3, bloom: [.25, .4, 1.3],
    light: { pos: V(24, 46, 34), dir: 2.6, area: 40, soft: 10, target: V(0, 10, -10), rimPos: V(-20, 30, -50), rim: 1.6 } });
  const ground = mesh(new THREE.PlaneGeometry(400, 400), mat('#4f9f4a', { sheen: .6 }), { cast: false }); ground.rotation.x = -PI / 2; S.scene.add(ground);
  const rock = mat('#8f9a8c', { roughness: .9, sheen: .2 }), moss = mat('#5fae4f', { sheen: 1, sheenColor: col('#dfffa0') });
  const flowTex = canvasTex(128, 512, (g, w, h) => {
    g.fillStyle = 'rgba(225,250,255,.9)'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 80; i++) { g.fillStyle = rnd() > .5 ? 'rgba(255,255,255,.95)' : 'rgba(150,215,240,.6)'; g.beginPath(); g.roundRect(rr(0, w), rr(0, h), rr(3, 9), rr(30, 120), 4); g.fill(); }
  });
  flowTex.wrapS = flowTex.wrapT = THREE.RepeatWrapping;
  const waterMat = new THREE.MeshPhysicalMaterial({ map: flowTex, transparent: true, opacity: .93, roughness: .1, clearcoat: 1, emissive: '#cff4ff', emissiveIntensity: .12, side: THREE.DoubleSide });
  const poolMat = new THREE.MeshPhysicalMaterial({ color: '#5fd0ea', roughness: .05, clearcoat: 1 });
  for (let i = 0; i < 7; i++) {
    const y = i * 3.6, z = -i * 4, w = 18 - i * 1.4;
    const tier = rbox(w + 10, 3.6, 5, .9, rock); tier.position.set(0, y + 1.8, z - 2.5); S.scene.add(tier);
    const mo = rbox(w + 10.2, .5, 5.1, .25, moss); mo.position.set(0, y + 3.5, z - 2.5); S.scene.add(mo);
    for (const sx of [-1, 1]) { const bl = mesh(blobGeo(rr(2.2, 3.4), .15), rock); bl.position.set(sx * (w / 2 + rr(4, 6)), y + 3.2, z - 2); S.scene.add(bl); }
    const fw = w * .55, fall = new THREE.Mesh(new THREE.PlaneGeometry(fw, 3.75, 1, 1), waterMat); fall.position.set(0, y + 1.85, z + .05); S.scene.add(fall);
    const pool = mesh(new THREE.BoxGeometry(fw + 1.5, .15, 3.6), poolMat, { cast: false }); pool.position.set(0, y + 3.8, z - 2.4); S.scene.add(pool);
    const lab = label(`ชั้น ${i + 1}`, { color: '#1fbf75', size: 1.1 }); lab.position.set(w / 2 + 2, y + 4.6, z); S.scene.add(lab);
  }
  const pond = mesh(new THREE.CylinderGeometry(14, 14, .3, 64), poolMat, { cast: false }); pond.position.set(0, .1, 6); S.scene.add(pond);
  for (let i = 0; i < 90; i++) {
    const x = rr(-80, 80), z = rr(-90, 30); if (Math.abs(x) < 20 && z > -32 && z < 22) continue;
    const t = cottonTree(rr(1.2, 2.2), ['#4fae4a', '#63c15a', '#3f9a44'][i % 3]); t.position.set(x, Math.max(0, (-z - 10) * .35) * (Math.abs(x) < 40 ? 1 : .6), z); t.rotation.y = rr(0, 6); S.scene.add(t);
  }
  for (const [x, z, r, h] of [[-60, -80, 40, 34], [60, -90, 45, 40], [0, -125, 60, 45]]) { const m = mesh(blobGeo(r, .08), mat('#3f8f48', { sheen: .8 })); m.scale.y = h / r; m.position.set(x, 0, z); S.scene.add(m); }
  const mist = [];
  for (let i = 0; i < 10; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: .35, depthWrite: false })); s.position.set(rr(-7, 7), rr(.5, 3), rr(1, 5)); s.scale.setScalar(rr(5, 9)); s.userData.o = rnd() * 6; mist.push(s); S.scene.add(s); }
  const flies = [];
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Group(), wm = mat(['#ffb3de', '#9fd8ff', '#ffe08a', '#c9a8ff'][i], { side: THREE.DoubleSide, sheen: 1 });
    const wl = sphere(.35, wm, 16, 10); wl.scale.set(1, .08, .8); wl.position.x = -.3; const wr = wl.clone(); wr.position.x = .3;
    const gl = new THREE.Group(); gl.add(wl); const gr = new THREE.Group(); gr.add(wr); b.add(gl, gr, sphere(.07, matte('#333'), 12, 8));
    b.userData = { gl, gr, o: i * 1.3, x: rr(-10, 10), y: rr(6, 14), z: rr(4, 12) }; flies.push(b); S.scene.add(b);
  }
  S.update = (t, u) => {
    flowTex.offset.y = t * 1.4;
    for (const m of mist) m.material.opacity = .25 + .15 * Math.sin(t * 2 + m.userData.o);
    for (const f of flies) { const d = f.userData; f.position.set(d.x + Math.sin(t * .7 + d.o) * 3, d.y + Math.sin(t * 1.3 + d.o), d.z + Math.cos(t * .6 + d.o) * 2); const fl = Math.sin(t * 16 + d.o) * .8; d.gl.rotation.z = fl; d.gr.rotation.z = -fl; }
    const e = ease(u), a = -.35 + e * .6;
    S.cam.position.set(Math.sin(a) * 52, 8 + e * 16, 6 + Math.cos(a) * 48); S.cam.lookAt(0, 11 + e * 3, -12); S.focus.set(0, 10, -8);
  };
  return S;
}

function sceneFood() {
  seed = 88;
  const S = baseScene({ top: '#ff8a4a', mid: '#ffd99a', bot: '#ffb36b', fog: [60, 400], aperture: .0008, ao: 1.2, bloom: [.2, .4, 1.3], light: { pos: V(10, 30, 30), dir: 2.4, area: 20, soft: 12 } });
  const floor = mesh(new THREE.CylinderGeometry(14, 14, .6, 96), mat('#fff3dc', { sheen: .8 })); floor.position.y = -.3; S.scene.add(floor);
  const cloth = mesh(new THREE.CylinderGeometry(10, 10, .05, 96), mat('#ff6f61', { sheen: 1 })); cloth.position.y = .02; S.scene.add(cloth);
  const dishes = [['🍗', 'ไก่ทอดหาดใหญ่', 'กรอบนอก นุ่มใน'], ['🥟', 'ติ่มซำ', 'มื้อเช้าสไตล์หาดใหญ่'], ['🫓', 'โรตี–ชาชัก', 'คู่หูยามเช้า'], ['🦐', 'ซีฟู้ดทะเลสาบ', 'กุ้ง ปู ปลากะพง'], ['🍚', 'ข้าวยำปักษ์ใต้', 'สมุนไพรเพียบ'], ['🍮', 'ขนมพื้นเมือง', 'ร้านเก่าแก่เมืองเก่า']];
  const ring = new THREE.Group(); S.scene.add(ring);
  dishes.forEach(([e, name, sub], i) => {
    const tex = canvasTex(600, 760, (g, w, h) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff1d6'; g.beginPath(); g.arc(w / 2, 270, 190, 0, 7); g.fill();
      g.font = '230px "Noto Color Emoji"'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(e, w / 2, 285);
      g.fillStyle = '#4a1d00'; g.font = '800 68px K'; g.fillText(name, w / 2, 560);
      g.fillStyle = '#a0521c'; g.font = '400 44px K'; g.fillText(sub, w / 2, 650);
    });
    const card = new THREE.Group();
    const back = rbox(4.5, 5.6, .35, .17, gloss('#ff8a3d')); card.add(back);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(4.1, 5.2), new THREE.MeshPhysicalMaterial({ map: tex, roughness: .35, clearcoat: .6 })); front.position.z = .18; card.add(front);
    const a = i / 6 * PI * 2; card.position.set(Math.sin(a) * 7.2, 3.4, Math.cos(a) * 7.2); card.rotation.y = a; card.userData.i = i;
    ring.add(card);
  });
  const conf = [];
  for (let i = 0; i < 70; i++) { const c = rbox(.32, .32, .07, .03, gloss(['#ff5a5f', '#ffb400', '#2bb3ff', '#1fbf75', '#ffffff'][i % 5])); c.castShadow = false; c.position.set(rr(-14, 14), rr(0, 18), rr(-14, 10)); c.userData = { o: rnd() * 6, s: rr(.5, 1.5) }; conf.push(c); S.scene.add(c); }
  S.update = (t, u) => {
    ring.rotation.y = -u * PI * 2 * .85 + .2;
    ring.children.forEach(c => { c.position.y = 3.4 + Math.sin(t * 2 + c.userData.i) * .25; });
    for (const c of conf) { c.rotation.set(t * c.userData.s, t * c.userData.s * .7, 0); c.position.y = 18 - ((t * c.userData.s * 2 + c.userData.o * 3) % 18); }
    S.cam.position.set(0, 9, 27); S.cam.lookAt(0, 2.2, 0); S.focus.set(0, 3.4, 7.2);
  };
  return S;
}

function scenePlane() {
  seed = 99;
  const S = baseScene({ top: '#2d6fe0', mid: '#a8dcff', bot: '#eef8ff', sun: { color: '#fffbe8', r: 14 }, sunPos: V(-150, 120, -300), fog: [80, 520], aperture: 0, ao: 1, bloom: [.25, .4, 1.3],
    light: { pos: V(-30, 50, 20), dir: 2.8, area: 18, soft: 10, rimPos: V(30, 10, -30), rim: 1.8 } });
  const white = gloss('#ffffff', { roughness: .3 }), blue = gloss('#2d6fe0'), yellow = gloss('#ffc83a');
  const plane = new THREE.Group();
  const body = mesh(new THREE.CapsuleGeometry(1.15, 8, 16, 40), white); body.rotation.x = PI / 2; plane.add(body);
  const stripe = mesh(new THREE.CapsuleGeometry(1.17, 6, 8, 40), blue); stripe.rotation.x = PI / 2; stripe.scale.set(1, 1, .2); stripe.position.y = -.25; plane.add(stripe);
  const wing = rbox(14, .3, 2.6, .14, white); wing.position.set(0, -.2, .5); plane.add(wing);
  for (const s of [-1, 1]) { const tipw = sphere(.25, yellow); tipw.position.set(s * 7, -.2, .5); plane.add(tipw); }
  const tail = rbox(.3, 3, 2.2, .14, blue); tail.position.set(0, 1.8, 4.9); tail.rotation.x = -.4; plane.add(tail);
  const htail = rbox(5, .2, 1.4, .1, white); htail.position.set(0, .4, 5.2); plane.add(htail);
  for (const x of [-3.2, 3.2]) { const e = mesh(new THREE.CylinderGeometry(.55, .5, 2, 32), yellow); e.rotation.x = PI / 2; e.position.set(x, -.75, -.2); plane.add(e); }
  // the plane's face: big windshield eyes + smile (Pixar-style)
  for (const s of [-1, 1]) { const e = makeEye(.42); e.position.set(s * .5, .55, -4.55); e.rotation.y = PI + s * -.25; e.rotation.x = -.15; e.scale.z = .7; plane.add(e); }
  const smile = mesh(new THREE.TorusGeometry(.45, .07, 12, 32, PI), mat('#1d2b3a'), { cast: false }); smile.position.set(0, -.35, -5.15); smile.rotation.set(-.3, PI, PI); plane.add(smile);
  S.scene.add(plane);
  const clouds = [], cm = mat('#ffffff', { roughness: 1, sheen: 1, sheenColor: col('#ffffff') });
  for (let i = 0; i < 46; i++) {
    const c = new THREE.Group();
    for (let k = 0; k < 6; k++) { const s = mesh(blobGeo(rr(3, 7), .05, k, 28, 18), cm, { cast: false }); s.position.set(rr(-9, 9), rr(-1, 2.5), rr(-5, 5)); c.add(s); }
    c.position.set(rr(-120, 120), rr(-28, -12), rr(-300, 60)); c.userData.z = c.position.z; clouds.push(c); S.scene.add(c);
  }
  const sea = mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshPhysicalMaterial({ color: '#3a9ad8', roughness: .2, clearcoat: 1 }), { cast: false }); sea.rotation.x = -PI / 2; sea.position.y = -60; S.scene.add(sea);
  S.update = (t, u) => {
    for (const c of clouds) c.position.z = ((c.userData.z + 300 + t * 45) % 360) - 300;
    plane.rotation.z = Math.sin(t * .8) * .12; plane.position.y = Math.sin(t * 1.1) * .6;
    plane.children.forEach(c => { if (c.userData.lid === undefined && c.children.length === 5) c.scale.y = 1 - blinkAt(t, 2.6, .5) * .9; });
    const a = 2.6 - u * 1.3;
    S.cam.position.set(Math.sin(a) * 20, 4 + u * 3, Math.cos(a) * 20); S.cam.lookAt(0, .5, -1); S.focus.set(0, 0, -2);
  };
  return S;
}

// ---------------------------------------------------------------- timeline
export const SCENES = [];
const DEFS = [[0, 6, () => sceneOcean()], [6, 7, () => sceneMap()], [13, 7, sceneSamila], [20, 7, sceneLake], [27, 7, sceneOldTown], [34, 7, sceneHatYai], [41, 7, sceneFalls], [48, 7, sceneFood], [55, 7, () => sceneMap({ route: true })], [62, 6, scenePlane], [68, 7, () => sceneOcean({ cta: true })]];
export async function build() { for (const [s, d] of DEFS) SCENES.push({ s, d, S: null }); }

let active = null, composer = null;
function activate(x) {
  if (active === x) return;
  if (active) { active.S.scene.traverse(o => { o.geometry?.dispose?.(); }); composer?.dispose?.(); active.S = null; }
  seed = 11;
  x.S = DEFS.find(d => d[0] === x.s)[2]();
  composer = makeComposer(x.S);
  active = x;
}

const fadeEl = document.getElementById('fade');
export function renderAt(t) {
  let sc = SCENES[SCENES.length - 1];
  for (const x of SCENES) if (t >= x.s && t < x.s + x.d) { sc = x; break; }
  activate(sc);
  const S = sc.S, lt = t - sc.s, u = clamp(lt / sc.d);
  S.update(lt, u);
  S.sky.position.copy(S.cam.position);
  S.cam.updateMatrixWorld();
  S.bokeh.uniforms.focus.value = S.cam.position.distanceTo(S.focus);
  composer.render();
  let f = clamp(1 - t / .5);
  for (const x of SCENES.slice(1)) f = Math.max(f, clamp(1 - Math.abs(t - x.s) / .3));
  f = Math.max(f, clamp((t - (TOTAL - .8)) / .8));
  fadeEl.style.opacity = f;
}
