import {
  AdditiveBlending,
  BoxGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Euler,
  Group,
  HemisphereLight,
  InstancedMesh,
  LatheGeometry,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  Quaternion,
  Scene,
  ShadowMaterial,
  Shape,
  ShapeGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Texture,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { ARM_LEN, ARM_UP, CRATE, CRATE_SIZE, FLOOR, PIVOT, PLATTER, SHELF_TOP, SLEEVE, slotZ, tiltFor } from "./layout";
import type { Light } from "./lighting";
import { idle, type Textures } from "./textures";

export interface CrateRecord {
  /** Pivots on the record's bottom edge, like a real one in a crate */
  holder: Group;
  sleeve: Mesh;
  disc: Group;
  baseY: number;
}

export interface Stage {
  scene: Scene;
  camera: PerspectiveCamera;
  platter: Group;
  arm: Group;
  button: Mesh;
  lamp: MeshStandardMaterial;
  candle: { light: PointLight; flame: Mesh; intensity: number };
  crateWalls: Mesh[];
  records: CrateRecord[];
}

export function createRenderer(): WebGLRenderer {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  // Device pixel ratio capped at 2, and 1.5 on coarse pointers (spec 5.2)
  renderer.setPixelRatio(Math.min(devicePixelRatio, matchMedia("(pointer: coarse)").matches ? 1.5 : 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  return renderer;
}

const solid = <T extends Mesh>(mesh: T): T => {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
};
const curve = (points: [number, number][]) => points.map(([r, y]) => new Vector2(r, y));
const lathe = (points: [number, number][], material: Material, segments = 48) => solid(new Mesh(new LatheGeometry(curve(points), segments), material));
const LEGS: [number, number][] = [[-3.2, -2.05], [6.4, -2.05], [-3.2, 2.05], [6.4, 2.05]];
const SPINE_TONES = [0xe7e1d4, 0x2b2a28, 0xa8432c, 0x6f6a4b, 0xb38b3c, 0x4b5560, 0xd8cdb8, 0x7c4a33, 0x1f2a2e, 0xc9b79b];
const SLEEVE_BACKS = [0xe8e2d5, 0xdfd6c4, 0xe6dccb, 0xd9d1c1];

// The room: a low walnut record console on a sheepskin, a Beogram-ish turntable, a crate to flip through and a
// candle (spec 5.2). Built in idle slices between sections.
export async function buildStage(renderer: WebGLRenderer, textures: Textures, covers: Texture[], light: Light): Promise<Stage> {
  const scene = new Scene();
  // The one scene task allowed over 50ms (about 70ms at 4× CPU, once, before the canvas shows, while the poster is still
  // on screen; spec 11 and ADR-0017). It gets idle moments either side, so nothing else lands in the same task
  await idle();
  if (__TEST_HOOKS__) performance.mark("deck:environment:start");
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  if (__TEST_HOOKS__) performance.measure("deck:environment", "deck:environment:start");
  await idle();
  scene.environmentIntensity = light.environment;
  const camera = new PerspectiveCamera(24, 1, 0.1, 200);

  // Warm, low light that follows the time in Sydney
  const key = new DirectionalLight(light.key.color, light.key.intensity);
  key.position.set(...light.key.position);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.025;
  // Wide enough for the console, its shelf and the rug (three also applies these when it first allocates the map)
  Object.assign(key.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 60 });
  key.shadow.camera.updateProjectionMatrix();
  key.target.position.set(1.6, -2, 0.5);
  scene.add(key, key.target, new HemisphereLight(0xfff3e4, 0x7a5a42, light.bounce));
  const ground = new Mesh(new PlaneGeometry(80, 80), new ShadowMaterial({ opacity: 0.2 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = FLOOR;
  ground.receiveShadow = true;
  scene.add(ground);

  const oiled = (map: Texture) => new MeshPhysicalMaterial({ map, roughness: 0.48, clearcoat: 0.3, clearcoatRoughness: 0.5 });
  const M = {
    walnut: oiled(textures.walnut[0]),
    walnutDeck: oiled(textures.walnut[1]),
    walnutLeg: oiled(textures.walnut[2]),
    walnutCrate: oiled(textures.walnut[3]),
    deckPlate: new MeshStandardMaterial({ color: 0xd9d8d3, metalness: 0.7, roughness: 0.42 }),
    alu: new MeshStandardMaterial({ color: 0xd2d1cc, metalness: 0.9, roughness: 0.3 }),
    felt: new MeshStandardMaterial({ color: 0x3b3835, roughness: 1 }),
    ink: new MeshStandardMaterial({ color: 0x262422, roughness: 0.45, metalness: 0.2 }),
    lamp: new MeshStandardMaterial({ color: 0x4a1c14, emissive: 0xd8553a, emissiveIntensity: 0 }),
    sleeveEdge: new MeshStandardMaterial({ color: 0xe9e4d8, roughness: 0.9 }),
    vinylEdge: new MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.5 }),
    stoneware: new MeshStandardMaterial({ color: 0xd9cfbf, roughness: 0.92 }),
    wax: new MeshStandardMaterial({ color: 0xf3ece0, roughness: 0.6, emissive: 0xffb070, emissiveIntensity: 0.06 }),
  };

  // The console: walnut top, splayed tapered legs, an open shelf for the collection
  const top = solid(new Mesh(new RoundedBoxGeometry(10.8, 0.3, 5.2, 4, 0.1), M.walnut));
  top.position.set(1.6, -0.15, 0);
  const shelf = solid(new Mesh(new RoundedBoxGeometry(9.7, 0.14, 4.4, 3, 0.05), M.walnut));
  shelf.position.set(1.6, -3.7, 0);
  scene.add(top, shelf);
  for (const [x, z] of LEGS) {
    const leg = solid(new Mesh(new CylinderGeometry(0.14, 0.08, 4.35, 28), M.walnutLeg));
    const sx = Math.sign(x - 1.6);
    const sz = Math.sign(z);
    leg.position.set(x + sx * 0.18, -0.3 - 2.15, z + sz * 0.12);
    leg.rotation.z = -sx * MathUtils.degToRad(4.5);
    leg.rotation.x = sz * MathUtils.degToRad(3);
    scene.add(leg);
  }

  // The rest of the collection, on edge on the shelf, as one draw call
  const count = 44;
  const spines = solid(new InstancedMesh(new BoxGeometry(0.048, 3.05, 3.05), new MeshStandardMaterial({ roughness: 0.85 }), count));
  const m4 = new Matrix4();
  const q = new Quaternion();
  const e = new Euler();
  const one = new Vector3(1, 1, 1);
  const tone = new Color();
  let x = -2.75;
  for (let i = 0; i < count; i++) {
    const leaning = i > count - 4;
    const lean = leaning ? MathUtils.degToRad(9 + (i - (count - 4)) * 2.5) : MathUtils.degToRad(Math.sin(i * 12.9) * 0.8);
    x += leaning ? 0.2 : 0.054;
    q.setFromEuler(e.set(0, 0, -lean));
    m4.compose(new Vector3(x + Math.sin(lean) * 1.5, SHELF_TOP + 1.525 * Math.cos(lean), 0.05 + Math.sin(i * 7.3) * 0.08), q, one);
    spines.setMatrixAt(i, m4);
    spines.setColorAt(i, tone.setHex(SPINE_TONES[(i * 7) % SPINE_TONES.length]));
  }
  const jug = lathe([[0, 0], [0.42, 0], [0.5, 0.12], [0.56, 0.45], [0.52, 0.85], [0.36, 1.15], [0.27, 1.42], [0.31, 1.56], [0.29, 1.6], [0.24, 1.6], [0.25, 1.45]], M.stoneware);
  jug.position.set(5.2, SHELF_TOP, 0.4);
  scene.add(spines, jug);
  await idle();

  // Sheepskin: twenty alpha-tested fur shells over an irregular pelt outline
  const outline: Vector2[] = [];
  const lobe = (a: number, c: number, w: number, h: number) => {
    const d = Math.atan2(Math.sin(a - c), Math.cos(a - c));
    return h * Math.exp(-((d / w) ** 2));
  };
  for (let k = 0; k < 180; k++) {
    const a = (k / 180) * Math.PI * 2;
    let r = 1 + 0.05 * Math.sin(3 * a + 0.7) + 0.022 * Math.sin(11 * a + 1.3) + 0.012 * Math.sin(23 * a + 0.4);
    r += lobe(a, 0.62, 0.1, 0.17) + lobe(a, -0.62, 0.1, 0.17) + lobe(a, Math.PI - 0.58, 0.11, 0.19) + lobe(a, Math.PI + 0.58, 0.11, 0.19) + lobe(a, Math.PI, 0.16, 0.08);
    outline.push(new Vector2(Math.cos(a) * r * 4.3, Math.sin(a) * r * 2.75));
  }
  const pelt = new ShapeGeometry(new Shape(outline), 1);
  pelt.rotateX(-Math.PI / 2);
  const rug = new Group();
  rug.position.set(1.3, FLOOR, 1.7);
  rug.rotation.y = 0.08;
  const roots = new Color(0xa3947b);
  const tips = new Color(0xf7f2ea);
  const shells = 20;
  for (let k = 0; k < shells; k++) {
    const f = k / (shells - 1);
    const material = new MeshStandardMaterial({ color: roots.clone().lerp(tips, Math.pow(f, 0.6)), roughness: 1, alphaMap: k ? textures.fur : null, alphaTest: k ? 0.08 + 0.75 * f : 0 });
    const shell = new Mesh(pelt, material);
    shell.position.y = 0.006 + k * 0.028;
    shell.scale.setScalar(1 - k * 0.006);
    shell.receiveShadow = true;
    rug.add(shell);
  }
  scene.add(rug);
  await idle();

  // Turntable: walnut frame, brushed deck plate, aluminium platter with a felt mat, tonearm, start button and lamp
  const deckFrame = solid(new Mesh(new RoundedBoxGeometry(4.6, 0.3, 3.6, 5, 0.08), M.walnutDeck));
  deckFrame.position.set(-1.0, 0.15, 0);
  const plate = solid(new Mesh(new BoxGeometry(4.34, 0.024, 3.34), M.deckPlate));
  plate.position.set(-1.0, 0.31, 0);
  const platter = new Group();
  platter.position.copy(PLATTER);
  const body = solid(new Mesh(new CylinderGeometry(1.53, 1.53, 0.14, 128), [M.alu, M.felt, M.alu]));
  body.position.y = 0.07;
  const spindle = solid(new Mesh(new CylinderGeometry(0.035, 0.035, 0.16, 16), M.alu));
  spindle.position.y = 0.21;
  platter.add(body, spindle);
  const armBase = solid(new Mesh(new CylinderGeometry(0.21, 0.23, 0.12, 48), M.alu));
  armBase.position.set(PIVOT.x, PIVOT.y + 0.06, PIVOT.z);
  const post = solid(new Mesh(new CylinderGeometry(0.05, 0.05, 0.3, 16), M.alu));
  post.position.set(PIVOT.x, PIVOT.y + 0.2, PIVOT.z);
  const arm = new Group();
  arm.position.set(PIVOT.x, ARM_UP, PIVOT.z);
  const tube = solid(new Mesh(new CylinderGeometry(0.028, 0.028, 2.5, 16), M.alu));
  tube.rotation.x = Math.PI / 2;
  tube.position.z = 1.1;
  const head = solid(new Mesh(new BoxGeometry(0.17, 0.05, 0.34), M.ink));
  head.position.set(0, -0.03, ARM_LEN);
  const weight = solid(new Mesh(new CylinderGeometry(0.13, 0.13, 0.26, 32), M.ink));
  weight.rotation.x = Math.PI / 2;
  weight.position.z = -0.32;
  arm.add(tube, head, weight);
  const rest = solid(new Mesh(new CylinderGeometry(0.04, 0.04, 0.28, 12), M.alu));
  rest.position.set(PIVOT.x + 0.22, PIVOT.y + 0.14, PIVOT.z + 2.05);
  const button = solid(new Mesh(new CylinderGeometry(0.15, 0.15, 0.05, 40), M.alu));
  button.position.set(0.82, 0.345, 1.32);
  const lampDot = new Mesh(new CylinderGeometry(0.045, 0.045, 0.03, 20), M.lamp);
  lampDot.position.set(0.42, 0.335, 1.42);
  scene.add(deckFrame, plate, platter, armBase, post, arm, rest, button, lampDot);

  // Candle in a stoneware dish; it flickers only while something moves, so an idle page costs nothing
  const candle = new Group();
  candle.position.set(1.95, 0, 1.75);
  const wax = solid(new Mesh(new CylinderGeometry(0.3, 0.31, 0.8, 40), M.wax));
  wax.position.y = 0.46;
  const pool = new Mesh(new CircleGeometry(0.25, 32), new MeshStandardMaterial({ color: 0xe9dcc6, roughness: 0.3 }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.861;
  const wick = new Mesh(new CylinderGeometry(0.012, 0.012, 0.1, 8), M.ink);
  wick.position.y = 0.91;
  const flame = new Mesh(new LatheGeometry(curve([[0, 0], [0.05, 0.03], [0.075, 0.1], [0.062, 0.2], [0.032, 0.29], [0, 0.36]]), 24), new MeshBasicMaterial({ color: 0xffd896 }));
  flame.position.y = 0.93;
  const glow = new Sprite(new SpriteMaterial({ map: textures.glow, blending: AdditiveBlending, depthWrite: false, opacity: light.glow.opacity }));
  glow.position.y = 1.08;
  glow.scale.setScalar(light.glow.scale);
  const candleLight = new PointLight(0xffa552, light.candle, 9, 2);
  candleLight.position.y = 1.2;
  const dish = lathe([[0, 0], [0.5, 0], [0.57, 0.04], [0.56, 0.11], [0.51, 0.11], [0.44, 0.06], [0, 0.06]], M.stoneware);
  candle.add(dish, wax, pool, wick, flame, glow, candleLight);
  scene.add(candle);
  await idle();

  // The crate: walnut, open at the top, the records standing in it with their covers facing out
  const crate = new Group();
  crate.position.copy(CRATE);
  const { width: CW, depth: CD, wall: CT, floor: CF } = CRATE_SIZE;
  const crateWalls: Mesh[] = [];
  const wall = (w: number, h: number, d: number, px: number, py: number, pz: number) => {
    const mesh = solid(new Mesh(new RoundedBoxGeometry(w, h, d, 2, 0.03), M.walnutCrate));
    mesh.position.set(px, py, pz);
    crate.add(mesh);
    crateWalls.push(mesh);
  };
  wall(CW, CF, CD, 0, CF / 2, 0);
  wall(CW, 0.75, CT, 0, 0.375, CD / 2 - CT / 2);
  wall(CW, 1.2, CT, 0, 0.6, -CD / 2 + CT / 2);
  wall(CT, 0.95, CD, -CW / 2 + CT / 2, 0.475, 0);
  wall(CT, 0.95, CD, CW / 2 - CT / 2, 0.475, 0);
  scene.add(crate);

  const vinyl = new MeshPhysicalMaterial({ map: textures.grooves, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.22 });
  const sleeveShape = new BoxGeometry(SLEEVE, SLEEVE, 0.04);
  const discShape = new CylinderGeometry(1.45, 1.45, 0.02, 128);
  const labelShape = new CircleGeometry(0.48, 64);
  const holeShape = new CircleGeometry(0.04, 24);
  const holeMaterial = new MeshBasicMaterial({ color: 0x111111 });
  const records = covers.map((cover, i): CrateRecord => {
    const holder = new Group();
    holder.position.set(0, CF, slotZ(i, covers.length));
    holder.rotation.x = tiltFor(i, 0);
    crate.add(holder);
    const front = new MeshStandardMaterial({ map: cover, roughness: 0.75 });
    const back = new MeshStandardMaterial({ color: SLEEVE_BACKS[i % SLEEVE_BACKS.length], roughness: 0.9 });
    const sleeve = solid(new Mesh(sleeveShape, [M.sleeveEdge, M.sleeveEdge, M.sleeveEdge, M.sleeveEdge, front, back]));
    sleeve.position.y = SLEEVE / 2;
    sleeve.userData.index = i;
    holder.add(sleeve);
    const disc = new Group();
    const label = new Mesh(labelShape, new MeshStandardMaterial({ map: cover, roughness: 0.8 }));
    label.rotation.x = -Math.PI / 2;
    label.position.y = 0.0106;
    const hole = new Mesh(holeShape, holeMaterial);
    hole.rotation.x = -Math.PI / 2;
    hole.position.y = 0.011;
    disc.add(solid(new Mesh(discShape, [M.vinylEdge, vinyl, M.vinylEdge])), label, hole);
    disc.visible = false;
    scene.add(disc);
    return { holder, sleeve, disc, baseY: holder.position.y };
  });

  return { scene, camera, platter, arm, button, lamp: M.lamp, candle: { light: candleLight, flame, intensity: light.candle }, crateWalls, records };
}
