import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

// A walnut record console on a sheepskin: a Beogram-ish turntable, a crate to flip through and a candle.
// Every move is physical: a record rises out of its sleeve, travels to the platter and goes back the same way.
// Units are roughly 10 cm. y = 0 is the top of the console.
export function mount({ host, records, onChange }) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
  const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 200);
  const FLOOR = -4.6;

  // Warm, low light that follows the time in Sydney: brighter by day, golden late afternoon, candle and lamp at night
  const key = new THREE.DirectionalLight(0xffe2c2, 2.3);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 60 });
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.025;
  key.target.position.set(1.6, -2, 0.5);
  scene.add(key, key.target);
  const bounce = new THREE.HemisphereLight(0xfff3e4, 0x7a5a42, 0.6);
  scene.add(bounce);
  let night = false;
  (function setLight() {
    const p = new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "numeric", hourCycle: "h23", timeZone: "Australia/Sydney" }).formatToParts(new Date());
    const h = +p.find(x => x.type === "hour").value + p.find(x => x.type === "minute").value / 60;
    const t = Math.max(-1, Math.min(1, (h - 12.5) / 6.5));
    key.position.set(-6 - t * 4, 12, 8);
    if (h >= 16 && h < 19) { key.color.set(0xffcf9e); key.intensity = 2.2; }
    else if (h >= 19 || h < 6) { night = true; key.color.set(0xffc58a); key.intensity = 1.4; key.position.set(-5, 8, 6); bounce.intensity = 0.34; scene.environmentIntensity = 0.28; }
  })();

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ opacity: 0.2 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = FLOOR; ground.receiveShadow = true; scene.add(ground);

  // Walnut, drawn rather than downloaded: warm brown bands, wavy grain and open pores
  function walnut(seed, rotate = false) {
    let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const w = 1024, h = 512, c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d");
    g.fillStyle = "#5e3d28"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 16; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? "38,22,13" : "128,88,58"},${0.06 + rnd() * 0.12})`; g.fillRect(0, rnd() * h, w, 18 + rnd() * 90); }
    for (let i = 0; i < 280; i++) {
      const y0 = rnd() * h, amp = 1.5 + rnd() * 9, f = ((0.6 + rnd() * 2.2) * Math.PI * 2) / w, ph = rnd() * 6.28;
      g.strokeStyle = `rgba(${rnd() < 0.72 ? "28,16,9" : "156,110,74"},${0.05 + rnd() * 0.17})`; g.lineWidth = 0.5 + rnd() * 1.6;
      g.beginPath(); for (let x = 0; x <= w; x += 8) { const y = y0 + Math.sin(x * f + ph) * amp + Math.sin(x * f * 3.1 + ph * 2) * amp * 0.25; x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
    }
    for (let i = 0; i < 4200; i++) { g.fillStyle = `rgba(20,10,5,${0.1 + rnd() * 0.14})`; g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 6, 0.8); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    if (rotate) { t.center.set(0.5, 0.5); t.rotation = Math.PI / 2; }
    return t;
  }
  const oiled = map => new THREE.MeshPhysicalMaterial({ map, roughness: 0.48, clearcoat: 0.3, clearcoatRoughness: 0.5 });

  const M = {
    walnut: oiled(walnut(7)),
    walnutDeck: oiled(walnut(19)),
    walnutLeg: oiled(walnut(31, true)),
    walnutCrate: oiled(walnut(43)),
    deckPlate: new THREE.MeshStandardMaterial({ color: 0xd9d8d3, metalness: 0.7, roughness: 0.42 }),
    alu: new THREE.MeshStandardMaterial({ color: 0xd2d1cc, metalness: 0.9, roughness: 0.3 }),
    felt: new THREE.MeshStandardMaterial({ color: 0x3b3835, roughness: 1 }),
    ink: new THREE.MeshStandardMaterial({ color: 0x262422, roughness: 0.45, metalness: 0.2 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0x4a1c14, emissive: 0xd8553a, emissiveIntensity: 0 }),
    sleeveEdge: new THREE.MeshStandardMaterial({ color: 0xe9e4d8, roughness: 0.9 }),
    vinylEdge: new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.5 }),
    stoneware: new THREE.MeshStandardMaterial({ color: 0xd9cfbf, roughness: 0.92 }),
    wax: new THREE.MeshStandardMaterial({ color: 0xf3ece0, roughness: 0.6, emissive: 0xffb070, emissiveIntensity: 0.06 }),
  };
  const solid = m => { m.castShadow = true; m.receiveShadow = true; return m; };
  const lathe = (pts, mat, seg = 48) => solid(new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg), mat));

  // The console: walnut top, splayed tapered legs, an open shelf for the collection
  const top = solid(new THREE.Mesh(new RoundedBoxGeometry(10.8, 0.3, 5.2, 4, 0.1), M.walnut));
  top.position.set(1.6, -0.15, 0); scene.add(top);
  const shelf = solid(new THREE.Mesh(new RoundedBoxGeometry(9.7, 0.14, 4.4, 3, 0.05), M.walnut));
  shelf.position.set(1.6, -3.7, 0); scene.add(shelf);
  const SHELF_TOP = -3.63;
  for (const [x, z] of [[-3.2, -2.05], [6.4, -2.05], [-3.2, 2.05], [6.4, 2.05]]) {
    const leg = solid(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.08, 4.35, 28), M.walnutLeg));
    const sx = Math.sign(x - 1.6), sz = Math.sign(z);
    leg.position.set(x + sx * 0.18, -0.3 - 2.15, z + sz * 0.12);
    leg.rotation.z = -sx * THREE.MathUtils.degToRad(4.5); leg.rotation.x = sz * THREE.MathUtils.degToRad(3);
    scene.add(leg);
  }
  // The rest of the collection, on edge (one draw call)
  (() => {
    const n = 44, geo = new THREE.BoxGeometry(0.048, 3.05, 3.05);
    const spines = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.85 }), n);
    spines.castShadow = spines.receiveShadow = true;
    const tones = [0xe7e1d4, 0x2b2a28, 0xa8432c, 0x6f6a4b, 0xb38b3c, 0x4b5560, 0xd8cdb8, 0x7c4a33, 0x1f2a2e, 0xc9b79b];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    let x = -2.75;
    for (let i = 0; i < n; i++) {
      const lean = i > n - 4 ? THREE.MathUtils.degToRad(9 + (i - (n - 4)) * 2.5) : THREE.MathUtils.degToRad(Math.sin(i * 12.9) * 0.8);
      x += i > n - 4 ? 0.2 : 0.054;
      e.set(0, 0, -lean); q.setFromEuler(e);
      m4.compose(new THREE.Vector3(x + Math.sin(lean) * 1.5, SHELF_TOP + 1.525 * Math.cos(lean), 0.05 + Math.sin(i * 7.3) * 0.08), q, new THREE.Vector3(1, 1, 1));
      spines.setMatrixAt(i, m4); spines.setColorAt(i, new THREE.Color(tones[(i * 7) % tones.length]));
    }
    scene.add(spines);
  })();
  const jug = lathe([[0, 0], [0.42, 0], [0.5, 0.12], [0.56, 0.45], [0.52, 0.85], [0.36, 1.15], [0.27, 1.42], [0.31, 1.56], [0.29, 1.6], [0.24, 1.6], [0.25, 1.45]], M.stoneware);
  jug.position.set(5.2, SHELF_TOP, 0.4); scene.add(jug);

  // Sheepskin: stacked fur shells over an irregular pelt outline
  (() => {
    const N = 180, pts = [];
    const lobe = (a, c, w, h) => { let d = Math.atan2(Math.sin(a - c), Math.cos(a - c)); return h * Math.exp(-((d / w) ** 2)); };
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      let r = 1 + 0.05 * Math.sin(3 * a + 0.7) + 0.022 * Math.sin(11 * a + 1.3) + 0.012 * Math.sin(23 * a + 0.4);
      r += lobe(a, 0.62, 0.1, 0.17) + lobe(a, -0.62, 0.1, 0.17) + lobe(a, Math.PI - 0.58, 0.11, 0.19) + lobe(a, Math.PI + 0.58, 0.11, 0.19) + lobe(a, Math.PI, 0.16, 0.08);
      pts.push(new THREE.Vector2(Math.cos(a) * r * 4.3, Math.sin(a) * r * 2.75));
    }
    const geo = new THREE.ShapeGeometry(new THREE.Shape(pts), 1); geo.rotateX(-Math.PI / 2);
    // Soft tufts: each layer keeps only the denser middle of each tuft, so the tufts form little domes
    const S = 512, c = document.createElement("canvas"); c.width = c.height = S; const g = c.getContext("2d");
    g.fillStyle = "#000"; g.fillRect(0, 0, S, S);
    let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * S, y = rnd() * S, r = 5 + rnd() * 9, v = 0.55 + rnd() * 0.45;
      for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
        const cx = x + dx, cy = y + dy; if (cx < -r || cx > S + r || cy < -r || cy > S + r) continue;
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r); gr.addColorStop(0, `rgba(255,255,255,${v})`); gr.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = gr; g.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
    }
    const fur = new THREE.CanvasTexture(c); fur.wrapS = fur.wrapT = THREE.RepeatWrapping; fur.repeat.set(0.38, 0.38);
    const rug = new THREE.Group(); rug.position.set(1.3, FLOOR, 1.7); rug.rotation.y = 0.08; scene.add(rug);
    const roots = new THREE.Color(0xa3947b), tip = new THREE.Color(0xf7f2ea), L = 20;
    for (let k = 0; k < L; k++) {
      const f = k / (L - 1);
      const mat = new THREE.MeshStandardMaterial({ color: roots.clone().lerp(tip, Math.pow(f, 0.6)), roughness: 1, alphaMap: k ? fur : null, alphaTest: k ? 0.08 + 0.75 * f : 0 });
      const shell = new THREE.Mesh(geo, mat); shell.position.y = 0.006 + k * 0.028; shell.scale.setScalar(1 - k * 0.006);
      shell.receiveShadow = true; rug.add(shell);
    }
  })();

  // Turntable: walnut frame, brushed deck plate, felt mat
  const deckFrame = solid(new THREE.Mesh(new RoundedBoxGeometry(4.6, 0.3, 3.6, 5, 0.08), M.walnutDeck));
  deckFrame.position.set(-1.0, 0.15, 0); scene.add(deckFrame);
  const plate = solid(new THREE.Mesh(new THREE.BoxGeometry(4.34, 0.024, 3.34), M.deckPlate));
  plate.position.set(-1.0, 0.31, 0); scene.add(plate);

  const PLATTER = new THREE.Vector3(-1.55, 0.32, 0.05);
  const platter = new THREE.Group(); platter.position.copy(PLATTER); scene.add(platter);
  const body = solid(new THREE.Mesh(new THREE.CylinderGeometry(1.53, 1.53, 0.14, 128), [M.alu, M.felt, M.alu]));
  body.position.y = 0.07; platter.add(body);
  const spindle = solid(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 16), M.alu));
  spindle.position.y = 0.21; platter.add(spindle);
  const RECORD_Y = PLATTER.y + 0.14 + 0.011;

  const PIVOT = new THREE.Vector3(0.62, 0.32, -1.2), ARM_LEN = 2.4;
  const armBase = solid(new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.23, 0.12, 48), M.alu));
  armBase.position.set(PIVOT.x, PIVOT.y + 0.06, PIVOT.z); scene.add(armBase);
  const post = solid(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 16), M.alu));
  post.position.set(PIVOT.x, PIVOT.y + 0.2, PIVOT.z); scene.add(post);
  const arm = new THREE.Group(); arm.position.set(PIVOT.x, 0.64, PIVOT.z); scene.add(arm);
  const tube = solid(new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 2.5, 16), M.alu));
  tube.rotation.x = Math.PI / 2; tube.position.z = 1.1; arm.add(tube);
  const head = solid(new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.05, 0.34), M.ink));
  head.position.set(0, -0.03, ARM_LEN); arm.add(head);
  const weight = solid(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.26, 32), M.ink));
  weight.rotation.x = Math.PI / 2; weight.position.z = -0.32; arm.add(weight);
  const rest = solid(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.28, 12), M.alu));
  rest.position.set(PIVOT.x + 0.22, PIVOT.y + 0.14, PIVOT.z + 2.05); scene.add(rest);
  let PLAY_ANGLE = 0;
  for (let a = 0; a < 1.2; a += 0.002) {
    const sx = PIVOT.x - ARM_LEN * Math.sin(a), sz = PIVOT.z + ARM_LEN * Math.cos(a);
    if (Math.hypot(sx - PLATTER.x, sz - PLATTER.z) < 1.34) { PLAY_ANGLE = a; break; }
  }
  const button = solid(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.05, 40), M.alu));
  button.position.set(0.82, 0.345, 1.32); scene.add(button);
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 20), M.lamp);
  lamp.position.set(0.42, 0.335, 1.42); scene.add(lamp);

  // Candle in a stoneware dish. It flickers only while the deck is moving, so an idle page costs nothing.
  const candle = new THREE.Group(); candle.position.set(1.95, 0, 1.75); scene.add(candle);
  candle.add(lathe([[0, 0], [0.5, 0], [0.57, 0.04], [0.56, 0.11], [0.51, 0.11], [0.44, 0.06], [0, 0.06]], M.stoneware));
  const wax = solid(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.31, 0.8, 40), M.wax)); wax.position.y = 0.46; candle.add(wax);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(0.25, 32), new THREE.MeshStandardMaterial({ color: 0xe9dcc6, roughness: 0.3 }));
  pool.rotation.x = -Math.PI / 2; pool.position.y = 0.861; candle.add(pool);
  const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 8), M.ink); wick.position.y = 0.91; candle.add(wick);
  const flame = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [0.05, 0.03], [0.075, 0.1], [0.062, 0.2], [0.032, 0.29], [0, 0.36]].map(([r, y]) => new THREE.Vector2(r, y)), 24),
    new THREE.MeshBasicMaterial({ color: 0xffd896 }));
  flame.position.y = 0.93; candle.add(flame);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: (() => { const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d"); const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, "rgba(255,200,130,1)"); r.addColorStop(0.35, "rgba(255,170,90,.35)"); r.addColorStop(1, "rgba(255,150,70,0)"); g.fillStyle = r; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })(),
    blending: THREE.AdditiveBlending, depthWrite: false, opacity: night ? 0.8 : 0.5 }));
  glow.position.y = 1.08; glow.scale.setScalar(night ? 1.6 : 1.1); candle.add(glow);
  const candleLight = new THREE.PointLight(0xffa552, night ? 9 : 4, 9, 2); candleLight.position.y = 1.2; candle.add(candleLight);
  const CANDLE_I = candleLight.intensity;

  // Records: a walnut crate you flip through, covers facing out
  const loader = new THREE.TextureLoader();
  const grooves = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 1024;
    const g = c.getContext("2d"); g.fillStyle = "#0d0d0d"; g.fillRect(0, 0, 1024, 1024);
    for (let r = 175; r < 506; r += 1.5) { g.strokeStyle = `rgba(255,255,255,${0.012 + Math.random() * 0.028})`; g.lineWidth = 0.8; g.beginPath(); g.arc(512, 512, r, 0, Math.PI * 2); g.stroke(); }
    for (const r of [250, 322, 401, 470]) { g.strokeStyle = "rgba(0,0,0,.85)"; g.lineWidth = 4; g.beginPath(); g.arc(512, 512, r, 0, Math.PI * 2); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t;
  })();
  const vinyl = new THREE.MeshPhysicalMaterial({ map: grooves, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.22 });

  const CRATE = new THREE.Group(); CRATE.position.set(4.45, 0, -0.75); scene.add(CRATE);
  const CW = 3.5, CD = 2.3, CT = 0.09, CRATE_FLOOR = 0.1;
  const crateWalls = [];
  const wall = (w, h, d, x, y, z) => { const m = solid(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, 0.03), M.walnutCrate)); m.position.set(x, y, z); m.userData.crate = true; CRATE.add(m); crateWalls.push(m); };
  wall(CW, CRATE_FLOOR, CD, 0, CRATE_FLOOR / 2, 0);
  wall(CW, 0.75, CT, 0, 0.375, CD / 2 - CT / 2);
  wall(CW, 1.2, CT, 0, 0.6, -CD / 2 + CT / 2);
  wall(CT, 0.95, CD, -CW / 2 + CT / 2, 0.475, 0);
  wall(CT, 0.95, CD, CW / 2 - CT / 2, 0.475, 0);
  const STAND = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2); // flat record -> standing in a sleeve, label facing out
  const backTones = [0xe8e2d5, 0xdfd6c4, 0xe6dccb, 0xd9d1c1];

  const crate = records.map((rec, i) => {
    const art = loader.load(rec.art, () => invalidate()); art.colorSpace = THREE.SRGBColorSpace; art.anisotropy = 8;
    const holder = new THREE.Group(); // pivots on the record's bottom edge, like a real one in a crate
    holder.position.set(0, CRATE_FLOOR, CD / 2 - CT - 0.26 - i * 0.33); holder.rotation.x = -0.1; CRATE.add(holder);
    const back = new THREE.MeshStandardMaterial({ color: backTones[i % backTones.length], roughness: 0.9 });
    const sleeve = solid(new THREE.Mesh(new THREE.BoxGeometry(3.05, 3.05, 0.04),
      [M.sleeveEdge, M.sleeveEdge, M.sleeveEdge, M.sleeveEdge, new THREE.MeshStandardMaterial({ map: art, roughness: 0.75 }), back]));
    sleeve.position.y = 1.525; sleeve.userData.i = i; holder.add(sleeve);

    const disc = new THREE.Group();
    disc.add(solid(new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 0.02, 128), [M.vinylEdge, vinyl, M.vinylEdge])));
    const label = new THREE.Mesh(new THREE.CircleGeometry(0.48, 64), new THREE.MeshStandardMaterial({ map: art, roughness: 0.8 }));
    label.rotation.x = -Math.PI / 2; label.position.y = 0.0106; disc.add(label);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.04, 24), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    hole.rotation.x = -Math.PI / 2; hole.position.y = 0.011; disc.add(hole);
    disc.visible = false; scene.add(disc);

    const audio = new Audio(); audio.preload = "none"; audio.src = rec.src;
    return { holder, sleeve, disc, audio, baseY: holder.position.y };
  });

  // Tiny tween engine, driven by the render loop. A keyed tween replaces any running tween with the same key,
  // so fast repeated input (flipping, hovering) retargets smoothly instead of two animations fighting.
  const easeOut = k => 1 - Math.pow(1 - k, 3);
  const easeInOut = k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  const active = [];
  const tween = (ms, fn, ease = easeOut, key) => new Promise(res => {
    if (key) { const j = active.findIndex(a => a.key === key); if (j >= 0) active.splice(j, 1)[0].res(); }
    if (reduce || ms === 0) { fn(1); invalidate(); return res(); }
    active.push({ t0: performance.now(), ms, fn, ease, res, key }); invalidate();
  });
  const moveTo = (obj, to, ms, ease) => { const from = obj.position.clone(); return tween(ms, k => obj.position.lerpVectors(from, to, k), ease); };
  const turnTo = (obj, y, ms, ease) => { const from = obj.rotation.y; return tween(ms, k => { obj.rotation.y = from + (y - from) * k; }, ease); };
  const tiltTo = (obj, x, ms, ease) => { const from = obj.rotation.x; return tween(ms, k => { obj.rotation.x = from + (x - from) * k; }, ease, obj.uuid + ":tilt"); };
  const liftTo = (c, y, ms, ease) => { const from = c.holder.position.y; return tween(ms, k => { c.holder.position.y = from + (y - from) * k; }, ease, c.holder.uuid + ":lift"); };
  const fly = (obj, to, toQ, peak, ms) => {
    const p0 = obj.position.clone(), p2 = to.clone(), p1 = p0.clone().lerp(p2, 0.5); p1.y = Math.max(peak, p0.y, p2.y);
    const q0 = obj.quaternion.clone();
    return tween(ms, k => {
      const a = (1 - k) * (1 - k), b = 2 * (1 - k) * k, c = k * k;
      obj.position.set(a * p0.x + b * p1.x + c * p2.x, a * p0.y + b * p1.y + c * p2.y, a * p0.z + b * p1.z + c * p2.z);
      obj.quaternion.slerpQuaternions(q0, toQ, k);
    }, easeInOut);
  };
  const fade = (audio, to, ms) => { const from = audio.volume; return tween(ms, k => { audio.volume = Math.min(1, Math.max(0, from + (to - from) * k)); }, k => k, audio.src + ":vol"); };

  // Browsing the crate: records in front of the one you're looking at tip forward, the rest lean back.
  // A hover previews the next move: the cover lifts (play), the cover starts to tip (next) or the nearest tipped record starts to rise (previous).
  let browsed = 0, preview = null;
  const angleFor = (j, c) => (j < c ? 0.72 - 0.07 * j : -(0.1 + 0.012 * (j - c)));
  const nudge = j => (preview === "next" && j === browsed ? 0.11 : preview === "prev" && j === browsed - 1 ? -0.1 : 0);
  const settleCrate = (ms = 280) => Promise.all(crate.map((r, j) => tiltTo(r.holder, angleFor(j, browsed) + nudge(j), ms, easeOut)));
  const flipTo = (c, ms = 280) => { browsed = Math.max(0, Math.min(crate.length - 1, c)); notify(); return settleCrate(ms); };
  function setPreview(p) {
    if (running) p = null;
    if (p === preview) return;
    const wasPlay = preview === "play"; preview = p;
    const c = crate[browsed];
    if (wasPlay || p === "play") liftTo(c, c.baseY + (p === "play" ? 0.12 : 0), 160);
    settleCrate(170);
    hud.querySelectorAll("button").forEach(b => b.classList.toggle("hint", b.dataset.act === p));
  }

  // Playback: clicks only say what the visitor wants; one runner moves the deck there, a step at a time.
  // Nothing else ever animates a record, so two journeys can never overlap.
  let current = null, want = null, running = false, browseWant = null, omega = 0, omegaTarget = 0, scratching = false;
  const OMEGA = (2 * Math.PI * 100) / 3 / 60; // 33⅓ rpm
  const notify = () => { renderHud(); onChange && onChange({ current, want, busy: running, browsed }); };
  const sleeveCentre = c => c.holder.localToWorld(new THREE.Vector3(0, 1.525, 0));
  const pulled = c => sleeveCentre(c).add(new THREE.Vector3(-3.2, 0, 0));
  const standing = c => c.holder.getWorldQuaternion(new THREE.Quaternion()).multiply(STAND);

  async function run() {
    if (running) return;
    setPreview(null);
    running = true; notify();
    try {
      while (current !== want) {
        if (current !== null) await unload(current);
        else await load(want);
      }
      if (browseWant !== null && browseWant !== browsed) await flipTo(browseWant);
    } finally { browseWant = null; running = false; notify(); }
  }
  const play = i => { want = i; run(); };
  const stop = () => { want = null; run(); };
  // A second press on the same record within 450 ms is a double-click, not "play, then stop"
  let lastPress = { i: null, t: -1e9 };
  const toggle = i => {
    const now = performance.now();
    if (i === lastPress.i && now - lastPress.t < 450) return;
    lastPress = { i, t: now };
    want === i ? stop() : play(i);
  };
  const browse = i => { if (running) { browseWant = Math.max(0, Math.min(crate.length - 1, i)); return; } if (i !== browsed) flipTo(i); };

  async function load(i) {
    const c = crate[i], { disc, audio } = c;
    current = i; notify();
    if (browsed !== i) await flipTo(i);
    await liftTo(c, c.baseY + 0.95, 300);
    scene.attach(disc); // always travel in world space, whatever the record was attached to before
    disc.position.copy(sleeveCentre(c)); disc.quaternion.copy(standing(c)); disc.visible = true;
    await moveTo(disc, pulled(c), 440);
    liftTo(c, c.baseY, 280);
    await fly(disc, new THREE.Vector3(PLATTER.x, RECORD_Y + 0.5, PLATTER.z), new THREE.Quaternion(), 3.2, 720);
    await moveTo(disc, new THREE.Vector3(PLATTER.x, RECORD_Y, PLATTER.z), 200);
    platter.attach(disc);
    if (want !== i) return; // changed their mind mid-journey: skip the needle, the runner takes it back
    omegaTarget = reduce ? 0 : OMEGA;
    await turnTo(arm, -PLAY_ANGLE, 560, easeInOut);
    await moveTo(arm, arm.position.clone().setY(0.585), 160);
    M.lamp.emissiveIntensity = 2.2;
    audio.volume = 0; audio.playbackRate = 1; audio.play().catch(() => {}); fade(audio, 1, 500);
  }

  async function unload(i) {
    const c = crate[i], { disc, audio } = c;
    M.lamp.emissiveIntensity = 0;
    if (!audio.paused) fade(audio, 0, 260).then(() => audio.pause());
    omegaTarget = 0;
    if (arm.rotation.y !== 0) {
      await moveTo(arm, arm.position.clone().setY(0.64), 150);
      await turnTo(arm, 0, 520, easeInOut);
    }
    scene.attach(disc);
    await moveTo(disc, disc.position.clone().setY(RECORD_Y + 0.5), 200);
    if (browsed !== i) flipTo(i);
    liftTo(c, c.baseY + 0.95, 300);
    await new Promise(r => setTimeout(r, reduce ? 0 : 300));
    await fly(disc, pulled(c), standing(c), 3.2, 720);
    await moveTo(disc, sleeveCentre(c), 400);
    disc.visible = false;
    await liftTo(c, c.baseY, 280);
    current = null; notify();
  }
  crate.forEach((c, i) => c.audio.addEventListener("ended", () => { if (want === i) stop(); }));

  // The crate's controls: previous, play or stop, next. Big, plain targets that say what they'll do.
  const hud = document.createElement("div");
  hud.className = "crate-hud"; hud.setAttribute("role", "group"); hud.setAttribute("aria-label", "Record crate");
  hud.innerHTML = '<button class="flip" data-act="prev" aria-label="Previous record">‹</button>'
    + '<button class="now" data-act="play"><span class="ico" aria-hidden="true"></span><span class="t"></span></button>'
    + '<button class="flip" data-act="next" aria-label="Next record">›</button>';
  host.appendChild(hud);
  const [bPrev, bNow, bNext] = hud.querySelectorAll("button");
  bPrev.addEventListener("click", () => browse(browsed - 1));
  bNext.addEventListener("click", () => browse(browsed + 1));
  bNow.addEventListener("click", () => toggle(browsed));
  hud.addEventListener("keydown", e => {
    if (e.key === "ArrowLeft") { e.preventDefault(); browse(browsed - 1); }
    if (e.key === "ArrowRight") { e.preventDefault(); browse(browsed + 1); }
  });
  function renderHud() {
    const r = records[browsed], travelling = running && (want === browsed || current === browsed);
    const playingThis = !running && current === browsed && want === browsed;
    // Same words in every state, so the control never changes size: the icon morphs between play and stop
    bNow.dataset.state = travelling ? "cueing" : playingThis ? "stop" : "play";
    bNow.querySelector(".t").textContent = r.title; bNow.title = r.title;
    bNow.setAttribute("aria-label", travelling ? `Cueing ${r.title}` : playingThis ? `Stop ${r.title}` : `Play ${r.title}`);
    bPrev.disabled = running || browsed === 0;
    bNext.disabled = running || browsed === crate.length - 1;
  }

  // Pointer. The cover you can see (or anywhere on the crate) plays; records in front or behind flip by one.
  // Hidden records never count as hits. Dragging the spinning record scratches it.
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(), canvas = renderer.domElement;
  const pick = e => {
    const r = canvas.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const targets = [...crate.map(c => c.sleeve), ...crateWalls, button, platter, ...crate.filter(c => c.disc.visible).map(c => c.disc)];
    const hit = ray.intersectObjects(targets, true)[0];
    if (!hit) return null;
    const o = hit.object;
    if (o.userData.i !== undefined) return o.userData.i === browsed || o.userData.i === want ? { act: "play" } : { act: o.userData.i < browsed ? "prev" : "next" };
    if (o.userData.crate) return { act: "play" };
    if (current !== null && crate[current].disc.visible && o.parent === crate[current].disc) return { act: "record" };
    return { act: "deck" };
  };
  canvas.addEventListener("pointermove", e => {
    if (drag) return scratchMove(e);
    if (e.pointerType !== "mouse") return;
    const h = pick(e), act = h && h.act;
    canvas.style.cursor = !h ? "" : act === "record" && !running ? "grab" : "pointer";
    setPreview(act === "play" || act === "prev" || act === "next" ? act : null);
  });
  canvas.addEventListener("pointerleave", () => { if (!drag) { canvas.style.cursor = ""; setPreview(null); } });
  let suppressClick = false;
  canvas.addEventListener("click", e => {
    if (suppressClick) { suppressClick = false; return; }
    const h = pick(e); if (!h) return;
    if (h.act === "play") return toggle(browsed);
    if (h.act === "prev") return browse(browsed - 1);
    if (h.act === "next") return browse(browsed + 1);
    if (want !== null) toggle(want); // the record, the platter or the start button: stop
  });

  // Easter egg: grab the spinning record and scratch it. The platter follows your hand; the music bends with it.
  let drag = null;
  const screenAngle = e => {
    const r = canvas.getBoundingClientRect(), p = PLATTER.clone().project(camera);
    const cx = r.left + (p.x * 0.5 + 0.5) * r.width, cy = r.top + (-p.y * 0.5 + 0.5) * r.height;
    return Math.atan2(e.clientY - cy, e.clientX - cx);
  };
  canvas.addEventListener("pointerdown", e => {
    if (running || current === null || want !== current) return;
    const h = pick(e); if (!h || h.act !== "record") return;
    drag = { x0: e.clientX, y0: e.clientY, a: screenAngle(e), t: performance.now(), live: false, rate: 1 };
    try { canvas.setPointerCapture(e.pointerId); } catch {} // keeps the drag even if the pointer leaves the canvas
  });
  function scratchMove(e) {
    if (!drag.live) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
      drag.live = scratching = true; omega = 0; omegaTarget = 0; canvas.style.cursor = "grabbing";
      const a = crate[current].audio; a.preservesPitch = false; a.webkitPreservesPitch = false;
    }
    const a = screenAngle(e), now = performance.now();
    let d = a - drag.a; d = Math.atan2(Math.sin(d), Math.cos(d));
    const dt = Math.max(0.008, (now - drag.t) / 1000);
    platter.rotation.y -= d;
    drag.rate += (Math.max(0.0625, Math.min(2.5, d / dt / OMEGA)) - drag.rate) * 0.45;
    crate[current].audio.playbackRate = drag.rate;
    drag.a = a; drag.t = now; invalidate();
  }
  const endDrag = e => {
    if (!drag) return;
    if (drag.live) {
      suppressClick = true; scratching = false; canvas.style.cursor = "grab";
      omegaTarget = OMEGA;
      const audio = crate[current].audio, from = audio.playbackRate;
      tween(420, k => { audio.playbackRate = from + (1 - from) * k; }, easeOut, "scratch");
    }
    drag = null;
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  // Frame the whole scene in whatever box it lives in
  const BOUNDS = new THREE.Box3(new THREE.Vector3(-3.9, FLOOR, -2.7), new THREE.Vector3(7.0, 4.1, 2.9));
  const corners = [...Array(8)].map((_, i) => new THREE.Vector3(i & 1 ? BOUNDS.max.x : BOUNDS.min.x, i & 2 ? BOUNDS.max.y : BOUNDS.min.y, i & 4 ? BOUNDS.max.z : BOUNDS.min.z))
    .concat([new THREE.Vector3(-2.6, FLOOR, 4.7), new THREE.Vector3(5.4, FLOOR, 4.7)]);
  const FOCUS = new THREE.Box3().setFromPoints(corners).getCenter(new THREE.Vector3()), VIEW = new THREE.Vector3(0, 0.62, 1).normalize();
  function resize() {
    const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    let lo = 5, hi = 200;
    for (let k = 0; k < 30; k++) {
      const d = (lo + hi) / 2;
      camera.position.copy(FOCUS).addScaledVector(VIEW, d); camera.lookAt(FOCUS); camera.updateMatrixWorld();
      const fits = corners.every(c => { const p = c.clone().project(camera); return Math.abs(p.x) < 0.97 && Math.abs(p.y) < 0.95; });
      fits ? (hi = d) : (lo = d);
    }
    camera.position.copy(FOCUS).addScaledVector(VIEW, hi); camera.lookAt(FOCUS); camera.updateMatrixWorld();
    const p = new THREE.Vector3(CRATE.position.x, 0, 2.6).project(camera);
    hud.style.transform = `translate(${(p.x * 0.5 + 0.5) * w}px, ${(-p.y * 0.5 + 0.5) * h}px) translate(-50%, -50%)`;
    invalidate();
  }
  new ResizeObserver(resize).observe(host);

  // Render only when something moves, and only while on screen
  let visible = true, frame = 0, last = performance.now(), dirty = true;
  function invalidate() { dirty = true; if (!frame && visible) frame = requestAnimationFrame(loop); }
  function loop(now) {
    frame = 0;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    for (let i = active.length - 1; i >= 0; i--) {
      const a = active[i], k = Math.min(1, (now - a.t0) / a.ms);
      a.fn(a.ease(k)); if (k === 1) { active.splice(i, 1); a.res(); }
    }
    omega += (omegaTarget - omega) * (1 - Math.exp(-dt * 3.2));
    if (Math.abs(omega) < 0.0005 && omegaTarget === 0) omega = 0;
    platter.rotation.y -= omega * dt;
    const moving = active.length || omega > 0 || scratching;
    if (moving && !reduce) {
      const t = now / 1000, f = 1 + 0.07 * Math.sin(t * 12.7) + 0.045 * Math.sin(t * 23.3 + 1.1) + 0.03 * Math.sin(t * 41.9 + 2.3);
      candleLight.intensity = CANDLE_I * f; flame.scale.set(1 - (f - 1) * 0.6, f, 1 - (f - 1) * 0.6); flame.rotation.z = Math.sin(t * 3.1) * 0.05;
    }
    renderer.render(scene, camera); dirty = false;
    if (visible && (moving || dirty)) frame = requestAnimationFrame(loop);
  }
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) { last = performance.now(); invalidate(); } }).observe(host);
  crate.forEach((c, j) => { c.holder.rotation.x = angleFor(j, 0); });
  renderHud();
  resize();

  // Diagnostics (prototype only)
  window.__tt = {
    state: () => ({ current, want, busy: running, browsed, active: active.length, hud: hud.textContent, prevDisabled: bPrev.disabled, nextDisabled: bNext.disabled }),
    tilts: () => crate.map(c => +c.holder.rotation.x.toFixed(3)),
    rate: () => current === null ? null : +crate[current].audio.playbackRate.toFixed(3),
    spin: () => +platter.rotation.y.toFixed(3),
    toScreen: (x, y, z) => { const r = canvas.getBoundingClientRect(), p = new THREE.Vector3(x, y, z).project(camera); return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height }; },
    platterAt: () => ({ x: PLATTER.x, y: RECORD_Y, z: PLATTER.z }),
    coverAt: () => { const v = sleeveCentre(crate[browsed]); return { x: v.x, y: v.y + 0.6, z: v.z }; },
    offsets: () => crate.map((c, i) => {
      const w = new THREE.Vector3(); c.disc.getWorldPosition(w);
      return { i, parent: c.disc.parent === platter ? "platter" : "scene", visible: c.disc.visible,
        dx: +(w.x - PLATTER.x).toFixed(3), dz: +(w.z - PLATTER.z).toFixed(3), y: +w.y.toFixed(3),
        lifted: +(c.holder.position.y - c.baseY).toFixed(3) };
    }),
  };
  return { play, stop, toggle, browse };
}
