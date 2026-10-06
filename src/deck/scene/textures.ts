import { CanvasTexture, RepeatWrapping, SRGBColorSpace, TextureLoader, type Texture, type WebGLRenderer } from "three";

export interface Textures {
  walnut: CanvasTexture[];
  grooves: CanvasTexture;
  fur: CanvasTexture;
  glow: CanvasTexture;
}

/** Resolves in the browser's next idle period (soon after, where requestIdleCallback is missing) */
export const idle = () =>
  new Promise<void>((resolve) => {
    if ("requestIdleCallback" in window) requestIdleCallback(() => resolve(), { timeout: 500 });
    else setTimeout(resolve, 16);
  });

// Runs a drawing generator in idle slices of about 8ms, so drawing never blocks the main thread for long (spec 5.2)
async function sliced<T>(work: Generator<void, T>): Promise<T> {
  for (;;) {
    await idle();
    const until = performance.now() + 8;
    for (;;) {
      const next = work.next();
      if (next.done) return next.value;
      if (performance.now() > until) break;
    }
  }
}

// Seeded, so every visit (and both posters) draws the same wood and grooves
const seeded = (seed: number) => {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
};

function canvas(width: number, height: number) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return { c, g: c.getContext("2d")! };
}

// Walnut, drawn rather than downloaded: warm brown bands, wavy grain and open pores
function* walnut(seed: number): Generator<void, HTMLCanvasElement> {
  const rnd = seeded(seed);
  const w = 1024;
  const h = 512;
  const { c, g } = canvas(w, h);
  g.fillStyle = "#5e3d28";
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 16; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? "38,22,13" : "128,88,58"},${0.06 + rnd() * 0.12})`;
    g.fillRect(0, rnd() * h, w, 18 + rnd() * 90);
  }
  yield;
  for (let i = 0; i < 280; i++) {
    const y0 = rnd() * h;
    const amp = 1.5 + rnd() * 9;
    const f = ((0.6 + rnd() * 2.2) * Math.PI * 2) / w;
    const ph = rnd() * 6.28;
    g.strokeStyle = `rgba(${rnd() < 0.72 ? "28,16,9" : "156,110,74"},${0.05 + rnd() * 0.17})`;
    g.lineWidth = 0.5 + rnd() * 1.6;
    g.beginPath();
    for (let x = 0; x <= w; x += 8) {
      const y = y0 + Math.sin(x * f + ph) * amp + Math.sin(x * f * 3.1 + ph * 2) * amp * 0.25;
      if (x) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.stroke();
    if (i % 40 === 39) yield;
  }
  for (let i = 0; i < 4200; i++) {
    g.fillStyle = `rgba(20,10,5,${0.1 + rnd() * 0.14})`;
    g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 6, 0.8);
    if (i % 700 === 699) yield;
  }
  return c;
}

// Fine concentric grooves, with darker gaps between the tracks
function* grooves(): Generator<void, HTMLCanvasElement> {
  const rnd = seeded(5);
  const { c, g } = canvas(1024, 1024);
  g.fillStyle = "#0d0d0d";
  g.fillRect(0, 0, 1024, 1024);
  g.lineWidth = 0.8;
  let drawn = 0;
  for (let r = 175; r < 506; r += 1.5) {
    g.strokeStyle = `rgba(255,255,255,${0.012 + rnd() * 0.028})`;
    g.beginPath();
    g.arc(512, 512, r, 0, Math.PI * 2);
    g.stroke();
    if (++drawn % 60 === 0) yield;
  }
  g.strokeStyle = "rgba(0,0,0,.85)";
  g.lineWidth = 4;
  for (const r of [250, 322, 401, 470]) {
    g.beginPath();
    g.arc(512, 512, r, 0, Math.PI * 2);
    g.stroke();
  }
  return c;
}

// The sheepskin's alpha: soft tufts, so each fur shell keeps only the denser middle of each and they form little domes
function* fur(): Generator<void, HTMLCanvasElement> {
  const S = 512;
  const rnd = seeded(11);
  const { c, g } = canvas(S, S);
  g.fillStyle = "#000";
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 5 + rnd() * 9;
    const v = 0.55 + rnd() * 0.45;
    // Drawn again across each edge, so the texture tiles without seams
    for (const dx of [-S, 0, S]) {
      for (const dy of [-S, 0, S]) {
        const cx = x + dx;
        const cy = y + dy;
        if (cx < -r || cx > S + r || cy < -r || cy > S + r) continue;
        const tuft = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        tuft.addColorStop(0, `rgba(255,255,255,${v})`);
        tuft.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = tuft;
        g.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
    }
    if (i % 200 === 199) yield;
  }
  return c;
}

function glow(): HTMLCanvasElement {
  const { c, g } = canvas(128, 128);
  const halo = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  halo.addColorStop(0, "rgba(255,200,130,1)");
  halo.addColorStop(0.35, "rgba(255,170,90,.35)");
  halo.addColorStop(1, "rgba(255,150,70,0)");
  g.fillStyle = halo;
  g.fillRect(0, 0, 128, 128);
  return c;
}

function plain(colour: string): HTMLCanvasElement {
  const { c, g } = canvas(4, 4);
  g.fillStyle = colour;
  g.fillRect(0, 0, 4, 4);
  return c;
}

export async function makeTextures(renderer: WebGLRenderer): Promise<Textures> {
  const anisotropy = renderer.capabilities.getMaxAnisotropy();
  const wood = async (seed: number, turned = false) => {
    const texture = new CanvasTexture(await sliced(walnut(seed)));
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.anisotropy = anisotropy;
    if (turned) {
      texture.center.set(0.5, 0.5);
      texture.rotation = Math.PI / 2;
    }
    return texture;
  };
  const walnuts = [await wood(7), await wood(19), await wood(31, true), await wood(43)];
  const vinyl = new CanvasTexture(await sliced(grooves()));
  vinyl.colorSpace = SRGBColorSpace;
  vinyl.anisotropy = anisotropy;
  const pelt = new CanvasTexture(await sliced(fur()));
  pelt.wrapS = pelt.wrapT = RepeatWrapping;
  pelt.repeat.set(0.38, 0.38);
  return { walnut: walnuts, grooves: vinyl, fur: pelt, glow: new CanvasTexture(glow()) };
}

/** The covers as textures; a cover that fails to load leaves a plain sleeve */
export function loadCovers(urls: string[]): Promise<Texture[]> {
  const loader = new TextureLoader();
  return Promise.all(
    urls.map(async (url) => {
      const texture: Texture = await loader.loadAsync(url).catch(() => new CanvasTexture(plain("#e9e4d8")));
      texture.colorSpace = SRGBColorSpace;
      texture.anisotropy = 8;
      return texture;
    }),
  );
}
