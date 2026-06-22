// Интерактивный 3D-глобус для главной (landing) страницы.
// Точечная сфера + атмосфера + звёзды, медленное вращение и параллакс от курсора.
import * as THREE from 'three';

export function initHomeGlobe() {
  const canvas = document.getElementById('home-globe');
  if (!canvas) return;
  const homePage = document.getElementById('home-page');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 3000);
  camera.position.set(0, 0, 330);

  const root = new THREE.Group();
  root.rotation.z = 0.32;            // лёгкий наклон оси
  scene.add(root);

  const R = 100;

  // круглая текстура для точек
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const cx2 = c.getContext('2d');
  const grd = cx2.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(170,224,255,0.95)');
  grd.addColorStop(1, 'rgba(170,224,255,0)');
  cx2.fillStyle = grd; cx2.beginPath(); cx2.arc(32, 32, 32, 0, Math.PI * 2); cx2.fill();
  const sprite = new THREE.CanvasTexture(c);

  // точечный глобус (распределение Фибоначчи)
  const N = 2600;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const phi = i * Math.PI * (3 - Math.sqrt(5));
    pos[i * 3] = Math.cos(phi) * r * R;
    pos[i * 3 + 1] = y * R;
    pos[i * 3 + 2] = Math.sin(phi) * r * R;
  }
  const dotGeo = new THREE.BufferGeometry();
  dotGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dots = new THREE.Points(dotGeo, new THREE.PointsMaterial({
    size: 2.7, map: sprite, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, color: 0x9fe0ff,
  }));
  root.add(dots);

  // тонкий каркас
  root.add(new THREE.Mesh(
    new THREE.SphereGeometry(R * 0.985, 36, 24),
    new THREE.MeshBasicMaterial({ color: 0x1c5495, wireframe: true, transparent: true, opacity: 0.16 })
  ));

  // непрозрачное ядро — перекрывает точки на обратной стороне
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(R * 0.955, 48, 32),
    new THREE.MeshBasicMaterial({ color: 0x07111f })
  );
  root.add(core);

  // свечение атмосферы (френель)
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.2, 48, 32),
    new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
      uniforms: { glowColor: { value: new THREE.Color(0x3aa0ff) }, p: { value: 3.2 } },
      vertexShader: `varying float intensity; uniform float p;
        void main(){ vec3 n=normalize(normalMatrix*normal); vec3 vp=normalize((modelViewMatrix*vec4(position,1.)).xyz);
        intensity=pow(1.0-dot(n,vp), p); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `varying float intensity; uniform vec3 glowColor;
        void main(){ gl_FragColor=vec4(glowColor*intensity, intensity);}`,
    })
  );
  scene.add(atmo);

  // звёзды
  const SN = 800;
  const sp = new Float32Array(SN * 3);
  for (let i = 0; i < SN; i++) {
    const rr = 650 + Math.random() * 900;
    const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 2 - 1);
    sp[i * 3] = rr * Math.sin(ph) * Math.cos(th);
    sp[i * 3 + 1] = rr * Math.sin(ph) * Math.sin(th);
    sp[i * 3 + 2] = rr * Math.cos(ph);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({
    size: 1.7, map: sprite, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, color: 0xbcd8ff, opacity: 0.85,
  })));

  // параллакс от курсора
  let tx = 0, ty = 0, cxp = 0, cyp = 0;
  addEventListener('pointermove', e => { tx = e.clientX / innerWidth - 0.5; ty = e.clientY / innerHeight - 0.5; });

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize); resize();

  function loop() {
    requestAnimationFrame(loop);
    if (homePage && homePage.style.display === 'none') return;   // не рендерим, когда скрыто
    root.rotation.y += 0.0016;
    cxp += (tx - cxp) * 0.04; cyp += (ty - cyp) * 0.04;
    camera.position.x = cxp * 60;
    camera.position.y = -cyp * 40;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  }
  loop();
}
