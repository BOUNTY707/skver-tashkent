import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { places } from './places.js';

export function initWorld(currentUser) {
  // Переиспользуем сокет, открытый ещё на главной странице (ui.js)
  const socket = window._skverSocket || io({ transports: ['polling', 'websocket'], reconnection: true });
  window._skverSocket = socket;
  const statusEl = document.getElementById('avatar-status');

  // ─── SCENE ────────────────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xb8dff5, 90, 220);

  // Sky gradient
  const skyGeo = new THREE.SphereGeometry(180, 16, 8);
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color(0x0f4a9e) }, bottom: { value: new THREE.Color(0x7ab8e8) } },
    vertexShader: `varying vec3 vPos; void main(){vPos=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec3 vPos;uniform vec3 top,bottom;void main(){float t=clamp((normalize(vPos).y+.2)/1.2,0.,1.);gl_FragColor=vec4(mix(bottom,top,t),1.);}`,
    side: THREE.BackSide
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, .1, 200);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.45;
  document.body.appendChild(renderer.domElement);

  // Lights
  const hemi = new THREE.HemisphereLight(0xfff4e0, 0x7ca36d, 1.8); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff8e8, 3.2);
  sun.position.set(-12, 28, 16);
  sun.castShadow = true;
  sun.shadow.camera.left = -38; sun.shadow.camera.right = 38;
  sun.shadow.camera.top = 38; sun.shadow.camera.bottom = -38;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.001;
  scene.add(sun);
  const lampLights = [];
  const buildingLights = [];
  const buildingMaterials = [];
  const playerLight = new THREE.PointLight(0xffeedd, 0, 7, 2);
  playerLight.position.y = 1.0;
  scene.add(playerLight);

  // ─── MATERIALS & HELPERS ─────────────────────────────────────────────────
  const mat = (c, r = .85) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
  const box = (p, w, h, d, x, y, z, m, cast = true, rec = true) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    o.position.set(x, y, z); o.castShadow = cast; o.receiveShadow = rec; p.add(o); return o;
  };

  // Canvas texture for building windows — nearly all lit, warm yellow
  function makeWinTex(wallHex, rows, cols) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 512;
    const ctx = c.getContext('2d');
    ctx.fillStyle = wallHex; ctx.fillRect(0, 0, 256, 512);
    const cw = 256 / cols, ch = 512 / rows;
    for (let r = 0; r < rows; r++) for (let cl = 0; cl < cols; cl++) {
      const on = Math.random() > 0.07;
      ctx.fillStyle = on ? '#fffde0' : '#172232';
      ctx.fillRect(cl * cw + cw * .12, r * ch + ch * .12, cw * .76, ch * .76);
    }
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; return tx;
  }

  // Sign label texture
  function signTex(text, bg = '#243b53') {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.roundRect(16, 24, 992, 208, 40); ctx.fill();
    ctx.font = 'bold 78px "Segoe UI", Arial, sans-serif'; ctx.fillStyle = 'white';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 6;
    ctx.fillText(text.length > 22 ? text.slice(0, 20) + '…' : text, 512, 132);
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
    tx.minFilter = THREE.LinearMipmapLinearFilter; tx.generateMipmaps = true; return tx;
  }
  function label(t, x, y, z, bg = '#243b53', s = 3.5) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTex(t, bg), transparent: true, fog: false, depthWrite: false, sizeAttenuation: true }));
    sp.position.set(x, y, z); sp.scale.set(s, s * 0.25, 1); scene.add(sp); labels.push(sp); return sp;
  }
  function nameSprite(n, gender) {
    const bg = gender === 'female' ? '#7c3a6e' : '#111827';
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTex(n, bg), transparent: true, depthTest: false, fog: false, depthWrite: false }));
    sp.scale.set(2.6, 0.65, 1); return sp;
  }
  function setName(g, n, gender) {
    g.userData.name = n;
    const bg = gender === 'female' ? '#7c3a6e' : '#111827';
    if (g.userData.nameLabel) {
      g.userData.nameLabel.material.map = signTex(n, bg);
      g.userData.nameLabel.material.needsUpdate = true;
    }
  }

  // ─── GROUND & PATHS ───────────────────────────────────────────────────────
  // Grass ground with texture
  function grassTex() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 512;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#5dab47'; ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 4000; i++) {
      ctx.fillStyle = `hsl(${110 + Math.random() * 20}, ${50 + Math.random() * 30}%, ${30 + Math.random() * 20}%)`;
      ctx.fillRect(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 2, 3 + Math.random() * 3);
    }
    const tx = new THREE.CanvasTexture(c); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.repeat.set(8, 8);
    tx.colorSpace = THREE.SRGBColorSpace; return tx;
  }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(84, 68), new THREE.MeshStandardMaterial({ map: grassTex(), roughness: .95 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  // Sandy path
  const pm = new THREE.MeshStandardMaterial({ color: 0xe8d5a0, roughness: .9 });
  const path = (x, z, w, d, r = 0) => {
    const p = new THREE.Mesh(new THREE.BoxGeometry(w, .07, d), pm);
    p.position.set(x, .035, z); p.rotation.y = r; p.receiveShadow = true; scene.add(p);
  };
  path(0, 0, 3.5, 30); path(0, 0, 30, 3.5);
  path(0, 0, 2.8, 32, Math.PI / 4); path(0, 0, 2.8, 32, -Math.PI / 4);

  // Central plaza
  const plaza = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 5.5, .1, 64), new THREE.MeshStandardMaterial({ color: 0xe8d5a0, roughness: .85 }));
  plaza.position.y = .05; plaza.receiveShadow = true; scene.add(plaza);

  // Plaza border ring
  const ring = new THREE.Mesh(new THREE.TorusGeometry(5.5, .15, 8, 64), mat(0xb5a070, .8));
  ring.position.y = .1; ring.rotation.x = Math.PI / 2; scene.add(ring);

  // ─── TREES ────────────────────────────────────────────────────────────────
  function addTree(x, z, scale = 1) {
    const g = new THREE.Group();
    // Trunk with natural base flare
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.09 * scale, .17 * scale, 1.55 * scale, 8), mat(0x6b4226, .96));
    trunk.position.y = .77 * scale; trunk.castShadow = true; g.add(trunk);
    const flare = new THREE.Mesh(new THREE.CylinderGeometry(.19 * scale, .27 * scale, .24 * scale, 8), mat(0x5a3820, .97));
    flare.position.y = .12 * scale; flare.castShadow = true; g.add(flare);
    // Canopy — 7 overlapping sphere clusters (deciduous park tree)
    const lc = [0x2d8a2d, 0x3a9a3a, 0x246e24, 0x4aaa30, 0x358032, 0x2e7e2e];
    const clusters = [
      [0,           1.52 * scale, 0,            .82 * scale],
      [.28 * scale, 1.70 * scale, .18 * scale,  .63 * scale],
      [-.26 * scale, 1.62 * scale, .22 * scale, .61 * scale],
      [.22 * scale, 1.97 * scale, -.22 * scale, .57 * scale],
      [-.20 * scale, 1.90 * scale, -.20 * scale, .55 * scale],
      [.08 * scale, 2.20 * scale, .10 * scale,  .50 * scale],
      [0,           2.38 * scale, 0,            .42 * scale],
    ];
    clusters.forEach(([cx, cy, cz, cr], i) => {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(cr, 8, 6), mat(lc[i % lc.length], .88));
      leaf.position.set(cx, cy, cz); leaf.castShadow = true; g.add(leaf);
    });
    // Deterministic rotation so trees don't all face same way
    g.rotation.y = (x * 7.3 + z * 3.1) % (Math.PI * 2);
    g.position.set(x, 0, z); scene.add(g);
  }
  // Skip trees on paths, fountain, plaza, or too close to buildings
  function nearBuilding(x, z) {
    return (
      (Math.abs(x + 15)   < 4.5 && Math.abs(z - 5.5)  < 4.0) ||
      (Math.abs(x + 8.8)  < 4.5 && Math.abs(z - 13)   < 4.0) ||
      (Math.abs(x + 15)   < 6.0 && Math.abs(z + 13)   < 4.0) ||
      (Math.abs(x - 13.5) < 5.0 && Math.abs(z + 10.5) < 4.0) ||
      // football stadium — large footprint, keep trees/lamps off it
      (Math.abs(x - 23)   < 9.5 && Math.abs(z - 6)    < 8.5)
    );
  }
  function onPath(x, z) {
    // N-S yolak (x≈0, kenglik 3.5, uzunlik 30)
    if (Math.abs(x) < 2.1 && Math.abs(z) < 15.5) return true;
    // E-W yolak (z≈0, kenglik 3.5, uzunlik 30)
    if (Math.abs(z) < 2.1 && Math.abs(x) < 15.5) return true;
    // 45° diagonal yolak — |x−z|/√2 < 1.4, uzunlik 32
    if (Math.abs(x - z) < 2.85 && Math.abs(x + z) < 22.6) return true;
    // −45° diagonal yolak — |x+z|/√2 < 1.4
    if (Math.abs(x + z) < 2.85 && Math.abs(x - z) < 22.6) return true;
    // Fountain (0, −8.5), radius ≈ 2.0
    if (Math.hypot(x, z + 8.5) < 2.6) return true;
    // Markaziy plaza (0,0), radius 5.5
    if (Math.hypot(x, z) < 6.1) return true;
    return false;
  }
  // Inner ring (r=8.5) — yolak/fontan/bino ustida bo'lmagan daraxtlar
  for (let i = 0; i < 28; i++) {
    const a = i / 28 * Math.PI * 2;
    const tx = Math.cos(a) * 8.5, tz = Math.sin(a) * 8.5;
    if (!onPath(tx, tz) && !nearBuilding(tx, tz)) addTree(tx, tz, 0.88 + (i % 5) * 0.04);
  }
  // Outer ring (r=17.5) — bino yoki yolak ustida bo'lmagan daraxtlar
  for (let i = 0; i < 36; i++) {
    const a = i / 36 * Math.PI * 2;
    const tx = Math.cos(a) * 17.5, tz = Math.sin(a) * 17.5;
    if (!nearBuilding(tx, tz) && !onPath(tx, tz)) addTree(tx, tz, 1.08 + (i % 7) * 0.05);
  }
  // Boundary trees framing the (enlarged) ground — skip stadium/buildings
  for (const [x, z, sc] of [
    [-32, -26, 1.4], [0, -26, 1.36], [32, -26, 1.4],
    [-32, 26, 1.4],  [0, 26, 1.36],  [32, 26, 1.4],
    [-32, -13, 1.3], [-32, 0, 1.32], [-32, 13, 1.3],
    [32, -13, 1.3],  [32, 0, 1.34],  [32, 13, 1.3],
    [-18, -26, 1.28],[18, -26, 1.28],[-18, 26, 1.28],[18, 26, 1.28],
  ]) { if (!nearBuilding(x, z)) addTree(x, z, sc); }

  // ─── BUSHES ───────────────────────────────────────────────────────────────
  function addBush(x, z, color = 0x2d8a2d) {
    const g = new THREE.Group();
    const c = new THREE.Color(color);
    const dark = c.clone().multiplyScalar(.72);
    const light = c.clone().lerp(new THREE.Color(0xffffff), .14);
    const mats = [mat(c.getHex(), .88), mat(dark.getHex(), .92), mat(light.getHex(), .85)];
    // 7 overlapping clusters forming a natural rounded mound
    const cls = [
      [0,    .30, 0,    .34, 0],
      [.22,  .24, .12,  .27, 1],
      [-.20, .24, .15,  .26, 2],
      [.14,  .24, -.19, .25, 1],
      [-.14, .24, -.17, .25, 0],
      [0,    .47, 0,    .22, 2],
      [.10,  .38, .10,  .18, 1],
    ];
    cls.forEach(([cx, cy, cz, cr, mi]) => {
      const b = new THREE.Mesh(new THREE.SphereGeometry(cr, 7, 5), mats[mi]);
      b.position.set(cx, cy, cz); b.castShadow = true; g.add(b);
    });
    g.rotation.y = (x * 5.7 + z * 2.9) % (Math.PI * 2);
    g.position.set(x, 0, z); scene.add(g);
  }
  for (let i = 0; i < 25; i++) {
    const a = i / 25 * Math.PI * 2;
    addBush(Math.cos(a) * 6.5, Math.sin(a) * 6.5, i % 3 === 0 ? 0x8b0000 : 0x2a7a2a);
  }

  // ─── BENCHES ──────────────────────────────────────────────────────────────
  function addBench(x, z, ry = 0) {
    if (nearBuilding(x, z)) return; // bino/stadion ustiga skameyka qo'yilmaydi
    const g = new THREE.Group();
    box(g, 1.6, .09, .5, 0, .48, 0, mat(0x8b5e3c, .9));
    box(g, 1.6, .5, .07, 0, .76, -.22, mat(0x8b5e3c, .9));
    [-.68, .68].forEach(lx => { box(g, .08, .52, .44, lx, .26, 0, mat(0x3a3a3a, .8)); });
    g.position.set(x, 0, z); g.rotation.y = ry; g.castShadow = true; scene.add(g);
  }
  // Pairs along N-S path (between tree rings)
  [-2.2, 2.2].forEach(sx => addBench(sx, -10.5, sx < 0 ? Math.PI / 2 : -Math.PI / 2));
  [-2.2, 2.2].forEach(sx => addBench(sx,  10.5, sx < 0 ? Math.PI / 2 : -Math.PI / 2));
  // Pairs along E-W path (between tree rings)
  [-2.2, 2.2].forEach(sz => addBench(-10.5, sz, sz < 0 ? 0 : Math.PI));
  [-2.2, 2.2].forEach(sz => addBench( 10.5, sz, sz < 0 ? 0 : Math.PI));
  // Outer pairs — south, north, west, east (beyond outer tree ring)
  [-2.2, 2.2].forEach(sx => addBench(sx, -21.5, sx < 0 ? Math.PI / 2 : -Math.PI / 2));
  [-2.2, 2.2].forEach(sx => addBench(sx,  21.5, sx < 0 ? Math.PI / 2 : -Math.PI / 2));
  [-2.2, 2.2].forEach(sz => addBench(-21.5, sz, sz < 0 ? 0 : Math.PI));
  [-2.2, 2.2].forEach(sz => addBench( 21.5, sz, sz < 0 ? 0 : Math.PI));

  // ─── BILLBOARDS ──────────────────────────────────────────────────────────
  function makeAdTex(bg1, bg2, brand, tagline, logoLetter) {
    const W = 512, H = 288;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const cx = cv.getContext('2d');
    const grd = cx.createLinearGradient(0, 0, W, H);
    grd.addColorStop(0, bg1); grd.addColorStop(1, bg2);
    cx.fillStyle = grd; cx.fillRect(0, 0, W, H);
    // Subtle vertical stripe texture
    cx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < W; i += 80) cx.fillRect(i, 0, 40, H);
    // Logo circle top-right
    cx.fillStyle = 'rgba(255,255,255,0.18)';
    cx.beginPath(); cx.arc(W - 68, 66, 52, 0, Math.PI * 2); cx.fill();
    cx.fillStyle = 'white'; cx.font = 'bold 40px sans-serif';
    cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.fillText(logoLetter, W - 68, 66);
    cx.textAlign = 'left'; cx.textBaseline = 'alphabetic';
    // Brand name
    cx.font = 'bold 66px sans-serif'; cx.fillStyle = 'white';
    cx.shadowColor = 'rgba(0,0,0,0.55)'; cx.shadowBlur = 14;
    cx.fillText(brand, 22, 158);
    // Tagline
    cx.font = '30px sans-serif'; cx.shadowBlur = 0;
    cx.fillStyle = 'rgba(255,255,255,0.88)';
    cx.fillText(tagline, 22, 202);
    // Bottom accent bar
    cx.fillStyle = 'rgba(255,255,255,0.13)';
    cx.fillRect(0, H - 38, W, 38);
    cx.fillStyle = 'rgba(255,255,255,0.55)';
    cx.font = '13px sans-serif';
    cx.fillText('tashkent.uz  •  Toshkent skver', 20, H - 13);
    const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; return tx;
  }
  function addBillboard(x, z, ry, tex) {
    const g = new THREE.Group();
    for (const dx of [-0.72, 0.72]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(.055, .075, 5.2, 8), mat(0x7a7a7a, .55));
      pole.position.set(dx, 2.6, 0); pole.castShadow = true; g.add(pole);
    }
    // Metal frame
    const frame = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.15, 0.12), mat(0x3d3d3d, .85));
    frame.position.y = 4.65; g.add(frame);
    // Ad face (front)
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 1.95),
      new THREE.MeshStandardMaterial({ map: tex, roughness: .8, metalness: .05 })
    );
    face.position.set(0, 4.65, 0.07); g.add(face);
    // Back panel (dark)
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 1.95),
      mat(0x222222, .9)
    );
    back.position.set(0, 4.65, -0.07); back.rotation.y = Math.PI; g.add(back);
    // Top lamp bar
    const bar = new THREE.Mesh(new THREE.BoxGeometry(3.52, .13, .22), mat(0x555555, .7));
    bar.position.y = 5.76; g.add(bar);
    g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g);
  }
  const _adCfg = [
    ['#cc1a1a', '#7a0808', 'Coca‑Cola', 'Taste the Feeling!', 'C'],
    ['#1a3a9f', '#0a1a6e', 'UzTelecom', '5G — Yangi avlod', 'U'],
    ['#1a7a3e', '#083d1c', 'Hamkorbank', 'Kredit 16% dan', 'H'],
    ['#7a1a9e', '#3d0858', 'SKVER MALL', "Ko'p chegirma!", 'S'],
    ['#1a7a6e', '#083c38', 'Toshkent', 'Sharq Yulduzi', 'T'],
    ['#1a2a6e', '#081040', 'Uzbekistan Air', "Qaerga bo'lsin", 'A'],
  ];
  // 6 billboards around plaza at r≈10.5, between tree rings, off main paths
  [
    [9.7, 4.2], [-9.7, 4.2], [-9.7, -4.2],
    [9.7, -4.2], [-4.2, 9.7], [4.2, -9.7],
  ].forEach(([bx, bz], i) => {
    addBillboard(bx, bz, Math.atan2(-bx, -bz), makeAdTex(..._adCfg[i]));
  });

  // ─── STREET LAMPS ────────────────────────────────────────────────────────
  function addLamp(x, z) {
    const g = new THREE.Group();
    // pole
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.06, .08, 4, 8), mat(0x888888, .6));
    pole.position.y = 2; pole.castShadow = true; g.add(pole);
    // arm
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, 1.2, 6), mat(0x888888, .6));
    arm.rotation.z = Math.PI / 2; arm.position.set(.6, 3.9, 0); g.add(arm);
    // globe
    const globe = new THREE.Mesh(new THREE.SphereGeometry(.18, 10, 8), new THREE.MeshStandardMaterial({ color: 0xfffde7, emissive: 0xfffde7, emissiveIntensity: 1 }));
    globe.position.set(1.15, 3.9, 0); g.add(globe);
    const pl = new THREE.PointLight(0xfff4cc, 3, 9, 2);
    pl.position.copy(globe.position); g.add(pl); lampLights.push(pl);
    g.position.set(x, 0, z); scene.add(g);
  }
  // Inner lamps — 8 ta, yo'laklar orasidagi bo'sh joylarda (22.5° offset)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8 * Math.PI * 2) + Math.PI / 8; // 22.5° dan boshlaydi
    const lx = Math.cos(a) * 7.5, lz = Math.sin(a) * 7.5;
    if (!nearBuilding(lx, lz)) addLamp(lx, lz);
  }
  // Tashqi chiroqlar — kattalashgan maydonni yoritadi, stadion ustiga tushmaydi
  for (const [x, z] of [[-6, -20], [6, -20], [-6, 20], [6, 20], [-20, -6], [-20, 6], [20, -6], [20, 6]]) {
    if (!nearBuilding(x, z)) addLamp(x, z);
  }

  // ─── FOUNTAIN ────────────────────────────────────────────────────────────
  const interactive = [], labels = [];
  const fountainAnimObjects = [];
  {
    const fg = new THREE.Group();
    const stoneM = mat(0xa8b8c8, .78);
    const stone2M = mat(0x98a8b8, .82);
    // Outer basin — wide stepped rim
    const outerRim = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.75, .32, 48), stoneM);
    outerRim.position.y = .16; outerRim.castShadow = true; outerRim.receiveShadow = true; fg.add(outerRim);
    // Rim top edge detail
    const rimEdge = new THREE.Mesh(new THREE.TorusGeometry(2.5, .075, 7, 48), stone2M);
    rimEdge.rotation.x = Math.PI / 2; rimEdge.position.y = .32; fg.add(rimEdge);
    // Water surface (outer pool)
    const water = new THREE.Mesh(new THREE.CylinderGeometry(2.38, 2.38, .05, 48),
      new THREE.MeshStandardMaterial({ color: 0x40c8f8, roughness: .04, metalness: .44, transparent: true, opacity: .84 }));
    water.position.y = .34; fg.add(water);
    // Inner pedestal — tiered
    const ped1 = new THREE.Mesh(new THREE.CylinderGeometry(.95, 1.18, .48, 16), stoneM);
    ped1.position.y = .56; ped1.castShadow = true; fg.add(ped1);
    const ped2 = new THREE.Mesh(new THREE.CylinderGeometry(.68, .95, .22, 16), stone2M);
    ped2.position.y = .91; fg.add(ped2);
    // Upper bowl
    const upBowl = new THREE.Mesh(new THREE.CylinderGeometry(.88, .70, .20, 16), stoneM);
    upBowl.position.y = 1.08; fg.add(upBowl);
    const upWater = new THREE.Mesh(new THREE.CylinderGeometry(.80, .80, .05, 16),
      new THREE.MeshStandardMaterial({ color: 0x60d8ff, roughness: .04, transparent: true, opacity: .80 }));
    upWater.position.y = 1.22; fg.add(upWater);
    // Central column with decorative rings
    const col = new THREE.Mesh(new THREE.CylinderGeometry(.09, .13, 1.58, 10), mat(0x8aacc0, .55));
    col.position.y = 1.52; fg.add(col);
    for (const cy of [1.20, 1.72, 2.05]) {
      const cr = new THREE.Mesh(new THREE.TorusGeometry(.15, .038, 7, 16), mat(0x9ab8cc, .50));
      cr.rotation.x = Math.PI / 2; cr.position.y = cy; fg.add(cr);
    }
    // Top cap sphere
    const top = new THREE.Mesh(new THREE.SphereGeometry(.25, 14, 10), mat(0x7aacc0, .38));
    top.position.y = 2.34; top.castShadow = true; fg.add(top);
    // 8 parabolic water jet arcs (7 droplets each)
    const dropMat = new THREE.MeshStandardMaterial({ color: 0x88eeff, transparent: true, opacity: .68, roughness: .08 });
    for (let ai = 0; ai < 8; ai++) {
      const ang = ai / 8 * Math.PI * 2;
      for (let di = 0; di < 7; di++) {
        const t = di / 6;
        const arcY = 2.25 + t * .48 - t * t * 2.58;
        const drop = new THREE.Mesh(new THREE.SphereGeometry(.055 * (1 - t * .45), 5, 4), dropMat);
        drop.position.set(Math.cos(ang) * t * 1.5, arcY, Math.sin(ang) * t * 1.5);
        fg.add(drop);
      }
    }
    // 4 animated ripple rings on water surface
    for (let i = 0; i < 4; i++) {
      const ripple = new THREE.Mesh(
        new THREE.TorusGeometry(.55 + i * .48, .038, 5, 32),
        new THREE.MeshStandardMaterial({ color: 0x88eeff, transparent: true, opacity: .45, roughness: .08 })
      );
      ripple.rotation.x = Math.PI / 2; ripple.position.y = .35;
      fg.add(ripple);
      fountainAnimObjects.push({ mesh: ripple, phase: i * 1.1 });
    }
    const fp = places.find(p => p.kind === 'fountain');
    fg.position.set(fp.x, 0, fp.z);
    fp.userData3d = fg;
    fg.children[0].userData.place = fp;
    interactive.push(fg.children[0]);
    scene.add(fg);
    label(fp.name, fp.x, 3.4, fp.z, '#1689bd', 3.2);
  }

  // ─── GLB-BASED PLACES (real uploaded models) ─────────────────────────────
  // Loads an external .glb, auto-fits it to the place footprint, drops it on
  // the ground, orients it, and registers it as an interactive/clickable place.
  function addModelPlace(p, g) {
    const fit = p.modelFit || Math.max(...p.size);   // target max horizontal size
    const placeLabel = topY =>
      label(p.name, p.x, topY + 1.4, p.z, '#2a3a50', Math.min(Math.max(p.size[0], 4), 6));
    new GLTFLoader().load(`./assets/models/${p.model}`, gltf => {
      const model = gltf.scene;
      // shadows + double-sided materials
      model.traverse(o => {
        if (o.isMesh) {
          o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          ms.forEach(m => { if (m) { m.side = THREE.DoubleSide; m.needsUpdate = true; } });
        }
      });
      if (p.modelRotY) model.rotation.y = p.modelRotY;
      model.updateMatrixWorld(true);
      // measure → uniform scale so largest horizontal extent == fit
      let b = new THREE.Box3().setFromObject(model);
      const s = new THREE.Vector3(); b.getSize(s);
      const span = Math.max(s.x, s.z) || s.y || 1;
      const scale = fit / span;
      model.scale.multiplyScalar(scale);
      model.updateMatrixWorld(true);
      // re-measure → center on X/Z, sit bottom on the ground
      b = new THREE.Box3().setFromObject(model);
      const c = new THREE.Vector3(); b.getCenter(c);
      model.position.x -= c.x;
      model.position.z -= c.z;
      model.position.y -= b.min.y - (p.modelYOffset || 0);
      g.add(model);
      // label sits just above the model's true (fitted) top — not p.size
      g.updateMatrixWorld(true);
      const topY = new THREE.Box3().setFromObject(model).max.y;
      placeLabel(topY);
    }, undefined, err => {
      console.error(`Не удалось загрузить модель ${p.model}`, err);
      // fallback box so the spot is still clickable
      const [w, h, d] = p.size;
      const fb = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
        mat('#' + p.color.toString(16).padStart(6, '0'), .9));
      fb.position.y = h / 2; fb.castShadow = true; fb.receiveShadow = true;
      g.add(fb);
      placeLabel(h);
    });
    // register the whole group as interactive immediately (recursive raycast
    // walks up to find userData.place, so children added later still resolve)
    g.userData.place = p;
    interactive.push(g);
  }

  // ─── BUILDINGS ───────────────────────────────────────────────────────────
  for (const p of places) {
    if (p.kind === 'fountain') continue; // handled above
    const g = new THREE.Group();
    const [w, h, d] = p.size;

    if (p.model) {
      addModelPlace(p, g);
    } else if (p.kind === 'monument') {
      // ── Materials ──────────────────────────────────────────────────────────
      const brnz = (c, r) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: .44 });
      const stM  = c => mat(c, .82);
      const bD   = brnz(0x6c5520, .74);
      const bM   = brnz(0x7a6330, .64);
      const bL   = brnz(0x8a7440, .54);
      const bH   = brnz(0x9a8450, .44);

      // ── PEDESTAL — 3-step octagonal base + tall rectangular column ────────
      for (const [r1, r2, yp, c] of [
        [2.35, 2.55, .11, 0xbdb090],
        [1.90, 2.10, .33, 0xccc09a],
        [1.52, 1.70, .52, 0xd8c8a0],
      ]) {
        const st = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, .22, 8), stM(c));
        st.position.y = yp; st.receiveShadow = true; g.add(st);
      }
      const pedH = 1.9;
      const ped = new THREE.Mesh(new THREE.BoxGeometry(1.42, pedH, 1.12), stM(0xe0d0b0));
      ped.position.y = .66 + pedH / 2;
      ped.castShadow = true; ped.receiveShadow = true;
      ped.userData.place = p; interactive.push(ped); g.add(ped);
      box(g, 1.62, .28, 1.30, 0, .66 + .14, 0, stM(0xd0c098));
      box(g, 1.68, .26, 1.32, 0, .66 + pedH + .13, 0, stM(0xc8b888));
      for (const py of [.52, .96, 1.44]) box(g, 1.48, .06, 1.16, 0, .66 + py, 0, stM(0xbcac7e));
      box(g, 1.05, .58, .04, 0, .66 + pedH * .37, 1.12 / 2 + .02, brnz(0xc0a060, .55));
      box(g, .92, .46, .02, 0, .66 + pedH * .37, 1.12 / 2 + .05, stM(0xf0e8d0));

      const BASE = .66 + pedH + .26; // top of pedestal — horse hooves rest here

      // ── HORSE — PRANCING POSE (chap old oyoq baland ko'tarilgan) ──────────
      // Torso
      const hBody = new THREE.Mesh(new THREE.CylinderGeometry(.41, .38, 1.72, 10), bD);
      hBody.rotation.z = Math.PI / 2;
      hBody.position.set(0, BASE + .74, 0); hBody.castShadow = true; g.add(hBody);
      // Chest (front sphere, elongated)
      const hChest = new THREE.Mesh(new THREE.SphereGeometry(.44, 9, 7), bD);
      hChest.scale.set(1.0, 1.08, 1.28);
      hChest.position.set(0, BASE + .73, -.80); hChest.castShadow = true; g.add(hChest);
      // Rump
      const hRump = new THREE.Mesh(new THREE.SphereGeometry(.42, 9, 7), bD);
      hRump.position.set(0, BASE + .73, .80); g.add(hRump);
      // Belly
      const hBelly = new THREE.Mesh(new THREE.SphereGeometry(.35, 8, 6), bD);
      hBelly.position.set(0, BASE + .54, 0); g.add(hBelly);

      // Neck — 3-segment ARCHED curve (elegant arch like image)
      // Segment 1: chest→mid, steep upward-forward
      const nk1 = new THREE.Mesh(new THREE.CylinderGeometry(.21, .27, .66, 8), bM);
      nk1.rotation.x = -Math.PI * .46;
      nk1.position.set(0, BASE + 1.02, -.84); nk1.castShadow = true; g.add(nk1);
      // Segment 2: mid, curving more vertical
      const nk2 = new THREE.Mesh(new THREE.CylinderGeometry(.17, .21, .54, 8), bM);
      nk2.rotation.x = -Math.PI * .20;
      nk2.position.set(0, BASE + 1.44, -1.12); g.add(nk2);
      // Segment 3: top, arching slightly back (crest of neck)
      const nk3 = new THREE.Mesh(new THREE.CylinderGeometry(.14, .17, .36, 8), bM);
      nk3.rotation.x = Math.PI * .07;
      nk3.position.set(0, BASE + 1.76, -1.14); g.add(nk3);

      // Horse head
      const hHead = new THREE.Mesh(new THREE.BoxGeometry(.28, .30, .54), bM);
      hHead.position.set(0, BASE + 1.85, -1.22); hHead.castShadow = true; g.add(hHead);
      // Snout/muzzle
      const hSnout = new THREE.Mesh(new THREE.BoxGeometry(.22, .21, .34), bM);
      hSnout.position.set(0, BASE + 1.71, -1.48); g.add(hSnout);
      // Nostrils
      for (const nx of [-.07, .07]) {
        const nos = new THREE.Mesh(new THREE.SphereGeometry(.046, 5, 4), bD);
        nos.position.set(nx, BASE + 1.66, -1.63); g.add(nos);
      }
      // Eyes
      for (const ex of [-.13, .13]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(.034, 5, 4), bD);
        eye.position.set(ex, BASE + 1.89, -1.20); g.add(eye);
      }
      // Ears (alert, pricked)
      for (const ex of [-.10, .10]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(.048, .20, 5), bM);
        ear.position.set(ex, BASE + 2.02, -1.14); ear.rotation.x = -.15; g.add(ear);
      }
      // Mane — flowing plates along neck ridge
      const maneM = brnz(0x4e3818, .88);
      for (let mi = 0; mi < 7; mi++) {
        const t = mi / 6;
        const mn = new THREE.Mesh(new THREE.BoxGeometry(.07, .32 - t * .07, .16 - t * .03), maneM);
        mn.position.set(0, BASE + 1.70 - mi * .10, -1.04 - mi * .06);
        mn.rotation.x = -.18; g.add(mn);
      }
      // Forelock
      const fl = new THREE.Mesh(new THREE.BoxGeometry(.07, .20, .14), maneM);
      fl.position.set(0, BASE + 1.96, -1.18); fl.rotation.x = .22; g.add(fl);

      // Tail — slightly raised (excited horse)
      const tailM = brnz(0x4e3818, .88);
      const tail1 = new THREE.Mesh(new THREE.CylinderGeometry(.09, .03, .82, 6), tailM);
      tail1.rotation.x = Math.PI * .20; tail1.position.set(0, BASE + .96, 1.05); g.add(tail1);
      const tail2 = new THREE.Mesh(new THREE.CylinderGeometry(.07, .02, .68, 6), tailM);
      tail2.rotation.x = Math.PI * .36; tail2.position.set(0, BASE + .72, 1.34); g.add(tail2);
      const tailTip = new THREE.Mesh(new THREE.SphereGeometry(.11, 6, 5), tailM);
      tailTip.position.set(0, BASE + .52, 1.54); g.add(tailTip);

      // ── LEGS ────────────────────────────────────────────────────────────────
      const hoofM = brnz(0x3a2808, .94);

      // CHAP OLD OYOQ — baland ko'tarilgan (prancing, key feature from image)
      // Thigh: shoulder at (-.24, BASE+.73, -.80), knee HIGH at (-.24, BASE+1.12, -1.25)
      const lft = new THREE.Mesh(new THREE.CylinderGeometry(.115, .098, .72, 7), bD);
      lft.rotation.x = -Math.PI * .58; // ~104° — almost horizontal, sweeping forward
      lft.position.set(-.24, BASE + .92, -.96); lft.castShadow = true; g.add(lft);
      const lftK = new THREE.Mesh(new THREE.SphereGeometry(.098, 7, 5), bM);
      lftK.position.set(-.24, BASE + 1.12, -1.25); g.add(lftK); // knee joint
      // Shin: hanging down from knee
      const lfs = new THREE.Mesh(new THREE.CylinderGeometry(.090, .080, .66, 7), bD);
      lfs.rotation.x = Math.PI * .22; // angled slightly backward
      lfs.position.set(-.24, BASE + .80, -1.34); g.add(lfs);
      const hfLF = new THREE.Mesh(new THREE.CylinderGeometry(.082, .10, .10, 7), hoofM);
      hfLF.position.set(-.24, BASE + .52, -1.34); g.add(hfLF); // hoof raised off ground

      // O'NG OLD OYOQ — slightly stepping forward, hoof on ground
      const rft = new THREE.Mesh(new THREE.CylinderGeometry(.115, .098, .86, 7), bD);
      rft.rotation.x = -Math.PI * .10;
      rft.position.set(.24, BASE + .44, -.70); rft.castShadow = true; g.add(rft);
      const rftK = new THREE.Mesh(new THREE.SphereGeometry(.098, 7, 5), bM);
      rftK.position.set(.24, BASE + .06, -.82); g.add(rftK);
      const rfs = new THREE.Mesh(new THREE.CylinderGeometry(.090, .080, .50, 7), bD);
      rfs.rotation.x = Math.PI * .06;
      rfs.position.set(.24, BASE - .22, -.82); g.add(rfs);
      const hfRF = new THREE.Mesh(new THREE.CylinderGeometry(.082, .10, .10, 7), hoofM);
      hfRF.position.set(.24, BASE - .46, -.80); g.add(hfRF);

      // CHAP ORQA OYOQ — tayanch, yerda
      const lbt = new THREE.Mesh(new THREE.CylinderGeometry(.118, .098, .90, 7), bD);
      lbt.rotation.x = Math.PI * .04;
      lbt.position.set(-.24, BASE + .21, .62); lbt.castShadow = true; g.add(lbt);
      const lbtK = new THREE.Mesh(new THREE.SphereGeometry(.098, 7, 5), bM);
      lbtK.position.set(-.24, BASE - .23, .64); g.add(lbtK);
      const lbs = new THREE.Mesh(new THREE.CylinderGeometry(.090, .080, .56, 7), bD);
      lbs.position.set(-.24, BASE - .50, .63); g.add(lbs);
      const hfLB = new THREE.Mesh(new THREE.CylinderGeometry(.082, .10, .10, 7), hoofM);
      hfLB.position.set(-.24, BASE - .76, .63); g.add(hfLB);

      // O'NG ORQA OYOQ — asosiy tayanch
      const rbt = new THREE.Mesh(new THREE.CylinderGeometry(.118, .098, .90, 7), bD);
      rbt.rotation.x = -Math.PI * .04;
      rbt.position.set(.24, BASE + .21, .62); rbt.castShadow = true; g.add(rbt);
      const rbtK = new THREE.Mesh(new THREE.SphereGeometry(.098, 7, 5), bM);
      rbtK.position.set(.24, BASE - .23, .62); g.add(rbtK);
      const rbs = new THREE.Mesh(new THREE.CylinderGeometry(.090, .080, .56, 7), bD);
      rbs.position.set(.24, BASE - .50, .61); g.add(rbs);
      const hfRB = new THREE.Mesh(new THREE.CylinderGeometry(.082, .10, .10, 7), hoofM);
      hfRB.position.set(.24, BASE - .76, .61); g.add(hfRB);

      // Decorative bridle harness
      const brM = brnz(0x5a4820, .80);
      const bridle = new THREE.Mesh(new THREE.TorusGeometry(.20, .03, 6, 16), brM);
      bridle.rotation.y = Math.PI / 2; bridle.position.set(0, BASE + 1.54, -1.14); g.add(bridle);

      // Saddle + decorated cloth
      const saddle = new THREE.Mesh(new THREE.BoxGeometry(.48, .14, .60), brnz(0x5a3818, .90));
      saddle.position.set(0, BASE + 1.20, -.10); g.add(saddle);
      const cloth = new THREE.Mesh(new THREE.BoxGeometry(.60, .08, .84), brnz(0x7a1010, .93));
      cloth.position.set(0, BASE + 1.13, -.06); g.add(cloth);
      const clothE = new THREE.Mesh(new THREE.BoxGeometry(.64, .044, .88), brnz(0xc0a060, .70));
      clothE.position.set(0, BASE + 1.10, -.06); g.add(clothE);

      // ── AMIR TEMUR — chavandoz ─────────────────────────────────────────────
      const RY = BASE + 1.38;

      // Lower robe (wide)
      const robe = new THREE.Mesh(new THREE.CylinderGeometry(.17, .36, .84, 10), bD);
      robe.position.set(0, RY + .22, -.10); robe.castShadow = true; g.add(robe);
      // Torso
      const torso = new THREE.Mesh(new THREE.BoxGeometry(.45, .48, .35), bM);
      torso.position.set(0, RY + .66, -.10); torso.castShadow = true; g.add(torso);
      // Armored chest (slightly bulging)
      const chestP = new THREE.Mesh(new THREE.BoxGeometry(.50, .24, .30), bL);
      chestP.position.set(0, RY + .76, -.10); g.add(chestP);
      // Shoulders (wide)
      const shldr = new THREE.Mesh(new THREE.BoxGeometry(.60, .17, .32), bD);
      shldr.position.set(0, RY + .86, -.10); g.add(shldr);
      // Neck
      const rNeck = new THREE.Mesh(new THREE.CylinderGeometry(.10, .11, .22, 8), bM);
      rNeck.position.set(0, RY + .99, -.10); g.add(rNeck);
      // Head (looking slightly up — commanding pose)
      const rHead = new THREE.Mesh(new THREE.SphereGeometry(.178, 12, 9), bM);
      rHead.position.set(0, RY + 1.18, -.10); rHead.castShadow = true; g.add(rHead);
      // Timurid hat — cylindrical crown with layered top (matches image)
      const hatB = new THREE.Mesh(new THREE.CylinderGeometry(.22, .21, .09, 10), bL);
      hatB.position.set(0, RY + 1.30, -.10); g.add(hatB);
      const hatM = new THREE.Mesh(new THREE.CylinderGeometry(.20, .22, .18, 10), bL);
      hatM.position.set(0, RY + 1.42, -.10); g.add(hatM);
      const hatT = new THREE.Mesh(new THREE.CylinderGeometry(.14, .20, .12, 10), bH);
      hatT.position.set(0, RY + 1.56, -.10); g.add(hatT);
      // Beard
      const beard = new THREE.Mesh(new THREE.ConeGeometry(.075, .16, 6), bD);
      beard.rotation.x = Math.PI; beard.position.set(0, RY + 1.04, -.05); g.add(beard);
      // Mustache suggestion
      for (const mx of [-.07, .07]) {
        const mus = new THREE.Mesh(new THREE.SphereGeometry(.035, 5, 4), bD);
        mus.scale.set(1.8, .8, 1); mus.position.set(mx, RY + 1.10, -.07); g.add(mus);
      }
      // Epaulettes
      for (const ex of [-1, 1]) {
        const ep = new THREE.Mesh(new THREE.SphereGeometry(.105, 7, 5), bL);
        ep.scale.set(1.6, .6, 1.0); ep.position.set(ex * .30, RY + .88, -.10); g.add(ep);
      }
      // Armor belt
      const belt = new THREE.Mesh(new THREE.CylinderGeometry(.20, .22, .08, 10), bL);
      belt.position.set(0, RY + .44, -.10); g.add(belt);

      // ── O'NG QO'L — YUQORIGA KO'TARILGAN, KO'RSATKICH BARMOQ (asosiy pozasi) ──
      // Upper arm — going up from right shoulder
      const uArmR = new THREE.Mesh(new THREE.CylinderGeometry(.068, .075, .60, 6), bD);
      uArmR.rotation.set(0, 0, -Math.PI * .22);
      uArmR.position.set(.30, RY + .98, -.10); uArmR.castShadow = true; g.add(uArmR);
      // Elbow joint
      const elbR = new THREE.Mesh(new THREE.SphereGeometry(.068, 6, 5), bM);
      elbR.position.set(.44, RY + 1.28, -.10); g.add(elbR);
      // Forearm — nearly vertical, pointing up
      const fArmR = new THREE.Mesh(new THREE.CylinderGeometry(.060, .068, .52, 6), bD);
      fArmR.rotation.set(0, 0, -Math.PI * .08);
      fArmR.position.set(.50, RY + 1.56, -.10); g.add(fArmR);
      // Fist (closed)
      const handR = new THREE.Mesh(new THREE.SphereGeometry(.075, 7, 5), bM);
      handR.scale.set(1.0, 1.4, 1.0);
      handR.position.set(.54, RY + 1.84, -.10); g.add(handR);
      // INDEX FINGER pointing straight UP — iconic gesture
      const finger = new THREE.Mesh(new THREE.CylinderGeometry(.024, .030, .26, 5), bM);
      finger.position.set(.55, RY + 2.00, -.10); g.add(finger);
      const fTip = new THREE.Mesh(new THREE.SphereGeometry(.028, 5, 4), bM);
      fTip.position.set(.55, RY + 2.14, -.10); g.add(fTip);

      // ── CHAP QO'L — jilov ushlab, oldinga qaraganda ──
      const uArmL = new THREE.Mesh(new THREE.CylinderGeometry(.068, .075, .52, 6), bD);
      uArmL.rotation.set(Math.PI * .20, 0, Math.PI * .22);
      uArmL.position.set(-.30, RY + .80, .02); g.add(uArmL);
      const elbL = new THREE.Mesh(new THREE.SphereGeometry(.068, 6, 5), bM);
      elbL.position.set(-.44, RY + .62, .16); g.add(elbL);
      const fArmL = new THREE.Mesh(new THREE.CylinderGeometry(.060, .068, .40, 6), bD);
      fArmL.rotation.set(Math.PI * .30, 0, Math.PI * .12);
      fArmL.position.set(-.52, RY + .47, .28); g.add(fArmL);
      const handL = new THREE.Mesh(new THREE.SphereGeometry(.068, 6, 5), bM);
      handL.position.set(-.58, RY + .34, .38); g.add(handL);
      // Reins
      for (const rx of [-.12, .12]) {
        const rein = new THREE.Mesh(new THREE.CylinderGeometry(.014, .014, 1.0, 4), brnz(0x3a2808, .92));
        rein.rotation.x = Math.PI * .38; rein.position.set(rx, BASE + 1.10, -.26); g.add(rein);
      }

      // ── PLASH — katta, chapga va orqaga uchib ketayapti ──
      // Main cape — large swooping volume
      const cape1 = new THREE.Mesh(new THREE.ConeGeometry(.40, 1.10, 8), bD);
      cape1.rotation.set(-Math.PI * .28, 0, Math.PI * .24);
      cape1.position.set(-.42, RY + .42, .34); cape1.castShadow = true; g.add(cape1);
      const cape2 = new THREE.Mesh(new THREE.CylinderGeometry(.10, .35, .78, 8), bD);
      cape2.rotation.set(-Math.PI * .15, 0, Math.PI * .28);
      cape2.position.set(-.28, RY + .64, .18); g.add(cape2);
      const cape3 = new THREE.Mesh(new THREE.ConeGeometry(.22, .75, 7), bD);
      cape3.rotation.set(-Math.PI * .44, 0, Math.PI * .20);
      cape3.position.set(-.52, RY + .18, .60); g.add(cape3);
      // Cape edge crease (flowing fold)
      const capeE = new THREE.Mesh(new THREE.CylinderGeometry(.04, .08, .90, 6), brnz(0x5a4218, .82));
      capeE.rotation.set(-Math.PI * .38, 0, Math.PI * .18);
      capeE.position.set(-.36, RY + .26, .52); g.add(capeE);

      label(p.name, p.x, BASE + 3.8, p.z, '#5a4020', 5.5);
    } else {
      // ── helpers scoped to this building ─────────────────────────────────
      const emitM = m => { buildingMaterials.push(m); return m; };
      const winM = (wall, rows, cols) => {
        const tx = makeWinTex(wall, rows, cols);
        return emitM(new THREE.MeshStandardMaterial({ map: tx, emissiveMap: tx, emissive: new THREE.Color(0xffd088), emissiveIntensity: 0, roughness: .82 }));
      };
      const solidM = (hex, rough) => emitM(new THREE.MeshStandardMaterial({ color: hex, roughness: rough || .88, emissive: new THREE.Color(0xffd088), emissiveIntensity: 0 }));
      const glassM = () => new THREE.MeshStandardMaterial({ color: 0x88ccff, roughness: .06, metalness: .7, transparent: true, opacity: .62 });

      // ════════════════════════════════════════════════════════════════════
      if (p.id === 'hotel-uzbekistan') {
        // ── Hotel Uzbekistan — brutalist Soviet tower (1974) ───────────────
        const BW = 7.0, BH = 11.0, BD = 2.0;
        const fMat = winM('#c8bca4', 18, 8);
        const tower = new THREE.Mesh(new THREE.BoxGeometry(BW, BH, BD), fMat);
        tower.position.y = BH / 2; tower.castShadow = true; tower.receiveShadow = true;
        tower.userData.place = p; interactive.push(tower); g.add(tower);
        // Lateral wings (H-plan)
        const wgMat = winM('#bfb49c', 7, 3);
        for (const sx of [-1, 1]) {
          const wing = new THREE.Mesh(new THREE.BoxGeometry(2.0, BH * .52, 3.6), wgMat);
          wing.position.set(sx * (BW / 2 + 1.0), BH * .26, 1.55);
          wing.castShadow = true; wing.receiveShadow = true; g.add(wing);
          box(g, 2.2, .18, 3.8, sx * (BW / 2 + 1.0), BH * .52 + .09, 1.55, mat(0x8a7c62, .85));
        }
        // Horizontal concrete bands every 2 floors
        for (let fi = 1; fi < 18; fi += 2) {
          box(g, BW + .06, .09, BD + .06, 0, fi * (BH / 18), 0, mat(0xa89870, .82));
        }
        // Vertical pilasters on facade
        for (const cx of [-BW / 2 + .01, -BW / 6, BW / 6, BW / 2 - .01]) {
          box(g, .14, BH + .08, .12, cx, BH / 2, BD / 2 + .04, mat(0xbcac88, .78));
        }
        // Top cornice + parapet
        box(g, BW + .45, .32, BD + .45, 0, BH + .16, 0, mat(0x9a8c70, .80));
        box(g, BW + .6, .20, BD + .6, 0, BH + .42, 0, mat(0x8c7e60, .84));
        // Penthouse block
        box(g, BW * .42, .95, BD * .85, 0, BH + .68, 0, mat(0x9a8c72, .82));
        // Flagpole
        const fpo = new THREE.Mesh(new THREE.CylinderGeometry(.02, .02, 1.8, 6), mat(0xdddddd, .38));
        fpo.position.set(0, BH + 1.58, 0); g.add(fpo);
        // Entrance portico
        box(g, 3.4, .18, 1.8, 0, BH * .10, BD / 2 + .8, mat(0xb0a080, .72));
        for (const cx of [-1.3, -.44, .44, 1.3]) {
          const col = new THREE.Mesh(new THREE.CylinderGeometry(.09, .11, BH * .10, 10), mat(0xc4b490, .62));
          col.position.set(cx, BH * .05, BD / 2 + .72); col.castShadow = true; g.add(col);
        }
        // Canopy glass
        const canopy = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.8), new THREE.MeshStandardMaterial({ color: 0x99ccee, roughness: .08, metalness: .5, transparent: true, opacity: .55 }));
        canopy.rotation.x = -Math.PI / 2; canopy.position.set(0, BH * .10 + .01, BD / 2 + .8); g.add(canopy);
        // Entrance glass doors
        const hgm = glassM();
        for (const dx of [-.45, .45]) {
          const dr = new THREE.Mesh(new THREE.PlaneGeometry(.75, BH * .10 * 1.6), hgm);
          dr.position.set(dx, BH * .08, BD / 2 + .02); g.add(dr);
        }
        // Sign
        const hss = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTex(p.name, '#2a3a50'), transparent: true }));
        hss.position.set(0, BH * .155, BD / 2 + .12); hss.scale.set(5.5, .85, 1); g.add(hss);
        label(p.name, p.x, BH + 2.8, p.z, '#2a3a50', 6.0);

      // ════════════════════════════════════════════════════════════════════
      } else if (p.id === 'museum-temurids') {
        // ── Museum of Temurids — cylindrical rotunda with blue dome ────────
        const BR = 3.2, BH2 = 3.2, DR = 2.55;
        // Timurid-patterned drum texture
        const drumTex = (() => {
          const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
          const ctx = cv.getContext('2d');
          const gr = ctx.createLinearGradient(0, 0, 0, 256);
          gr.addColorStop(0, '#4ab8d8'); gr.addColorStop(1, '#2a88a8');
          ctx.fillStyle = gr; ctx.fillRect(0, 0, 512, 256);
          ctx.strokeStyle = '#1a6888'; ctx.lineWidth = 3;
          for (let y = 40; y < 256; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke(); }
          ctx.strokeStyle = '#88ddf8'; ctx.lineWidth = 1;
          for (let x = 0; x < 512; x += 42) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke(); }
          for (let i = 0; i < 12; i++) {
            const nx = i * 42 + 21;
            ctx.fillStyle = '#1a6888'; ctx.fillRect(nx - 10, 60, 20, 120);
            ctx.fillStyle = '#2a98b8'; ctx.beginPath(); ctx.arc(nx, 60, 10, Math.PI, 0); ctx.fill();
          }
          const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
        })();
        const dMat = emitM(new THREE.MeshStandardMaterial({ map: drumTex, emissiveMap: drumTex, emissive: new THREE.Color(0xffd088), emissiveIntensity: 0, roughness: .5, metalness: .08 }));
        const drum = new THREE.Mesh(new THREE.CylinderGeometry(BR, BR, BH2, 12), dMat);
        drum.position.y = BH2 / 2; drum.castShadow = true; drum.receiveShadow = true;
        drum.userData.place = p; interactive.push(drum); g.add(drum);
        // Drum neck ring
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(DR + .12, DR + .22, .6, 16), mat(0x1a90cc, .35));
        neck.position.y = BH2 + .3; g.add(neck);
        // Main blue dome
        const dome = new THREE.Mesh(new THREE.SphereGeometry(DR, 36, 20, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x1088cc, .18));
        dome.position.y = BH2 + .6; dome.castShadow = true; g.add(dome);
        // Dome ribbing
        for (let ri = 0; ri < 16; ri++) {
          const ra = ri / 16 * Math.PI * 2;
          const rib = new THREE.Mesh(new THREE.TorusGeometry(DR + .045, .038, 6, 22, Math.PI * .58), mat(0x0878aa, .28));
          rib.position.set(Math.cos(ra) * .001, BH2 + .6 + DR * .22, Math.sin(ra) * .001);
          rib.rotation.set(Math.PI / 2 - .35, ra, 0); g.add(rib);
        }
        // Golden lantern + finial
        const lantern = new THREE.Mesh(new THREE.CylinderGeometry(.18, .22, .45, 8), mat(0xd4af37, .28));
        lantern.position.y = BH2 + .6 + DR - .05; g.add(lantern);
        const finial = new THREE.Mesh(new THREE.ConeGeometry(.11, .7, 8), mat(0xd4af37, .22));
        finial.position.y = BH2 + .6 + DR + .4; g.add(finial);
        // 4 arched portals (N/S/E/W)
        for (let pi = 0; pi < 4; pi++) {
          const pa = pi / 4 * Math.PI * 2;
          const px2 = Math.sin(pa) * (BR + .04), pz2 = Math.cos(pa) * (BR + .04);
          for (const side of [-1, 1]) {
            const jx = px2 + Math.cos(pa) * side * .75;
            const jz = pz2 - Math.sin(pa) * side * .75;
            const jm = new THREE.Mesh(new THREE.BoxGeometry(.22, BH2 * .78, .2), mat(0x2a8abe, .55));
            jm.position.set(jx, BH2 * .39, jz); jm.rotation.y = pa; g.add(jm);
          }
          const archM = new THREE.Mesh(new THREE.TorusGeometry(.78, .11, 8, 16, Math.PI), mat(0x2a8abe, .5));
          archM.position.set(px2, BH2 * .78, pz2); archM.rotation.y = -pa + Math.PI / 2; g.add(archM);
          const dgm = new THREE.Mesh(new THREE.PlaneGeometry(1.2, BH2 * .74), glassM());
          dgm.position.set(px2 * 1.02, BH2 * .38, pz2 * 1.02); dgm.rotation.y = -pa; g.add(dgm);
        }
        // 12 decorative columns around drum
        for (let ci = 0; ci < 12; ci++) {
          const ca = ci / 12 * Math.PI * 2;
          const col = new THREE.Mesh(new THREE.CylinderGeometry(.1, .13, BH2 + .18, 8), mat(0x3aa0cc, .52));
          col.position.set(Math.cos(ca) * (BR + .1), BH2 / 2, Math.sin(ca) * (BR + .1));
          col.castShadow = true; g.add(col);
          const cap = new THREE.Mesh(new THREE.SphereGeometry(.15, 8, 6), mat(0xd4af37, .38));
          cap.position.set(Math.cos(ca) * (BR + .1), BH2 + .14, Math.sin(ca) * (BR + .1)); g.add(cap);
        }
        // Wide circular base
        const mbase = new THREE.Mesh(new THREE.CylinderGeometry(BR + 1.1, BR + 1.3, .38, 12), mat(0x9ab8c8, .82));
        mbase.position.y = .19; g.add(mbase);
        // Sign
        const mss = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTex(p.name, '#1a5276'), transparent: true }));
        mss.position.set(0, BH2 * .38, BR + .18); mss.scale.set(5.0, .82, 1); g.add(mss);
        label(p.name, p.x, BH2 + DR + 2.2, p.z, '#1a3a5a', 5.2);

      // ════════════════════════════════════════════════════════════════════
      } else if (p.id === 'cafe-1991') {
        // ── Cafe 1991 — modern urban cafe, 2-storey ───────────────────────
        const BW = 4.4, BH3 = 3.4, BD = 3.2;
        const cbMat = solidM(0xc07848);
        const cbdy = new THREE.Mesh(new THREE.BoxGeometry(BW, BH3, BD), cbMat);
        cbdy.position.y = BH3 / 2; cbdy.castShadow = true; cbdy.receiveShadow = true;
        cbdy.userData.place = p; interactive.push(cbdy); g.add(cbdy);
        // Mid-floor slab
        box(g, BW + .12, .13, BD + .12, 0, BH3 * .5, 0, mat(0x906040, .9));
        // Ground floor panoramic glass
        const cgm = glassM();
        for (const wx of [-1.3, 0, 1.3]) {
          const wm = new THREE.Mesh(new THREE.PlaneGeometry(1.02, BH3 * .41), cgm);
          wm.position.set(wx, BH3 * .22, BD / 2 + .01); g.add(wm);
          box(g, 1.11, BH3 * .43, .09, wx, BH3 * .22, BD / 2, mat(0x5a3820, .72));
        }
        // 2nd floor windows
        for (const wx of [-1.0, 0, 1.0]) {
          const wm = new THREE.Mesh(new THREE.PlaneGeometry(.88, BH3 * .30), cgm);
          wm.position.set(wx, BH3 * .74, BD / 2 + .01); g.add(wm);
          box(g, .97, BH3 * .32, .09, wx, BH3 * .74, BD / 2, mat(0x5a3820, .72));
        }
        // Entrance door
        const cedr = new THREE.Mesh(new THREE.PlaneGeometry(.78, BH3 * .42), cgm);
        cedr.position.set(0, BH3 * .22, BD / 2 + .02); g.add(cedr);
        // Awning
        box(g, 2.4, .1, 1.15, 0, BH3 * .47, BD / 2 + .50, mat(0x8b3020, .86));
        for (const ax of [-1.05, 1.05]) {
          const ap = new THREE.Mesh(new THREE.CylinderGeometry(.04, .045, BH3 * .47, 7), mat(0x4a2010, .82));
          ap.position.set(ax, BH3 * .235, BD / 2 + .95); g.add(ap);
        }
        // Flat roof + front parapet
        box(g, BW + .22, .13, BD + .22, 0, BH3 + .065, 0, mat(0x786050, .9));
        box(g, BW + .32, .42, .13, 0, BH3 + .28, BD / 2 + .01, mat(0x887060, .9));
        // Terrace railing
        const crMat = mat(0x6a4a30, .82);
        box(g, BW - .2, .06, .06, 0, .95, BD / 2 + .6, crMat);
        for (let ri = 0; ri < 8; ri++) {
          box(g, .04, .95, .04, -BW / 2 + .4 + ri * (BW - .6) / 7, .475, BD / 2 + .6, crMat);
        }
        // Sign
        const css = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTex(p.name, '#6b2a08'), transparent: true }));
        css.position.set(0, BH3 * .93, BD / 2 + .22); css.scale.set(3.8, .72, 1); g.add(css);
        label(p.name, p.x, BH3 + 1.7, p.z, '#8b4513', 4.8);

      // ════════════════════════════════════════════════════════════════════
      } else if (p.id === 'navvat') {
        // ── Navvat — traditional Uzbek restaurant ─────────────────────────
        const BW = 4.6, BH4 = 3.2, BD = 3.4;
        const nbMat = solidM(0xb86030);
        const nbdy = new THREE.Mesh(new THREE.BoxGeometry(BW, BH4, BD), nbMat);
        nbdy.position.y = BH4 / 2; nbdy.castShadow = true; nbdy.receiveShadow = true;
        nbdy.userData.place = p; interactive.push(nbdy); g.add(nbdy);
        // Corner columns
        for (const [ncx, ncz] of [[-BW / 2 + .01, BD / 2 + .02], [BW / 2 - .01, BD / 2 + .02], [-BW / 2 + .01, -BD / 2 - .02], [BW / 2 - .01, -BD / 2 - .02]]) {
          const col = new THREE.Mesh(new THREE.CylinderGeometry(.17, .20, BH4 + .28, 12), mat(0xc87840, .72));
          col.position.set(ncx, BH4 / 2 - .1, ncz); col.castShadow = true; g.add(col);
          const cap = new THREE.Mesh(new THREE.BoxGeometry(.42, .24, .42), mat(0xd89050, .66));
          cap.position.set(ncx, BH4 + .15, ncz); g.add(cap);
        }
        // Main arched portal
        const AW = 1.6, AH = BH4 * .76;
        box(g, .22, AH, .20, -AW / 2 - .11, AH / 2, BD / 2 + .08, mat(0xd09050, .72));
        box(g, .22, AH, .20, AW / 2 + .11, AH / 2, BD / 2 + .08, mat(0xd09050, .72));
        const portalArch = new THREE.Mesh(new THREE.TorusGeometry(AW / 2 * .9, .11, 8, 20, Math.PI), mat(0xd09050, .66));
        portalArch.position.set(0, AH, BD / 2 + .08); portalArch.rotation.z = Math.PI; g.add(portalArch);
        // Portal door glass
        const ndg = new THREE.Mesh(new THREE.PlaneGeometry(AW - .08, AH - .06), glassM());
        ndg.position.set(0, AH / 2, BD / 2 + .12); g.add(ndg);
        // Side niches with arches
        for (const nx of [-BW / 2 + .75, BW / 2 - .75]) {
          box(g, .8, BH4 * .58, .12, nx, BH4 * .38, BD / 2, mat(0xa05828, .86));
          const nt = new THREE.Mesh(new THREE.TorusGeometry(.42, .075, 6, 14, Math.PI), mat(0xc07840, .72));
          nt.position.set(nx, BH4 * .38 + BH4 * .29, BD / 2); nt.rotation.z = Math.PI; g.add(nt);
        }
        // Crenellated parapet (battlements)
        box(g, BW + .18, .16, BD + .18, 0, BH4 + .08, 0, mat(0xc07840, .86));
        for (let bi = 0; bi < 7; bi++) {
          const bx2 = -BW / 2 + .38 + bi * (BW - .55) / 6;
          box(g, .3, .34, .16, bx2, BH4 + .25, BD / 2 + .02, mat(0xb06830, .86));
          box(g, .3, .34, .16, bx2, BH4 + .25, -BD / 2 - .02, mat(0xb06830, .86));
        }
        for (let bi = 0; bi < 5; bi++) {
          const nbz = -BD / 2 + .38 + bi * (BD - .55) / 4;
          box(g, .16, .34, .3, -BW / 2 - .02, BH4 + .25, nbz, mat(0xb06830, .86));
          box(g, .16, .34, .3, BW / 2 + .02, BH4 + .25, nbz, mat(0xb06830, .86));
        }
        // Sign
        const nss = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTex(p.name, '#4a1e08'), transparent: true }));
        nss.position.set(0, BH4 * .92, BD / 2 + .22); nss.scale.set(3.8, .74, 1); g.add(nss);
        label(p.name, p.x, BH4 + 1.7, p.z, '#5a2d0c', 4.8);

      } else {
        // Generic fallback
        const wallHex = '#' + p.color.toString(16).padStart(6, '0');
        const fbMat = winM(wallHex, Math.max(2, Math.round(h * 2.2)), Math.max(2, Math.round(w * 1.4)));
        const fb = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), fbMat);
        fb.position.y = h / 2; fb.castShadow = true; fb.receiveShadow = true;
        fb.userData.place = p; interactive.push(fb); g.add(fb);
        box(g, w + .2, .22, d + .2, 0, h + .11, 0, mat(0x555555, .9));
        label(p.name, p.x, h + 1.8, p.z, '#333a45', Math.min(w * .85, 4));
      }
    }

    g.position.set(p.x, 0, p.z); scene.add(g);
  }

  // Building window glow lights (night mode)
  for (const p of places) {
    if (p.kind !== 'building') continue;
    const [bw, bh, bd] = p.size;
    if (p.id === 'hotel-uzbekistan') {
      // One light per floor for the tall hotel
      for (let fi = 1; fi < 9; fi++) {
        const fl = new THREE.PointLight(0xffd088, 0, 8, 1.7);
        fl.position.set(p.x, fi * 1.0 + 0.2, p.z);
        scene.add(fl); buildingLights.push(fl);
      }
    } else {
      const pl = new THREE.PointLight(0xffd088, 0, 10, 1.7);
      pl.position.set(p.x, bh * 0.55, p.z + bd * 0.5 + 0.6);
      scene.add(pl); buildingLights.push(pl);
      const pl2 = new THREE.PointLight(0xffd088, 0, 9, 1.7);
      pl2.position.set(p.x + bw * 0.45, bh * 0.55, p.z);
      scene.add(pl2); buildingLights.push(pl2);
    }
  }

  // ─── AVATAR SYSTEM ────────────────────────────────────────────────────────
  const remotes = new Map(), targets = new Map();
  let myId = null, lastSend = 0, femaleTemplate = null, maleTemplate = null, avatarLoaded = false, stepPower = 1.0;

  const WORLD_X = new THREE.Vector3(1, 0, 0), WORLD_Y = new THREE.Vector3(0, 1, 0), WORLD_Z = new THREE.Vector3(0, 0, 1);
  const PLAYER_RIGHT = new THREE.Vector3(), PLAYER_FWD = new THREE.Vector3();
  const TMP_Q = new THREE.Quaternion(), TMP_Q2 = new THREE.Quaternion(), TMP_AXIS = new THREE.Vector3(), TMP_AXIS2 = new THREE.Vector3(), TMP_PARENT_Q = new THREE.Quaternion();

  function prep(model) {
    let n = 0; model.traverse(o => {
      if (o.isMesh || o.isSkinnedMesh) {
        n++; o.visible = true; o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true;
        if (o.material) {
          (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
            if (m) { m.side = THREE.DoubleSide; if (m.transparent && m.opacity < .15) m.opacity = 1; m.depthWrite = true; m.needsUpdate = true; }
          });
        }
      }
    }); return n;
  }

  function normalize(original) {
    const wrap = new THREE.Group(), n = prep(original); wrap.add(original);
    original.updateMatrixWorld(true);
    let b = new THREE.Box3().setFromObject(original), s = new THREE.Vector3(), c = new THREE.Vector3();
    b.getSize(s); b.getCenter(c);
    if (!n || Math.max(s.x, s.y, s.z) <= .0001) throw Error('bad avatar');
    const scale = 1.85 / (s.y || Math.max(s.x, s.z) || 1);
    original.scale.multiplyScalar(scale); original.updateMatrixWorld(true);
    b = new THREE.Box3().setFromObject(original); b.getSize(s); b.getCenter(c);
    original.position.x -= c.x; original.position.z -= c.z; original.position.y -= b.min.y;
    wrap.userData.stats = { meshCount: n, height: s.y, scale }; return wrap;
  }

  function fallback(gender) {
    const g = new THREE.Group();
    const bodyColor = gender === 'female' ? 0xe8b4c8 : 0x23384d;
    const legColor = gender === 'female' ? 0x9b59b6 : 0x202331;
    box(g, .38, 1.25, .22, 0, .78, 0, mat(bodyColor));
    const head = new THREE.Mesh(new THREE.SphereGeometry(.18, 18, 18), mat(0xd6b08f));
    head.position.y = 1.55; g.add(head);
    box(g, .12, .72, .12, -.25, .75, 0, mat(bodyColor));
    box(g, .12, .72, .12, .25, .75, 0, mat(bodyColor));
    box(g, .13, .78, .13, -.1, .25, 0, mat(legColor));
    box(g, .13, .78, .13, .1, .25, 0, mat(legColor));
    return g;
  }

  function findBone(root, patterns) {
    let found = null;
    root.traverse(o => {
      if (found || !o.isBone) return;
      const name = (o.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (patterns.some(p => name.includes(p))) found = o;
    }); return found;
  }

  function setupProceduralBones(group) {
    const model = group.userData.root.children[0]; if (!model) return;
    const bones = {
      spine: findBone(model, ['spine', 'chest', 'upperchest']),
      neck: findBone(model, ['neck']),
      head: findBone(model, ['head']),
      lUpperArm: findBone(model, ['leftupperarm', 'leftarm', 'lupperarm', 'mixamorigleftarm']),
      rUpperArm: findBone(model, ['rightupperarm', 'rightarm', 'rupperarm', 'mixamorigrightarm']),
      lForeArm: findBone(model, ['leftforearm', 'leftlowerarm', 'lforearm', 'mixamorigleftforearm']),
      rForeArm: findBone(model, ['rightforearm', 'rightlowerarm', 'rforearm', 'mixamorigrightforearm']),
      lThigh: findBone(model, ['leftupleg', 'leftthigh', 'lthigh', 'mixamorigleftupleg']),
      rThigh: findBone(model, ['rightupleg', 'rightthigh', 'rthigh', 'mixamorigrightupleg']),
      lShin: findBone(model, ['leftleg', 'leftshin', 'leftcalf', 'mixamorigleftleg']),
      rShin: findBone(model, ['rightleg', 'rightshin', 'rightcalf', 'mixamorigrightleg']),
      lFoot: findBone(model, ['leftfoot', 'lfoot', 'mixamorigleftfoot']),
      rFoot: findBone(model, ['rightfoot', 'rfoot', 'mixamorigrightfoot'])
    };
    const base = {}; for (const k in bones) base[k] = bones[k] ? bones[k].quaternion.clone() : null;
    group.userData.procBones = bones; group.userData.procBase = base;
    group.userData.procBoneCount = Object.values(bones).filter(Boolean).length;
  }

  function applyWorldAxis(bone, baseQuat, worldAxis, angle) {
    if (!bone || !baseQuat) return;
    bone.parent.getWorldQuaternion(TMP_PARENT_Q); TMP_PARENT_Q.invert();
    TMP_AXIS.copy(worldAxis).applyQuaternion(TMP_PARENT_Q).normalize();
    TMP_Q.setFromAxisAngle(TMP_AXIS, angle);
    bone.quaternion.copy(TMP_Q).multiply(baseQuat);
  }

  // Composes two world-axis rotations: rest → axis2 rotation → axis1 rotation
  function applyWorldAxes2(bone, baseQuat, axis1, angle1, axis2, angle2) {
    if (!bone || !baseQuat) return;
    bone.parent.getWorldQuaternion(TMP_PARENT_Q); TMP_PARENT_Q.invert();
    TMP_AXIS.copy(axis1).applyQuaternion(TMP_PARENT_Q).normalize();
    TMP_Q.setFromAxisAngle(TMP_AXIS, angle1);
    TMP_AXIS2.copy(axis2).applyQuaternion(TMP_PARENT_Q).normalize();
    TMP_Q2.setFromAxisAngle(TMP_AXIS2, angle2);
    bone.quaternion.copy(TMP_Q).multiply(TMP_Q2).multiply(baseQuat);
  }

  function proceduralWalk(group, moving, running, dt) {
    // Procedural male character direct-part animation
    const rootFirst = group.userData.root && group.userData.root.children[0];
    if (rootFirst && rootFirst.userData.fallbackParts) {
      const p = rootFirst.userData.fallbackParts;
      const t = performance.now() / 1000, speed = running ? 10.5 : 7.2;
      const amp = moving ? (running ? 0.55 : 0.42) * stepPower : 0.02;
      const s = Math.sin(t * speed), c = Math.cos(t * speed);
      p.lLegG.rotation.x = s * amp * 0.95;
      p.rLegG.rotation.x = -s * amp * 0.95;
      p.lKneeG.rotation.x = Math.max(0, -s) * amp * 0.65;
      p.rKneeG.rotation.x = Math.max(0, s) * amp * 0.65;
      p.lArmG.rotation.x = -s * amp * 0.62;
      p.rArmG.rotation.x = s * amp * 0.62;
      p.lElbowG.rotation.x = Math.max(0, s) * amp * 0.45;
      p.rElbowG.rotation.x = Math.max(0, -s) * amp * 0.45;
      group.userData.root.position.y = Math.abs(c) * (moving ? 0.04 : 0.005);
      p.torsoG.rotation.z = s * (moving ? 0.018 : 0.005);
      return;
    }

    const bones = group.userData.procBones, base = group.userData.procBase;
    if (!bones || !base || group.userData.procBoneCount < 4) {
      const t = performance.now() / 1000;
      group.userData.root.position.y = Math.sin(t * 12) * (moving ? .018 : .004); return;
    }
    const t = performance.now() / 1000, speed = running ? 10.5 : 7.2;
    const power = stepPower * (running ? 1.15 : 1), amp = moving ? (running ? .55 : .42) * power : .025;
    const s = Math.sin(t * speed), c = Math.cos(t * speed);
    for (const k in bones) if (bones[k] && base[k]) bones[k].quaternion.copy(base[k]);
    group.userData.root.position.y = Math.abs(c) * (moving ? .03 : .004);
    group.userData.root.rotation.z = s * (moving ? .015 : .004);
    // Character-relative axes: correct swing direction for ANY movement direction
    const ry = group.rotation.y;
    PLAYER_RIGHT.set(Math.cos(ry), 0, -Math.sin(ry));
    PLAYER_FWD.set(Math.sin(ry), 0, Math.cos(ry));
    // Lower arms from T-pose then swing forward/backward relative to character facing
    const armLower = Math.PI * 0.44;
    applyWorldAxes2(bones.lUpperArm, base.lUpperArm, PLAYER_RIGHT, s * amp * .55, PLAYER_FWD, -armLower);
    applyWorldAxes2(bones.rUpperArm, base.rUpperArm, PLAYER_RIGHT, -s * amp * .55, PLAYER_FWD, armLower);
    applyWorldAxes2(bones.lForeArm, base.lForeArm, PLAYER_RIGHT, Math.max(0, s) * amp * .35, PLAYER_FWD, -armLower * 0.28);
    applyWorldAxes2(bones.rForeArm, base.rForeArm, PLAYER_RIGHT, Math.max(0, -s) * amp * .35, PLAYER_FWD, armLower * 0.28);
    // Legs — forward/backward step along character facing
    applyWorldAxis(bones.lThigh, base.lThigh, PLAYER_RIGHT, -s * amp * .95);
    applyWorldAxis(bones.rThigh, base.rThigh, PLAYER_RIGHT, s * amp * .95);
    applyWorldAxis(bones.lShin, base.lShin, PLAYER_RIGHT, Math.max(0, s) * amp * .55);
    applyWorldAxis(bones.rShin, base.rShin, PLAYER_RIGHT, Math.max(0, -s) * amp * .55);
    applyWorldAxis(bones.lFoot, base.lFoot, PLAYER_RIGHT, c * amp * .1);
    applyWorldAxis(bones.rFoot, base.rFoot, PLAYER_RIGHT, -c * amp * .1);
    // Torso/head sway relative to character forward
    applyWorldAxis(bones.spine, base.spine, PLAYER_FWD, s * (moving ? .022 : .005));
    applyWorldAxis(bones.neck, base.neck, PLAYER_FWD, -s * (moving ? .010 : .003));
    applyWorldAxis(bones.head, base.head, WORLD_Y, Math.sin(t * 2) * .015);
  }

  function cloneForGender(template, gender) {
    const clone = cloneSkeleton(template);
    if (gender === 'male') {
      clone.traverse(o => {
        if (!o.isMesh && !o.isSkinnedMesh) return;
        const tint = m => {
          if (!m) return m;
          const nm = m.clone();
          const c = nm.color;
          const r = c.r, gg = c.g, b = c.b;
          const lum = r * 0.299 + gg * 0.587 + b * 0.114;
          // Keep skin-like tones, shift everything else to masculine navy/grey
          const isSkin = r > 0.45 && r > b * 1.25 && gg > 0.28 && lum > 0.28 && lum < 0.78;
          if (!isSkin) {
            const t = Math.min(lum * 1.3, 1);
            c.setRGB(0.06 + t * 0.12, 0.12 + t * 0.16, 0.28 + t * 0.22);
          } else {
            // Slightly deeper male skin
            c.setRGB(r * 0.85, gg * 0.76, b * 0.72);
          }
          if (nm.emissive) nm.emissive.setScalar(0);
          nm.needsUpdate = true; return nm;
        };
        if (Array.isArray(o.material)) o.material = o.material.map(tint);
        else o.material = tint(o.material);
      });
    }
    return clone;
  }

  function getTemplate(gender) {
    if (gender === 'male') return maleTemplate; // null if no male.glb → uses procedural
    return femaleTemplate || maleTemplate;
  }

  function makeFaceTex(skinHex, hairHex) {
    const S = 512, c = document.createElement('canvas'); c.width = S; c.height = S;
    const ctx = c.getContext('2d');
    // Teri rangi gradient
    const grad = ctx.createRadialGradient(S/2,S*0.44,20, S/2,S*0.5,S*0.48);
    grad.addColorStop(0, skinHex);
    grad.addColorStop(1, shadeHex(skinHex, -18));
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(S/2,S/2,S*0.47,0,Math.PI*2); ctx.fill();
    // Yonoq qizilligi
    for (const cx of [S*0.3, S*0.7]) {
      const rg = ctx.createRadialGradient(cx,S*0.57,0, cx,S*0.57,S*0.13);
      rg.addColorStop(0,'rgba(220,100,90,0.18)'); rg.addColorStop(1,'rgba(220,100,90,0)');
      ctx.fillStyle=rg; ctx.beginPath(); ctx.arc(cx,S*0.57,S*0.13,0,Math.PI*2); ctx.fill();
    }
    // Qosh
    ctx.fillStyle=hairHex; ctx.lineCap='round';
    for (const [bx,dir] of [[S*0.345,-1],[S*0.655,1]]) {
      ctx.save(); ctx.translate(bx,S*0.38); ctx.rotate(dir*0.06);
      ctx.beginPath(); ctx.roundRect(-S*0.09,-S*0.018,S*0.18,S*0.036,S*0.018); ctx.fill(); ctx.restore();
    }
    // Ko'z olmalari (oq)
    for (const ex of [S*0.345, S*0.655]) {
      ctx.fillStyle='white'; ctx.beginPath(); ctx.ellipse(ex,S*0.455,S*0.072,S*0.048,0,0,Math.PI*2); ctx.fill();
      // Rangdor qism
      const ig = ctx.createRadialGradient(ex,S*0.455,0, ex,S*0.455,S*0.038);
      ig.addColorStop(0,'#1a2a40'); ig.addColorStop(0.6,'#2c4a6e'); ig.addColorStop(1,'#1a2a40');
      ctx.fillStyle=ig; ctx.beginPath(); ctx.arc(ex,S*0.455,S*0.038,0,Math.PI*2); ctx.fill();
      // Qorachiq
      ctx.fillStyle='#050808'; ctx.beginPath(); ctx.arc(ex,S*0.455,S*0.020,0,Math.PI*2); ctx.fill();
      // Ko'zda nur
      ctx.fillStyle='rgba(255,255,255,0.75)'; ctx.beginPath(); ctx.arc(ex+S*0.016,S*0.442,S*0.008,0,Math.PI*2); ctx.fill();
      // Ko'z qovoq
      ctx.strokeStyle=shadeHex(skinHex,-25); ctx.lineWidth=3;
      ctx.beginPath(); ctx.ellipse(ex,S*0.455,S*0.072,S*0.048,0,Math.PI,Math.PI*2); ctx.stroke();
    }
    // Burun
    ctx.strokeStyle='rgba(0,0,0,0.14)'; ctx.lineWidth=5; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(S*0.5,S*0.48); ctx.bezierCurveTo(S*0.48,S*0.55,S*0.46,S*0.58,S*0.46,S*0.60);
    ctx.bezierCurveTo(S*0.48,S*0.63,S*0.52,S*0.635,S*0.54,S*0.60);
    ctx.bezierCurveTo(S*0.54,S*0.58,S*0.52,S*0.55,S*0.5,S*0.48); ctx.stroke();
    // Lab
    ctx.fillStyle='#b86050';
    ctx.beginPath(); ctx.ellipse(S/2,S*0.675,S*0.082,S*0.030,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#d07060';
    ctx.beginPath(); ctx.ellipse(S/2,S*0.665,S*0.072,S*0.022,0,0,Math.PI); ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,0.12)'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(S*0.418,S*0.672); ctx.bezierCurveTo(S*0.46,S*0.658,S*0.54,S*0.658,S*0.582,S*0.672); ctx.stroke();
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; return tx;
  }
  function makeShirtTex(shirtHex) {
    const S=256, c=document.createElement('canvas'); c.width=S; c.height=S;
    const ctx=c.getContext('2d');
    ctx.fillStyle=shirtHex; ctx.fillRect(0,0,S,S);
    // Yoqa (collar)
    ctx.fillStyle=shadeHex(shirtHex,10);
    ctx.beginPath(); ctx.moveTo(S*0.38,0); ctx.lineTo(S*0.5,S*0.22); ctx.lineTo(S*0.62,0); ctx.fill();
    ctx.fillStyle=shadeHex(shirtHex,-8);
    ctx.beginPath(); ctx.moveTo(S*0.44,0); ctx.lineTo(S*0.5,S*0.18); ctx.lineTo(S*0.56,0); ctx.fill();
    // Tugmalar
    ctx.fillStyle=shadeHex(shirtHex,-20);
    for (let i=0; i<5; i++) { ctx.beginPath(); ctx.arc(S/2, S*0.28+i*S*0.14, 4, 0, Math.PI*2); ctx.fill(); }
    // Ko'krak cho'ntagi
    ctx.strokeStyle=shadeHex(shirtHex,-15); ctx.lineWidth=1.5;
    ctx.strokeRect(S*0.2,S*0.3,S*0.18,S*0.14);
    const tx=new THREE.CanvasTexture(c); tx.colorSpace=THREE.SRGBColorSpace; return tx;
  }
  function shadeHex(hex, amt) {
    const n=parseInt(typeof hex==='string'?hex.replace('#',''):hex.toString(16).padStart(6,'0'),16);
    const r=Math.max(0,Math.min(255,((n>>16)&0xff)+amt));
    const g=Math.max(0,Math.min(255,((n>>8)&0xff)+amt));
    const b=Math.max(0,Math.min(255,(n&0xff)+amt));
    return `#${((r<<16)|(g<<8)|b).toString(16).padStart(6,'0')}`;
  }

  function makeMaleProceduralAvatar() {
    const g = new THREE.Group();
    const SKIN=0xd4956a, SHIRT=0x2c4a6e, PANTS=0x1c2b3a, HAIR=0x1a0e08, SHOE=0x1a120a;
    const sm  = (c, r=0.82) => new THREE.MeshStandardMaterial({ color:c, roughness:r });
    const cyl = (rt,rb,h,n,c) => { const m=new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,n),sm(c)); m.castShadow=true; return m; };
    const sph = (r,n,c)       => { const m=new THREE.Mesh(new THREE.SphereGeometry(r,n,n),sm(c)); m.castShadow=true; return m; };
    const bx  = (w,h,d,c)     => { const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),sm(c)); m.castShadow=true; return m; };
    const at  = (p,m,x,y,z)   => { m.position.set(x,y,z); p.add(m); return m; };

    // ── OYOQLAR (hip pivot) ───────────────────────────────────────────────────
    const lLegG=new THREE.Group(); lLegG.position.set(-0.105,0.82,0); g.add(lLegG);
    at(lLegG, cyl(0.088,0.094,0.44,14,PANTS), 0,-0.22,0);
    const lKneeG=new THREE.Group(); lKneeG.position.set(0,-0.44,0); lLegG.add(lKneeG);
    at(lKneeG, sph(0.095,12,PANTS), 0,0,0);
    at(lKneeG, cyl(0.076,0.080,0.40,12,PANTS), 0,-0.20,0);
    at(lKneeG, bx(0.14,0.07,0.24,SHOE), 0,-0.415,0.04);

    const rLegG=new THREE.Group(); rLegG.position.set(0.105,0.82,0); g.add(rLegG);
    at(rLegG, cyl(0.088,0.094,0.44,14,PANTS), 0,-0.22,0);
    const rKneeG=new THREE.Group(); rKneeG.position.set(0,-0.44,0); rLegG.add(rKneeG);
    at(rKneeG, sph(0.095,12,PANTS), 0,0,0);
    at(rKneeG, cyl(0.076,0.080,0.40,12,PANTS), 0,-0.20,0);
    at(rKneeG, bx(0.14,0.07,0.24,SHOE), 0,-0.415,0.04);

    // ── TANA (shirt tekstura bilan) ────────────────────────────────────────────
    const shirtTex = makeShirtTex('#2c4a6e');
    const smShirt = new THREE.MeshStandardMaterial({ map:shirtTex, roughness:0.82 });
    const torsoG=new THREE.Group(); torsoG.position.set(0,0.82,0); g.add(torsoG);
    at(torsoG, cyl(0.168,0.178,0.08,16,0x2c1a08), 0,0.04,0);
    const bodyC=new THREE.Mesh(new THREE.CylinderGeometry(0.172,0.168,0.50,16),smShirt); bodyC.castShadow=true; bodyC.position.set(0,0.29,0); torsoG.add(bodyC);
    at(torsoG, sph(0.190,16,SHIRT), 0,0.44,0);
    at(torsoG, cyl(0.200,0.172,0.10,16,SHIRT), 0,0.535,0);

    // ── QOLLAR (shoulder pivot) ────────────────────────────────────────────────
    at(g, sph(0.108,12,SHIRT), -0.308,1.345,0);
    at(g, sph(0.108,12,SHIRT),  0.308,1.345,0);

    const lArmG=new THREE.Group(); lArmG.position.set(-0.308,1.345,0); g.add(lArmG);
    at(lArmG, cyl(0.068,0.074,0.38,12,SHIRT), 0,-0.19,0);
    const lElbowG=new THREE.Group(); lElbowG.position.set(0,-0.38,0); lArmG.add(lElbowG);
    at(lElbowG, sph(0.076,10,SKIN), 0,0,0);
    at(lElbowG, cyl(0.058,0.064,0.34,10,SKIN), 0,-0.17,0);
    at(lElbowG, sph(0.062,10,SKIN), 0,-0.345,0);
    at(lElbowG, bx(0.09,0.07,0.055,SKIN), 0,-0.415,0.01);

    const rArmG=new THREE.Group(); rArmG.position.set(0.308,1.345,0); g.add(rArmG);
    at(rArmG, cyl(0.068,0.074,0.38,12,SHIRT), 0,-0.19,0);
    const rElbowG=new THREE.Group(); rElbowG.position.set(0,-0.38,0); rArmG.add(rElbowG);
    at(rElbowG, sph(0.076,10,SKIN), 0,0,0);
    at(rElbowG, cyl(0.058,0.064,0.34,10,SKIN), 0,-0.17,0);
    at(rElbowG, sph(0.062,10,SKIN), 0,-0.345,0);
    at(rElbowG, bx(0.09,0.07,0.055,SKIN), 0,-0.415,0.01);

    // ── BO'YIN ────────────────────────────────────────────────────────────────
    at(g, cyl(0.074,0.090,0.18,12,SKIN), 0,1.485,0);

    // ── BOŠ (canvas tekstura yuz bilan) ──────────────────────────────────────
    const headG=new THREE.Group(); headG.position.set(0,1.67,0); g.add(headG);
    // Asosiy bosh shari — teri rangi
    const headMesh=new THREE.Mesh(new THREE.SphereGeometry(0.215,22,18),sm(SKIN,0.75));
    headMesh.scale.set(0.92,1.0,0.90); headMesh.castShadow=true; headG.add(headMesh);
    // Jag' qismi
    const jawMesh=sph(0.192,14,SKIN); jawMesh.scale.set(0.9,0.72,0.88); at(headG,jawMesh,0,-0.105,0.028);
    // Canvas yuz teksturasi — doira sifatida oldingi tomoniga yopishtiriladi
    const faceTex=makeFaceTex('#d4956a','#1a0e08');
    const facePlane=new THREE.Mesh(
      new THREE.CircleGeometry(0.195,32),
      new THREE.MeshStandardMaterial({ map:faceTex, transparent:true, roughness:0.7, depthWrite:false })
    );
    facePlane.position.set(0,0,0.190); headG.add(facePlane);
    // Quloqlar
    for (const sx of [-0.205,0.205]) { const ear=sph(0.032,8,SKIN); ear.scale.z=0.48; at(headG,ear,sx,0.008,0); }
    // Soch — qisqa erkakcha
    const hm=sm(HAIR,0.9);
    const hTop=new THREE.Mesh(new THREE.SphereGeometry(0.225,16,10,0,Math.PI*2,0,Math.PI*0.48),hm);
    hTop.position.set(0,0.07,-0.015); headG.add(hTop);
    const hSide=new THREE.Mesh(new THREE.BoxGeometry(0.46,0.10,0.40),hm);
    hSide.position.set(0,0.14,0); headG.add(hSide);
    const hBack=new THREE.Mesh(new THREE.CylinderGeometry(0.16,0.14,0.12,12),hm);
    hBack.position.set(0,0.06,-0.175); headG.add(hBack);

    g.userData.fallbackParts = { lLegG,rLegG,lKneeG,rKneeG,lArmG,rArmG,lElbowG,rElbowG,torsoG,headG };
    return g;
  }

  function makeAvatar(name, gender) {
    const g = new THREE.Group(), root = new THREE.Group();
    g.userData.root = root; g.add(root);
    const tmpl = getTemplate(gender);
    if (tmpl) {
      root.add(cloneForGender(tmpl, gender));
    } else if (gender === 'male') {
      root.add(makeMaleProceduralAvatar());
    } else {
      root.add(fallback(gender));
    }
    const nl = nameSprite(name, gender);
    nl.position.y = tmpl ? 2.35 : 2.15;
    g.add(nl); g.userData.nameLabel = nl; g.userData.name = name; g.userData.gender = gender;
    if (tmpl) setupProceduralBones(g); return g;
  }

  function applyAvatar(g) {
    while (g.userData.root.children.length) g.userData.root.remove(g.userData.root.children[0]);
    const gender = g.userData.gender;
    const tmpl = getTemplate(gender);
    if (tmpl) {
      g.userData.root.add(cloneForGender(tmpl, gender));
      g.userData.nameLabel.position.y = 2.35;
      setupProceduralBones(g);
    } else if (gender === 'male') {
      g.userData.root.add(makeMaleProceduralAvatar());
      g.userData.nameLabel.position.y = 2.35;
    }
  }

  // My player
  const player = makeAvatar(currentUser.fullname || 'Вы', currentUser.gender);
  player.position.set(0, 0, 10);
  player.userData.userId = currentUser.id;
  scene.add(player);

  new GLTFLoader().load('./assets/models/player.glb', gltf => {
    try {
      femaleTemplate = normalize(gltf.scene); avatarLoaded = true;
      applyAvatar(player);
      for (const g of remotes.values()) applyAvatar(g);
      const st = femaleTemplate.userData.stats;
      statusEl.textContent = `Avatar: meshes=${st.meshCount}, h=${st.height.toFixed(2)}, world-axis`;
    } catch (e) { statusEl.textContent = 'GLB loaded but bad bounds'; console.error(e); }
  }, null, () => { statusEl.textContent = 'Fallback avatar'; });

  // male.glb ixtiyoriy — assets/models/male.glb qo'yilsa avtomatik ishlatiladi
  fetch('./assets/models/male.glb', { method: 'HEAD' }).then(r => {
    if (!r.ok) return;
    new GLTFLoader().load('./assets/models/male.glb', gltf => {
      try {
        maleTemplate = normalize(gltf.scene);
        if (player.userData.gender === 'male') applyAvatar(player);
        for (const g of remotes.values()) { if (g.userData.gender === 'male') applyAvatar(g); }
      } catch (e) { console.error('male.glb error', e); }
    });
  }).catch(() => {});

  // ─── INPUT ────────────────────────────────────────────────────────────────
  const keys = {}, chatInput = document.getElementById('chat-input');
  const joystick = { dx: 0, dz: 0 };

  addEventListener('keydown', e => {
    if (document.activeElement === chatInput) return;
    tryStartMusic();
    keys[e.key.toLowerCase()] = true;
    if (e.key === 'Enter') chatInput.focus();
    if (e.key.toLowerCase() === 'e') openNearest();
    if (e.key.toLowerCase() === 'v') toggleCamView();
    if (e.key === '[') { stepPower = Math.max(.4, stepPower - .1); statusEl.textContent = `Шаг: ${stepPower.toFixed(1)}`; }
    if (e.key === ']') { stepPower = Math.min(1.8, stepPower + .1); statusEl.textContent = `Шаг: ${stepPower.toFixed(1)}`; }
  });
  addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

  chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const m = chatInput.value.trim();
      if (m) socket.emit('chatMessage', m);
      chatInput.value = ''; chatInput.blur();
    }
  });

  // Click on canvas: ray-cast players & places (skip if it was a drag)
  renderer.domElement.addEventListener('click', e => {
    tryStartMusic();
    if (_rMoved) return;
    if (document.activeElement === chatInput) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    // Check remote players (click to view profile)
    const allPlayerMeshes = [];
    for (const [id, g] of remotes) {
      g.traverse(o => { if (o.isMesh || o.isSkinnedMesh) allPlayerMeshes.push({ mesh: o, group: g, socketId: id }); });
    }
    if (allPlayerMeshes.length) {
      const hits = raycaster.intersectObjects(allPlayerMeshes.map(p => p.mesh), false);
      if (hits.length) {
        const hit = allPlayerMeshes.find(p => p.mesh === hits[0].object);
        if (hit && hit.group.userData.userId) {
          window.openProfileModal && window.openProfileModal(hit.group.userData.userId);
          return;
        }
      }
    }

    // Check interactive places
    const placeHits = raycaster.intersectObjects(interactive, true);
    if (placeHits.length) {
      let obj = placeHits[0].object;
      while (obj && !obj.userData.place) obj = obj.parent;
      if (obj?.userData?.place) {
        window.openPlaceCard && window.openPlaceCard(obj.userData.place);
      }
    }
  });

  // ─── PLAYER UPDATE ────────────────────────────────────────────────────────
  function updatePlayer(dt) {
    // ввод в «экранных» осях: W — вперёд (−Z), D — вправо (+X)
    let ix = 0, iz = 0;
    if (keys.w) iz -= 1; if (keys.s) iz += 1;
    if (keys.a) ix -= 1; if (keys.d) ix += 1;
    ix += joystick.dx; iz += joystick.dz;
    // поворачиваем ввод на угол камеры → движение относительно камеры
    const cY = Math.cos(camYaw), sY = Math.sin(camYaw);
    const d = new THREE.Vector3(ix * cY + iz * sY, 0, -ix * sY + iz * cY);
    const m = d.lengthSq() > 0.01;
    if (m) {
      d.normalize();
      player.position.addScaledVector(d, (keys.shift ? 7.8 : 4.6) * dt);
      player.position.x = THREE.MathUtils.clamp(player.position.x, -31, 31);
      player.position.z = THREE.MathUtils.clamp(player.position.z, -23, 23);
      player.rotation.y = Math.atan2(d.x, d.z);
    }
    proceduralWalk(player, m, keys.shift, dt);
    const now = performance.now();
    if (now - lastSend > 50) {
      lastSend = now;
      socket.emit('playerMove', { x: player.position.x, z: player.position.z, rotationY: player.rotation.y });
    }
  }

  // ─── REMOTE PLAYERS ───────────────────────────────────────────────────────
  function addRemote(p) {
    if (p.id === myId || remotes.has(p.id)) return;
    const g = makeAvatar(p.name, p.gender);
    g.position.set(p.x || 0, 0, p.z || 10);
    g.rotation.y = p.rotationY || 0;
    g.userData.userId = p.userId;
    scene.add(g); remotes.set(p.id, g);
    targets.set(p.id, { x: p.x || 0, z: p.z || 10, rotationY: p.rotationY || 0 });
  }

  function updateRemotes(dt) {
    for (const [id, g] of remotes) {
      const t = targets.get(id), old = g.position.clone();
      g.position.lerp(new THREE.Vector3(t.x, 0, t.z), .18);
      g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, t.rotationY, .18);
      proceduralWalk(g, old.distanceTo(g.position) > .01, false, dt);
    }
  }

  function onlineCount() {
    document.getElementById('online').textContent = `Онлайн: ${remotes.size + 1}`;
  }

  // ─── NEAREST PLACE ────────────────────────────────────────────────────────
  function nearest() {
    let best = null;
    for (const p of places) {
      const dist = Math.hypot(player.position.x - p.x, player.position.z - p.z);
      if (!best || dist < best.dist) best = { p, dist };
    }
    return best;
  }
  function openNearest() {
    const n = nearest(); if (n && n.dist < 4) window.openPlaceCard && window.openPlaceCard(n.p);
  }
  function nearUI() {
    const n = nearest();
    const isNear = n && n.dist < 3.8;
    document.getElementById('nearby').textContent = isNear ? `Рядом: ${n.p.name}` : 'Подойдите к объекту';
    const mb = document.getElementById('mobile-open-btn');
    if (mb) mb.classList.toggle('hidden', !isNear);
  }

  // ─── CAMERA — orbit with right-click drag ────────────────────────────────
  let camYaw   = Math.atan2(11, 17);          // initial horizontal angle ≈ 33°
  let camPitch = Math.atan2(16, Math.hypot(11, 17)); // initial vertical ≈ 38°
  // Two view presets: 0 = far (обзор), 1 = near (крупный план). Toggle with V / button.
  const CAM_VIEWS = [
    { dist: 22, pitch: Math.atan2(16, Math.hypot(11, 17)) }, // далёкий обзор (как сейчас)
    { dist: 8,  pitch: 0.34 },                               // вид вблизи
  ];
  let camView = 0;
  let CAM_R   = CAM_VIEWS[0].dist;
  const _camTarget = new THREE.Vector3();

  function toggleCamView() {
    camView = (camView + 1) % CAM_VIEWS.length;
    CAM_R = CAM_VIEWS[camView].dist;
    camPitch = CAM_VIEWS[camView].pitch; // yaw сохраняется, позиция плавно долетит (lerp)
    const btn = document.getElementById('cam-btn');
    if (btn) btn.title = camView === 0 ? 'Вид: обзор (нажмите — крупный план)' : 'Вид: крупный план (нажмите — обзор)';
    if (statusEl) statusEl.textContent = camView === 0 ? 'Камера: обзор' : 'Камера: вблизи';
  }
  window._toggleCamView = toggleCamView;

  // Left-click drag → orbit  (click without move → raycasting kept)
  let _rDrag = false, _rMoved = false, _rLastX = 0, _rLastY = 0;
  renderer.domElement.addEventListener('mousedown', e => {
    if (e.button === 0) { _rDrag = true; _rMoved = false; _rLastX = e.clientX; _rLastY = e.clientY; }
  });
  renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('mouseup', e => { if (e.button === 0) _rDrag = false; });
  window.addEventListener('mousemove', e => {
    if (!_rDrag) return;
    const dx = e.clientX - _rLastX, dy = e.clientY - _rLastY;
    if (!_rMoved && Math.hypot(dx, dy) > 4) _rMoved = true;
    if (!_rMoved) return;
    camYaw   -= dx * 0.007;
    camPitch  = Math.max(0.10, Math.min(1.35, camPitch + dy * 0.005));
    _rLastX = e.clientX; _rLastY = e.clientY;
  });

  // Touch: one-finger drag on canvas → orbit; two-finger drag → orbit
  let _tPrev = null, _tSingle = null, _tSingleMoved = false;
  renderer.domElement.addEventListener('touchstart', e => {
    _rMoved = false;
    if (e.touches.length === 2) {
      _tSingle = null;
      _tPrev = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
    } else if (e.touches.length === 1) {
      _tSingle = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      _tSingleMoved = false;
    }
  }, { passive: true });
  window.addEventListener('touchmove', e => {
    if (e.touches.length === 2 && _tPrev) {
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      camYaw   -= (cx - _tPrev.x) * 0.007;
      camPitch  = Math.max(0.10, Math.min(1.35, camPitch + (cy - _tPrev.y) * 0.005));
      _tPrev = { x: cx, y: cy };
    } else if (e.touches.length === 1 && _tSingle) {
      const dx = e.touches[0].clientX - _tSingle.x;
      const dy = e.touches[0].clientY - _tSingle.y;
      if (!_tSingleMoved && Math.hypot(dx, dy) > 8) _tSingleMoved = true;
      if (_tSingleMoved) {
        _rMoved = true;
        camYaw   -= dx * 0.007;
        camPitch  = Math.max(0.10, Math.min(1.35, camPitch + dy * 0.005));
      }
      _tSingle = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  }, { passive: true });
  window.addEventListener('touchend', e => {
    if (e.touches.length === 0) { _tPrev = null; _tSingle = null; _tSingleMoved = false; }
  });

  // Virtual joystick touch handlers
  const jZone = document.getElementById('joystick-zone');
  const jKnob = document.getElementById('joystick-knob');
  if (jZone) {
    const JR = 38;
    let jCenter = null;
    jZone.addEventListener('touchstart', e => {
      e.preventDefault();
      const r = jZone.getBoundingClientRect();
      jCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, { passive: false });
    jZone.addEventListener('touchmove', e => {
      e.preventDefault();
      if (!jCenter) return;
      let dx = e.touches[0].clientX - jCenter.x;
      let dy = e.touches[0].clientY - jCenter.y;
      const dist = Math.hypot(dx, dy);
      if (dist > JR) { dx = dx / dist * JR; dy = dy / dist * JR; }
      jKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      joystick.dx = dx / JR;
      joystick.dz = dy / JR;
    }, { passive: false });
    jZone.addEventListener('touchend', () => {
      jCenter = null;
      jKnob.style.transform = 'translate(-50%, -50%)';
      joystick.dx = 0; joystick.dz = 0;
    });
  }

  // Laptop touchpad: two-finger swipe fires wheel events
  renderer.domElement.addEventListener('wheel', e => {
    e.preventDefault();
    if (e.ctrlKey) return; // pinch-to-zoom — ignore
    const s = e.deltaMode === 0 ? 0.003 : 0.06; // pixels (touchpad) vs lines (mouse wheel)
    camYaw   -= e.deltaX * s;
    camPitch  = Math.max(0.10, Math.min(1.35, camPitch - e.deltaY * s));
  }, { passive: false });

  function cam() {
    const t = player.position;
    const cP = Math.cos(camPitch), sP = Math.sin(camPitch);
    const cY = Math.cos(camYaw),   sY = Math.sin(camYaw);
    _camTarget.set(
      t.x + sY * cP * CAM_R,
      t.y + sP * CAM_R,
      t.z + cY * cP * CAM_R
    );
    camera.position.lerp(_camTarget, .08);
    camera.lookAt(t.x, t.y + 0.9, t.z);
  }

  // ─── DAY / NIGHT CYCLE ───────────────────────────────────────────────────────
  function getDayness() {
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    if (h >= 7 && h < 20) return 1;
    if (h >= 22 || h < 5) return 0;
    if (h >= 5 && h < 7) return (h - 5) / 2;
    return (22 - h) / 2;
  }
  const _dc = new THREE.Color();
  function applyDayNight(d) {
    skyMat.uniforms.top.value.set(0x020814).lerp(_dc.set(0x0f4a9e), d);
    skyMat.uniforms.bottom.value.set(0x061224).lerp(_dc.set(0x7ab8e8), d);
    scene.fog.color.set(0x081020).lerp(_dc.set(0x7ab8e8), d);
    scene.fog.near = 70 + 30 * d; scene.fog.far = 140 + 80 * d;
    sun.intensity = 0.18 + 3.02 * d;
    sun.color.set(0x334466).lerp(_dc.set(0xfff8e8), d);
    hemi.intensity = 0.22 + 1.58 * d;
    hemi.color.set(0x050a18).lerp(_dc.set(0xfff4e0), d);
    hemi.groundColor.set(0x020804).lerp(_dc.set(0x7ca36d), d);
    const li = (1 - d) * 9.0;
    for (const l of lampLights) l.intensity = li;
    const bli = (1 - d) * 6.0;
    for (const l of buildingLights) l.intensity = bli;
    const ei = (1 - d) * 2.2;
    for (const m of buildingMaterials) m.emissiveIntensity = ei;
    playerLight.intensity = (1 - d) * 2.5;
    renderer.toneMappingExposure = 0.80 + 0.65 * d;
  }
  let targetDayness = getDayness(), currentDayness = targetDayness, lastDayCheck = 0;
  applyDayNight(currentDayness);

  // ─── AUDIO ───────────────────────────────────────────────────────────────────
  const bgMusic = new Audio('/assets/music/Lonely.mp3');
  bgMusic.loop = true; bgMusic.volume = 0.22;
  let _musicStarted = false;
  window._musicMuted = false;
  window._toggleMusic = function () {
    window._musicMuted = !window._musicMuted;
    bgMusic.muted = window._musicMuted;
    if (!_musicStarted && !window._musicMuted) { bgMusic.play().catch(() => {}); _musicStarted = true; }
    return window._musicMuted;
  };
  function tryStartMusic() {
    if (_musicStarted || window._musicMuted) return;
    bgMusic.play().then(() => { _musicStarted = true; }).catch(() => {});
  }

  // ─── SOCKET EVENTS ────────────────────────────────────────────────────────
  socket.on('connect', () => {
    myId = socket.id;
    socket.emit('identify', currentUser.id);
    socket.emit('getPlayers');
  });
  // Сокет уже мог подключиться на главной — берём снимок игроков сразу
  if (socket.connected) { myId = socket.id; socket.emit('getPlayers'); }
  socket.on('currentPlayers', ps => { Object.values(ps).forEach(addRemote); onlineCount(); });
  socket.on('playerJoined', p => { addRemote(p); onlineCount(); });
  socket.on('playerMoved', p => {
    if (p.id === myId) return;
    if (!remotes.has(p.id)) addRemote(p);
    Object.assign(targets.get(p.id), { x: p.x, z: p.z, rotationY: p.rotationY });
  });
  socket.on('playerLeft', id => {
    const g = remotes.get(id); if (g) { scene.remove(g); remotes.delete(id); targets.delete(id); onlineCount(); }
  });
  socket.on('playerUpdated', p => {
    const g = p.id === myId ? player : remotes.get(p.id);
    if (g) { setName(g, p.name, p.gender); if (p.userId) g.userData.userId = p.userId; }
  });
  socket.on('chatMessage', d => {
    const log = document.getElementById('chat-log'), line = document.createElement('div');
    line.innerHTML = '<span class="chat-name"></span>: <span></span>';
    line.children[0].textContent = d.name; line.children[1].textContent = d.message;
    log.appendChild(line); log.scrollTop = log.scrollHeight;
  });
  // Уведомления / счётчик / личные сообщения обрабатываются в ui.js (ensureSocket),
  // т.к. сокет общий и подключается ещё на главной странице.

  // Expose socket and controls to UI
  window._skverMyId = () => myId;
  window._openNearest = openNearest;

  // ─── ANIMATION LOOP ───────────────────────────────────────────────────────
  function faceLabels() {
    labels.forEach(l => l.lookAt(camera.position));
    player.userData.nameLabel.lookAt(camera.position);
    for (const g of remotes.values()) g.userData.nameLabel.lookAt(camera.position);
  }

  let last = performance.now();
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min((now - last) / 1000, .033); last = now;
    // Day/Night smooth transition
    if (now - lastDayCheck > 12000) { lastDayCheck = now; targetDayness = getDayness(); }
    currentDayness += (targetDayness - currentDayness) * Math.min(dt * 0.4, 1);
    applyDayNight(currentDayness);
    updatePlayer(dt); updateRemotes(dt); nearUI(); cam(); faceLabels();
    playerLight.position.x = player.position.x; playerLight.position.z = player.position.z;
    // Animate fountain ripple rings — expand outward and fade
    const t = now / 1000;
    for (const { mesh, phase } of fountainAnimObjects) {
      const pulse = (Math.sin(t * 1.1 + phase) + 1) * .5;
      mesh.scale.setScalar(.55 + pulse * .7);
      mesh.material.opacity = .48 * (1 - pulse * .82);
    }
    renderer.render(scene, camera);
  }
  loop(last);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}
