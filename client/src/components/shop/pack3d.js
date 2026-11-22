// Caixinhas da Loja em 3D de verdade.
//
// O modelo é o mesmo do Blender (tools/loja-3d/render.py → caixinha.glb):
// a caixinha de plástico (frente, quatro laterais com espessura e cantos
// arredondados), a aba com o furo e o gancho cromado que passa por ele. Aqui
// ele é desenhado ao vivo com three.js, então gira de verdade no gancho
// conforme o mouse/dedo, balança como um pêndulo e o brilho do plástico anda
// com a luz.
//
// Desempenho: é UM motor WebGL só pra página inteira. Cada caixinha tem um
// <canvas> 2D comum; o motor desenha a caixinha e copia o quadro pra ele. Só
// redesenha a caixinha que está mexendo (as paradas ficam como estão) e só as
// que estão perto da tela têm canvas (as outras liberam a memória).
//
// O item e a etiqueta são HTML de verdade (o mesmo Preview da Loja): ficam
// num plano no fundo da caixinha e, a cada quadro, recebem a matriz que deita
// esse plano onde o modelo está (projeção da câmera) — por isso acompanham o
// giro certinho. Os selos (Novo, desconto...) vão no plano da frente.
//
// Unidades: 1 = 20 px na tela, iguais às do Blender. O glTF troca os eixos
// (Blender x, y, z → three x, z, -y): aqui a frente da caixinha aponta pra +z,
// a parede (a cartela) é z = 0 e "pra cima" é +y.
import {
  WebGLRenderer, Scene, Camera, Group, Mesh, PlaneGeometry, BoxGeometry, ShadowMaterial,
  MeshStandardMaterial, MeshPhysicalMaterial, MeshBasicMaterial, DirectionalLight, HemisphereLight,
  PMREMGenerator, Color, Vector3, Matrix4, Quaternion, Euler, PCFSoftShadowMap, SRGBColorSpace, SphereGeometry, Float32BufferAttribute,
  CustomBlending, OneFactor, OneMinusSrcAlphaFactor, FrontSide, DoubleSide, BackSide, NoToneMapping,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const MODEL_URL = '/loja/parede/caixinha.glb?v=3';

// Medidas do modelo (as mesmas de tools/loja-3d/render.py).
const W = 9.2;
const H = 10.6;
const Z_BACK = 0.45;            // fundo da caixinha (rente à cartela)
const Z_FRONT = 3.05;           // filme da frente
const PIVOT = new Vector3(0, 6.68, 0.51);   // onde o arame encosta no furo da aba
// Quadro da câmera no plano do fundo (é o mesmo quadro de 264 x 357,6 px do CSS).
const QX0 = -6.0;
const QX1 = 7.2;
const QY0 = -7.1;
const QY1 = 10.78;
const CAM = new Vector3(40, 34, Z_BACK + 160);   // de longe, acima e à direita: aparecem a tampa e a lateral

// Retângulos que recebem o HTML (no espaço da caixinha).
const INSERT = { x: W / 2, y: H / 2, z: Z_BACK + 0.08 };
const FRONT = { x: W / 2, y: H / 2, z: Z_FRONT + 0.03 };

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* ---------------------------------------------------------------- materiais */

// Plástico de blister: quase invisível de frente, fecha nas bordas (Fresnel)
// e os reflexos somam em cima sem apagar o que está atrás (alfa pré-multiplicado).
function plasticMaterial({ alphaMin, alphaMax, power = 2.6, rough = 0.06 }) {
  const m = new MeshPhysicalMaterial({
    color: 0xeef3f8, roughness: rough, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03,
    ior: 1.5, specularIntensity: 1, envMapIntensity: 1.25, transparent: true, depthWrite: false, side: FrontSide,
  });
  m.blending = CustomBlending;
  m.blendSrc = OneFactor;
  m.blendDst = OneMinusSrcAlphaFactor;
  m.userData.alpha = { alphaMin, alphaMax, power };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uAlphaMin = { value: alphaMin };
    shader.uniforms.uAlphaMax = { value: alphaMax };
    shader.uniforms.uPower = { value: power };
    m.userData.shader = shader;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float uAlphaMin;\nuniform float uAlphaMax;\nuniform float uPower;\nvoid main() {')
      .replace('#include <opaque_fragment>', `
        float facing = abs(dot(normalize(normal), normalize(vViewPosition)));
        float a = mix(uAlphaMin, uAlphaMax, pow(1.0 - facing, uPower));
        vec3 spec = max(outgoingLight - totalDiffuse, vec3(0.0));
        float glow = clamp(max(spec.r, max(spec.g, spec.b)), 0.0, 1.0);
        float outA = clamp(max(a, glow), 0.0, 1.0);
        gl_FragColor = vec4(totalDiffuse * a + spec, outA);
      `);
  };
  return m;
}

function chromeMaterial() {
  return new MeshStandardMaterial({ color: 0xeef1f5, metalness: 1, roughness: 0.18, envMapIntensity: 1.6 });
}

/* ---------------------------------------------------------------- ambiente
   Um "estúdio" feito em código: paredes escuras, um softbox grande em cima à
   esquerda, uma faixa à direita e um painel na frente. É o que o plástico e o
   cromado refletem (igual aos cartões de luz da cena do Blender). */
function studioEnvironment(renderer) {
  const env = new Scene();
  const room = new Mesh(new SphereGeometry(40, 32, 16), new MeshBasicMaterial({ vertexColors: true, side: BackSide }));
  {
    const pos = room.geometry.attributes.position;
    const cols = [];
    const top = new Color(0x8a919c);
    const mid = new Color(0x3a3f48);
    const low = new Color(0x101216);
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) / 40;
      if (t > 0) c.copy(mid).lerp(top, Math.min(1, t * 1.6)); else c.copy(mid).lerp(low, Math.min(1, -t * 2.2));
      cols.push(c.r, c.g, c.b);
    }
    room.geometry.setAttribute('color', new Float32BufferAttribute(cols, 3));
  }
  env.add(room);
  const floor = new Mesh(new PlaneGeometry(60, 60), new MeshBasicMaterial({ color: 0x0b0d10 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -19.5;
  env.add(floor);
  const panel = (w, h, pos, look, strength, color = 0xffffff) => {
    const p = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(color).multiplyScalar(strength), side: DoubleSide }));
    p.position.copy(pos);
    p.lookAt(look);
    env.add(p);
  };
  const o = new Vector3(0, 0, 0);
  panel(26, 16, new Vector3(-14, 18, 16), o, 5.0, 0xfff6ea);    // softbox principal
  panel(5, 30, new Vector3(27, 4, 6), o, 3.2, 0xe2ecff);        // faixa da direita
  panel(34, 7, new Vector3(0, 7, 29), o, 2.2);                  // painel da frente (risca o filme)
  panel(40, 30, new Vector3(0, 19.8, -6), o, 1.1);              // teto
  const pm = new PMREMGenerator(renderer);
  const tex = pm.fromScene(env, 0.035).texture;
  pm.dispose();
  return tex;
}

/* ---------------------------------------------------------------- motor */

let enginePromise = null;

export function loadPackEngine() {
  if (!enginePromise) enginePromise = createEngine().catch((err) => { console.warn('[loja-3d] sem 3D:', err?.message || err); return null; });
  return enginePromise;
}

async function createEngine() {
  const canvas = document.createElement('canvas');
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;   // sombra macia e barata

  // Placa de vídeo "de software" (sem GPU de verdade) ou quadro demorado: a
  // caixinha continua em 3D, mas só desenha parada (sem animar) pra não travar.
  let slow = false;
  try {
    const gl = renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    if (/swiftshader|llvmpipe|software|basic render/i.test(name)) slow = true;
  } catch { /* sem informação: segue normal */ }
  let frames = 0;
  let spent = 0;

  const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
  const scene = new Scene();
  scene.environment = studioEnvironment(renderer);

  // ---- materiais (trocados no lugar dos que vieram no .glb)
  const walls = plasticMaterial({ alphaMin: 0.07, alphaMax: 0.62 });
  const film = plasticMaterial({ alphaMin: 0.015, alphaMax: 0.5, power: 3.2, rough: 0.03 });
  const tabMat = plasticMaterial({ alphaMin: 0.32, alphaMax: 0.7, power: 1.8, rough: 0.1 });
  const chrome = chromeMaterial();

  const backMat = plasticMaterial({ alphaMin: 0.55, alphaMax: 0.8, power: 1.5, rough: 0.2 });
  let backPlate = null;
  const assembly = new Group(); // no 360° gira tudo junto (gancho e caixinha)
  const box = new Group();      // tudo que gira: caixinha + aba
  const hook = new Group();     // o gancho fica parado
  const casters = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const name = (o.material?.name || '').toLowerCase();
    const mesh = new Mesh(o.geometry, o.material);
    mesh.applyMatrix4(o.matrixWorld);
    if (name.includes('cromado')) { mesh.material = chrome; mesh.castShadow = true; hook.add(mesh); return; }
    // a placa de trás: na parede quem faz o papel dela é o HTML do item; só
    // aparece no visualizador 360° quando a caixinha está de costas
    if (name.includes('fundo')) { mesh.material = backMat; mesh.visible = false; mesh.renderOrder = 0; backPlate = mesh; box.add(mesh); return; }
    if (name.includes('frente')) { mesh.material = film; mesh.renderOrder = 3; box.add(mesh); return; }
    const isTab = (o.parent?.name || o.name || '').toLowerCase().includes('aba') || name.endsWith('.001');
    mesh.material = isTab ? tabMat : walls;
    mesh.renderOrder = isTab ? 2 : 1;
    mesh.castShadow = true;
    casters.push(mesh);
    box.add(mesh);
  });
  assembly.add(hook);
  assembly.add(box);
  scene.add(assembly);

  // Sombras: na cartela (atrás) e no item (dentro da caixinha, a parede de
  // cima/esquerda faz sombra nele). Planos invisíveis que só recebem sombra.
  const wallShadow = new Mesh(new PlaneGeometry(60, 60), new ShadowMaterial({ opacity: 0.3 }));
  wallShadow.receiveShadow = true;
  wallShadow.renderOrder = -1;
  scene.add(wallShadow);
  const insideShadow = new Mesh(new PlaneGeometry(W, H), new ShadowMaterial({ opacity: 0.3 }));
  insideShadow.position.z = Z_BACK + 0.07;
  insideShadow.receiveShadow = true;
  insideShadow.renderOrder = -2;   // antes da parede: tapa a sombra da cartela atrás do item
  box.add(insideShadow);

  const key = new DirectionalLight(0xfff4e6, 2.1);
  key.castShadow = true;
  key.shadow.mapSize.set(512, 512);
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  const sc = key.shadow.camera;
  sc.left = -11; sc.right = 11; sc.top = 13; sc.bottom = -11; sc.near = 1; sc.far = 80;
  scene.add(key);
  scene.add(key.target);
  scene.add(new HemisphereLight(0xdfe8ff, 0x1a1408, 0.55));

  // ---- câmera igual à do Blender (frustum fora do eixo: o quadro é o do CSS)
  const camera = new Camera();
  camera.position.copy(CAM);
  camera.updateMatrixWorld();
  const near = 120;
  const far = 220;
  const d = CAM.z - Z_BACK;
  camera.projectionMatrix.makePerspective(
    ((QX0 - CAM.x) * near) / d, ((QX1 - CAM.x) * near) / d,
    ((QY1 - CAM.y) * near) / d, ((QY0 - CAM.y) * near) / d, near, far,
  );
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

  const tmpQ = new Quaternion();
  const tmpE = new Euler();
  const tmpM = new Matrix4();
  const tint = new Color();
  const white = new Color(0xeef3f8);

  // Coloca a caixinha na pose do estado: giro (yaw) em volta do arame, inclinação
  // (pitch, a base sai da parede) e balanço (swing, no plano da cartela).
  const CENTER = new Vector3(0, 2.2, (Z_BACK + Z_FRONT) / 2);
  function pose(s) {
    if (s.orbit) {
      // visualizador 360°: gira o conjunto em volta do próprio centro, sem parede atrás
      box.matrix.identity();
      box.matrixAutoUpdate = false;
      tmpQ.setFromEuler(tmpE.set((s.pitch * Math.PI) / 180, (s.yaw * Math.PI) / 180, 0, 'YXZ'));
      assembly.matrix.makeTranslation(CENTER.x, CENTER.y, CENTER.z)
        .multiply(tmpM.makeRotationFromQuaternion(tmpQ))
        .multiply(new Matrix4().makeTranslation(-CENTER.x, -CENTER.y, -CENTER.z));
      assembly.matrixAutoUpdate = false;
      assembly.updateMatrixWorld(true);
      return;
    }
    assembly.matrix.identity();
    assembly.matrixAutoUpdate = false;
    assembly.updateMatrixWorld(true);
    return poseOnWall(s);
  }
  function poseOnWall(s) {
    const yaw = (s.yaw * Math.PI) / 180;
    const pitch = (-s.pitch * Math.PI) / 180;
    const swing = ((s.swing + s.tilt) * Math.PI) / 180;
    box.matrix.identity();
    tmpM.makeTranslation(PIVOT.x, PIVOT.y, PIVOT.z + (W / 2) * Math.abs(Math.sin(yaw)) * 0.92);
    box.matrix.multiply(tmpM);
    tmpQ.setFromEuler(tmpE.set(pitch, yaw, swing, 'ZYX'));
    box.matrix.multiply(tmpM.makeRotationFromQuaternion(tmpQ));
    box.matrix.multiply(tmpM.makeTranslation(-PIVOT.x, -PIVOT.y, -PIVOT.z));
    box.matrixAutoUpdate = false;
    box.matrixWorldNeedsUpdate = true;
    box.updateMatrixWorld(true);
  }

  function project(p, w, h) {
    const v = p.clone().applyMatrix4(box.matrixWorld).project(camera);
    return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h];
  }

  function render(s, target) {
    const { w, h, dpr } = target;
    const pw = Math.max(2, Math.round(w * dpr));
    const ph = Math.max(2, Math.round(h * dpr));
    if (canvas.width !== pw || canvas.height !== ph) renderer.setSize(pw, ph, false);
    // cor do plástico: um fundinho da cor do item, o resto é o reflexo
    tint.set(s.color || '#35d05a').lerp(white, 0.58);
    walls.color.copy(tint);
    tabMat.color.copy(tint);
    backMat.color.copy(tint);
    film.color.copy(white);
    // a luz principal acompanha um pouco o mouse (o brilho anda no plástico)
    key.position.set(-9 + s.lx * 8, 15 - s.ly * 4, 40);
    key.target.position.set(0, 1, 0);
    key.target.updateMatrixWorld();
    pose(s);
    wallShadow.visible = !s.orbit;
    const quad = (r, z) => [
      project(new Vector3(-r.x, r.y, z), w, h), project(new Vector3(r.x, r.y, z), w, h),
      project(new Vector3(r.x, -r.y, z), w, h), project(new Vector3(-r.x, -r.y, z), w, h),
    ];
    const qInsert = quad(INSERT, INSERT.z);
    if (backPlate) backPlate.visible = !!s.orbit && !facesViewer(qInsert);
    const t0 = performance.now();
    renderer.render(scene, camera);
    if (!slow && frames < 30) { frames += 1; spent += performance.now() - t0; if (frames >= 8 && spent / frames > 28) slow = true; }
    const ctx = target.ctx;
    ctx.clearRect(0, 0, target.canvas.width, target.canvas.height);
    ctx.drawImage(canvas, 0, 0, target.canvas.width, target.canvas.height);
    // planos de HTML: fundo (o item) e frente (os selos)
    return { insert: qInsert, front: quad(FRONT, FRONT.z) };
  }

  return { render, isSlow: () => slow, dispose: () => renderer.dispose() };
}

/* ---------------------------------------------------------------- matriz do HTML */

// Homografia que leva o retângulo (0,0)-(w,h) do elemento pros 4 cantos
// projetados (sentido horário a partir de cima/esquerda), como matrix3d do CSS.
export function quadToMatrix3d(w, h, q) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2; const dx2 = x3 - x2; const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2; const dy2 = y3 - y2; const dy3 = y0 - y1 + y2 - y3;
  let a; let b; let c; let d; let e; let f; let g; let hh;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    a = x1 - x0; b = x3 - x0; c = x0; d = y1 - y0; e = y3 - y0; f = y0; g = 0; hh = 0;
  } else {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    hh = (dx1 * dy3 - dx3 * dy1) / den;
    a = x1 - x0 + g * x1; b = x3 - x0 + hh * x3; c = x0;
    d = y1 - y0 + g * y1; e = y3 - y0 + hh * y3; f = y0;
  }
  const n = (v) => (Number.isFinite(v) ? +v.toFixed(6) : 0);
  return `matrix3d(${n(a / w)},${n(d / w)},0,${n(g / w)},${n(b / h)},${n(e / h)},0,${n(hh / h)},0,0,1,0,${n(c)},${n(f)},0,1)`;
}

// O plano está virado pra câmera? (cantos no sentido horário na tela)
export function facesViewer(q) {
  const [[x0, y0], [x1, y1], , [x3, y3]] = q;
  return (x1 - x0) * (y3 - y0) - (y1 - y0) * (x3 - x0) > 0;
}

/* ---------------------------------------------------------------- caixinhas da página */

const packs = new Set();
let raf = 0;
let io = null;
let ro = null;

function step(now) {
  raf = 0;
  let again = false;
  for (const p of packs) {
    if (p.tick(now)) again = true;
  }
  if (again) raf = requestAnimationFrame(step);
}
function wake() { if (!raf) raf = requestAnimationFrame(step); }

function observe(p) {
  if (typeof IntersectionObserver !== 'undefined' && !io) {
    io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        const pk = en.target.__pack3d;
        if (pk) pk.setVisible(en.isIntersecting);
      }
    }, { rootMargin: '400px 0px' });
  }
  if (typeof ResizeObserver !== 'undefined' && !ro) {
    ro = new ResizeObserver((entries) => {
      for (const en of entries) en.target.__pack3d?.resize();
    });
  }
  p.el.__pack3d = p;
  io?.observe(p.el);
  ro?.observe(p.el);
  if (!io) p.setVisible(true);
}

// Liga uma caixinha (o elemento .room-pack da cartela). Devolve o controle:
// pointer(e) / release(e) / nudge(força) / update({ color, tilt }) / destroy().
export function mountPack(el, opts = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'room-pack-3d';
  canvas.setAttribute('aria-hidden', 'true');
  el.appendChild(canvas);
  const insertEl = el.querySelector('.room-pack-back');
  const frontEl = el.querySelector('.room-pack-front');
  const s = {
    color: opts.color, tilt: opts.tilt || 0, orbit: !!opts.orbit, drag: null,
    yaw: 0, yawV: 0, yawT: 0, pitch: 0, pitchV: 0, pitchT: 0, swing: 0, swingV: 0,
    lx: 0, ly: 0, lxT: 0, lyT: 0,
  };
  let engine = null;
  let visible = false;
  let dirty = true;
  let last = 0;
  let size = null;
  let ctx = null;
  let destroyed = false;
  const quietPref = reducedMotion();
  const isQuiet = () => quietPref || !!engine?.isSlow();

  const p = {
    el,
    setVisible(v) {
      visible = v;
      if (!v && canvas.width) { canvas.width = 0; canvas.height = 0; dirty = true; }   // longe da tela: devolve a memória
      if (v) { dirty = true; wake(); }
    },
    resize() { size = null; dirty = true; wake(); },
    tick(now) {
      if (destroyed || !engine || !visible) return false;
      const dt = Math.min(0.05, (now - (last || now)) / 1000) || 1 / 60;
      last = now;
      // molas: giro e inclinação seguem o alvo; o balanço é um pêndulo amortecido
      const spring = (x, v, t, k, c) => { const a = k * (t - x) - c * v; v += a * dt; return [x + v * dt, v]; };
      // 360°: sem ninguém arrastando, roda devagarinho sozinha
      if (s.orbit && !s.drag && !isQuiet()) s.yawT += dt * 22;
      [s.yaw, s.yawV] = spring(s.yaw, s.yawV, s.yawT, 70, 11);
      [s.pitch, s.pitchV] = spring(s.pitch, s.pitchV, s.pitchT, 80, 12);
      [s.swing, s.swingV] = spring(s.swing, s.swingV, 0, 150, 4.2);
      s.lx += (s.lxT - s.lx) * Math.min(1, dt * 8);
      s.ly += (s.lyT - s.ly) * Math.min(1, dt * 8);
      const moving = Math.abs(s.yaw - s.yawT) > 0.05 || Math.abs(s.yawV) > 0.05 || Math.abs(s.pitch - s.pitchT) > 0.05
        || Math.abs(s.pitchV) > 0.05 || Math.abs(s.swing) > 0.02 || Math.abs(s.swingV) > 0.05
        || Math.abs(s.lx - s.lxT) > 0.005 || Math.abs(s.ly - s.lyT) > 0.005;
      if (s.orbit && !s.drag && !isQuiet()) { draw(); dirty = false; return true; }
      if (!moving && !dirty) { last = 0; return false; }
      if (!moving) { s.yaw = s.yawT; s.pitch = s.pitchT; s.swing = 0; s.yawV = s.pitchV = s.swingV = 0; last = 0; }
      draw();
      dirty = false;
      return moving;
    },
    // Mouse/dedo em cima: a caixinha vira pro lado do ponteiro e a base sai um
    // pouquinho da parede; o brilho acompanha.
    pointer(e) {
      if (s.orbit) {
        if (!s.drag) return;
        s.yawT = s.drag.yaw + (e.clientX - s.drag.x) * 0.75;
        s.pitchT = Math.max(-28, Math.min(28, s.drag.pitch + (e.clientY - s.drag.y) * 0.35));
        if (isQuiet()) { s.yaw = s.yawT; s.pitch = s.pitchT; dirty = true; }
        wake();
        return;
      }
      const r = el.getBoundingClientRect();
      if (!r.width) return;
      const nx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
      const ny = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
      if (isQuiet()) return;
      s.yawT = nx * 26;
      s.pitchT = 4 + Math.max(0, ny) * 7;
      s.lxT = nx; s.lyT = ny;
      wake();
    },
    // 360°: começa/termina de arrastar.
    grab(e) { s.drag = { x: e.clientX, y: e.clientY, yaw: s.yawT, pitch: s.pitchT }; wake(); },
    drop() { s.drag = null; wake(); },
    // Soltou/saiu: volta pro lugar e balança com o embalo que tinha.
    release() {
      if (s.orbit) return;
      if (isQuiet()) return;
      s.swingV += -s.yawV * 0.35 + (Math.random() - 0.5) * 6;
      s.yawT = 0; s.pitchT = 0; s.lxT = 0; s.lyT = 0;
      wake();
    },
    // Empurrãozinho (a cartela apareceu, o dedo encostou, foi pra cesta...).
    nudge(force = 0.5) {
      if (isQuiet()) return;
      s.swingV += (Math.random() < 0.5 ? -1 : 1) * 40 * force;
      wake();
    },
    update(o) {
      if (o.color !== undefined && o.color !== s.color) { s.color = o.color; dirty = true; }
      if (o.tilt !== undefined && o.tilt !== s.tilt) { s.tilt = o.tilt; dirty = true; }
      wake();
    },
    destroy() {
      destroyed = true;
      packs.delete(p);
      io?.unobserve(el);
      ro?.unobserve(el);
      delete el.__pack3d;
      canvas.remove();
      el.classList.remove('p3d');
      for (const n of [insertEl, frontEl]) if (n) { n.style.transform = ''; n.style.visibility = ''; }
    },
  };

  function draw() {
    if (!size) {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      size = { w, h, dpr: Math.min(window.devicePixelRatio || 1, 1.75) };
    }
    const pw = Math.round(size.w * size.dpr);
    const ph = Math.round(size.h * size.dpr);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; ctx = null; }
    if (!ctx) ctx = canvas.getContext('2d');
    const q = engine.render(s, { w: size.w, h: size.h, dpr: size.dpr, canvas, ctx });
    if (insertEl) {
      const show = facesViewer(q.insert);
      insertEl.style.visibility = show ? '' : 'hidden';
      if (show) insertEl.style.transform = quadToMatrix3d(insertEl.offsetWidth, insertEl.offsetHeight, q.insert);
    }
    if (frontEl) {
      const show = facesViewer(q.front);
      frontEl.style.visibility = show ? '' : 'hidden';
      if (show) frontEl.style.transform = quadToMatrix3d(frontEl.offsetWidth, frontEl.offsetHeight, q.front);
    }
  }

  packs.add(p);
  loadPackEngine().then((eng) => {
    if (destroyed) return;
    if (!eng) { el.classList.add('p3d-off'); return; }
    engine = eng;
    el.classList.add('p3d');
    observe(p);
    dirty = true;
    wake();
  });
  return p;
}
