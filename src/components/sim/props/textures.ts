import * as THREE from "three";

/**
 * Procedural canvas textures for the recognisable scene props (wood, asphalt,
 * balls, planets...). Everything is drawn once in code and cached by key — no
 * image files, no network requests, works offline and inside the mobile app.
 */

const cache = new Map<string, THREE.CanvasTexture>();

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

interface TextureOptions {
  /** RepeatWrapping on both axes (tile the texture) */
  wrap?: boolean;
  repeat?: [number, number];
  /** color textures are sRGB; data textures (bump/roughness) are linear */
  linear?: boolean;
}

export function canvasTexture(key: string, width: number, height: number, draw: Draw, options: TextureOptions = {}): THREE.CanvasTexture {
  const fullKey = `${key}|${options.repeat?.join("x") ?? ""}|${options.wrap ? "w" : ""}`;
  const cached = cache.get(fullKey);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) draw(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  if (!options.linear) texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  if (options.wrap) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
  }
  if (options.repeat) texture.repeat.set(options.repeat[0], options.repeat[1]);
  cache.set(fullKey, texture);
  return texture;
}

/* ---------- deterministic noise ---------- */

export function seededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3(x: number, y: number, z: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 144269504) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

function valueNoise3(x: number, y: number, z: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const zf = smooth(z - zi);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c000 = hash3(xi, yi, zi, seed);
  const c100 = hash3(xi + 1, yi, zi, seed);
  const c010 = hash3(xi, yi + 1, zi, seed);
  const c110 = hash3(xi + 1, yi + 1, zi, seed);
  const c001 = hash3(xi, yi, zi + 1, seed);
  const c101 = hash3(xi + 1, yi, zi + 1, seed);
  const c011 = hash3(xi, yi + 1, zi + 1, seed);
  const c111 = hash3(xi + 1, yi + 1, zi + 1, seed);
  return lerp(
    lerp(lerp(c000, c100, xf), lerp(c010, c110, xf), yf),
    lerp(lerp(c001, c101, xf), lerp(c011, c111, xf), yf),
    zf,
  );
}

export function fbm3(x: number, y: number, z: number, seed: number, octaves = 4) {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise3(x * freq, y * freq, z * freq, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

/** Paint an equirectangular sphere texture pixel by pixel from the 3D surface point. */
function paintSphere(ctx: CanvasRenderingContext2D, w: number, h: number, shade: (x: number, y: number, z: number, lat: number) => [number, number, number]) {
  const img = ctx.createImageData(w, h);
  for (let py = 0; py < h; py++) {
    const theta = ((py + 0.5) / h) * Math.PI;
    const sinT = Math.sin(theta);
    const y = Math.cos(theta);
    for (let px = 0; px < w; px++) {
      const phi = ((px + 0.5) / w) * Math.PI * 2;
      const x = -Math.cos(phi) * sinT;
      const z = Math.sin(phi) * sinT;
      const [r, g, b] = shade(x, y, z, Math.PI / 2 - theta);
      const i = (py * w + px) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

const mix = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t));
const mixRGB = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [
  mix(a[0], b[0], t),
  mix(a[1], b[1], t),
  mix(a[2], b[2], t),
];

/* ---------- materials ---------- */

/** Wooden planks; `tone` shifts the hue (light pine → dark oak). */
export function woodTexture(tone: "light" | "medium" | "dark" = "medium", planks = 4) {
  const base: Record<string, [number, number, number]> = {
    light: [214, 170, 112],
    medium: [168, 112, 62],
    dark: [104, 66, 38],
  };
  return canvasTexture(`wood-${tone}-${planks}`, 256, 256, (ctx, w, h) => {
    const rand = seededRandom(planks * 31 + tone.length);
    const [r, g, b] = base[tone];
    const plankH = h / planks;
    for (let p = 0; p < planks; p++) {
      const k = 0.85 + rand() * 0.3;
      ctx.fillStyle = `rgb(${r * k},${g * k},${b * k})`;
      ctx.fillRect(0, p * plankH, w, plankH);
      // grain
      for (let i = 0; i < 18; i++) {
        const y = p * plankH + rand() * plankH;
        ctx.strokeStyle = `rgba(60,35,15,${0.08 + rand() * 0.14})`;
        ctx.lineWidth = 0.6 + rand() * 1.4;
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (let x = 0; x <= w; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.03 + i) * 2.2);
        ctx.stroke();
      }
      // knot
      if (rand() > 0.5) {
        const kx = rand() * w;
        const ky = p * plankH + plankH / 2;
        ctx.fillStyle = "rgba(70,40,18,0.55)";
        ctx.beginPath();
        ctx.ellipse(kx, ky, 7, 3.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "rgba(30,18,8,0.65)";
      ctx.fillRect(0, p * plankH, w, 2);
    }
  });
}

/** Asphalt road running along +x: edge lines + dashed centre line. Tile with repeat.x. */
export function roadTexture() {
  return canvasTexture(
    "road",
    256,
    256,
    (ctx, w, h) => {
      const rand = seededRandom(7);
      ctx.fillStyle = "#3a3b40";
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 2600; i++) {
        const g = 40 + rand() * 50;
        ctx.fillStyle = `rgba(${g},${g},${g + 4},0.5)`;
        ctx.fillRect(rand() * w, rand() * h, 1.5, 1.5);
      }
      ctx.fillStyle = "#e9e9e2";
      ctx.fillRect(0, h * 0.07, w, h * 0.025);
      ctx.fillRect(0, h * 0.905, w, h * 0.025);
      ctx.fillStyle = "#f2d14b";
      ctx.fillRect(w * 0.08, h * 0.49, w * 0.45, h * 0.025);
    },
    { wrap: true },
  );
}

/** Plain asphalt without road markings. */
export function asphaltTexture() {
  return canvasTexture(
    "asphalt",
    256,
    256,
    (ctx, w, h) => {
      const rand = seededRandom(23);
      ctx.fillStyle = "#56585e";
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 3200; i++) {
        const g = 38 + rand() * 60;
        ctx.fillStyle = `rgba(${g},${g},${g + 4},0.55)`;
        ctx.fillRect(rand() * w, rand() * h, 1.6, 1.6);
      }
    },
    { wrap: true },
  );
}

/** Light concrete slab. */
export function concreteTexture() {
  return canvasTexture(
    "concrete",
    256,
    256,
    (ctx, w, h) => {
      const rand = seededRandom(29);
      ctx.fillStyle = "#8a8d93";
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 2600; i++) {
        const g = 110 + rand() * 50;
        ctx.fillStyle = `rgba(${g},${g},${g + 3},0.45)`;
        ctx.fillRect(rand() * w, rand() * h, 2, 2);
      }
      ctx.strokeStyle = "rgba(40,40,45,0.35)";
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, w - 2, h - 2);
    },
    { wrap: true },
  );
}

/** Red running track with white lane lines along +x. */
export function trackTexture() {
  return canvasTexture(
    "track",
    256,
    256,
    (ctx, w, h) => {
      const rand = seededRandom(11);
      ctx.fillStyle = "#b5483a";
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 2200; i++) {
        ctx.fillStyle = `rgba(${120 + rand() * 60},${40 + rand() * 30},${30 + rand() * 20},0.45)`;
        ctx.fillRect(rand() * w, rand() * h, 1.5, 1.5);
      }
      ctx.fillStyle = "#f4f1ea";
      for (let lane = 0; lane <= 4; lane++) ctx.fillRect(0, (lane / 4) * h - 1.5, w, 3);
    },
    { wrap: true },
  );
}

/** Mowed grass with alternating stripes across x. */
export function grassTexture() {
  return canvasTexture(
    "grass",
    256,
    256,
    (ctx, w, h) => {
      const rand = seededRandom(5);
      for (let s = 0; s < 4; s++) {
        ctx.fillStyle = s % 2 ? "#2f7a35" : "#38893d";
        ctx.fillRect((s / 4) * w, 0, w / 4, h);
      }
      for (let i = 0; i < 4000; i++) {
        ctx.fillStyle = `rgba(${20 + rand() * 40},${90 + rand() * 70},${25 + rand() * 30},0.5)`;
        ctx.fillRect(rand() * w, rand() * h, 1, 2.5);
      }
    },
    { wrap: true },
  );
}

/** Ice rink: bluish white with skate scratches. */
export function iceTexture() {
  return canvasTexture(
    "ice",
    512,
    256,
    (ctx, w, h) => {
      const rand = seededRandom(3);
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#dfeef8");
      grad.addColorStop(1, "#c8dff0");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 160; i++) {
        ctx.strokeStyle = `rgba(255,255,255,${0.25 + rand() * 0.5})`;
        ctx.lineWidth = 0.6 + rand();
        ctx.beginPath();
        const x = rand() * w;
        const y = rand() * h;
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + 30 + rand() * 60, y + (rand() - 0.5) * 30, x + 60 + rand() * 120, y + (rand() - 0.5) * 40);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(200,40,50,0.55)";
      ctx.fillRect(w / 2 - 3, 0, 6, h);
    },
    { wrap: true },
  );
}

/** Basketball court parquet. */
export function parquetTexture() {
  return canvasTexture(
    "parquet",
    256,
    256,
    (ctx, w, h) => {
      const rand = seededRandom(9);
      const rows = 8;
      for (let r = 0; r < rows; r++) {
        let x = -rand() * 80;
        while (x < w) {
          const len = 60 + rand() * 70;
          const k = 0.88 + rand() * 0.2;
          ctx.fillStyle = `rgb(${222 * k},${171 * k},${112 * k})`;
          ctx.fillRect(x, (r / rows) * h, len, h / rows);
          ctx.fillStyle = "rgba(90,55,25,0.35)";
          ctx.fillRect(x, (r / rows) * h, 1.5, h / rows);
          x += len;
        }
        ctx.fillStyle = "rgba(90,55,25,0.3)";
        ctx.fillRect(0, (r / rows) * h, w, 1);
      }
    },
    { wrap: true },
  );
}

/** Snowy slope / white surface with subtle blue shading. */
export function snowTexture() {
  return canvasTexture(
    "snow",
    256,
    256,
    (ctx, w, h) => {
      const rand = seededRandom(21);
      ctx.fillStyle = "#eef3fb";
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 3000; i++) {
        const b = 215 + rand() * 40;
        ctx.fillStyle = `rgba(${b - 10},${b - 4},${b + 5},0.5)`;
        ctx.fillRect(rand() * w, rand() * h, 2, 2);
      }
    },
    { wrap: true },
  );
}

/** Concrete / lab floor tiles. */
export function tileTexture() {
  return canvasTexture(
    "tiles",
    256,
    256,
    (ctx, w, h) => {
      const rand = seededRandom(13);
      const n = 4;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const g = 52 + rand() * 10;
          ctx.fillStyle = `rgb(${g},${g + 2},${g + 6})`;
          ctx.fillRect((i / n) * w, (j / n) * h, w / n, h / n);
        }
      ctx.strokeStyle = "rgba(0,0,0,0.45)";
      ctx.lineWidth = 2;
      for (let i = 0; i <= n; i++) {
        ctx.beginPath();
        ctx.moveTo((i / n) * w, 0);
        ctx.lineTo((i / n) * w, h);
        ctx.moveTo(0, (i / n) * h);
        ctx.lineTo(w, (i / n) * h);
        ctx.stroke();
      }
    },
    { wrap: true },
  );
}

/** Brick / stone wall. */
export function brickTexture() {
  return canvasTexture(
    "brick",
    256,
    256,
    (ctx, w, h) => {
      const rand = seededRandom(17);
      ctx.fillStyle = "#6b6460";
      ctx.fillRect(0, 0, w, h);
      const rows = 8;
      const bh = h / rows;
      for (let r = 0; r < rows; r++) {
        const offset = r % 2 ? 32 : 0;
        for (let x = -offset; x < w; x += 64) {
          const k = 0.8 + rand() * 0.35;
          ctx.fillStyle = `rgb(${150 * k},${132 * k},${116 * k})`;
          ctx.fillRect(x + 2, r * bh + 2, 60, bh - 4);
        }
      }
    },
    { wrap: true },
  );
}

/** Yellow measuring tape from `min` to `max` metres with a tick every metre and a number every `labelEvery`. */
export function tapeTexture(min: number, max: number, labelEvery = 1) {
  const metres = max - min;
  const pxPerM = 96;
  return canvasTexture(`tape-${min}-${max}-${labelEvery}`, Math.min(4096, metres * pxPerM), 96, (ctx, w, h) => {
    const k = w / metres;
    ctx.fillStyle = "#f2c94c";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#1c1917";
    for (let i = 0; i <= metres * 10; i++) {
      const x = i * (k / 10);
      const major = i % 10 === 0;
      const half = i % 5 === 0;
      ctx.fillRect(x - (major ? 1.5 : 0.75), 0, major ? 3 : 1.5, major ? h * 0.45 : half ? h * 0.3 : h * 0.18);
    }
    ctx.font = "bold 30px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (let m = 0; m <= metres; m++) {
      const value = min + m;
      if (value % labelEvery !== 0) continue;
      ctx.fillText(String(value), Math.min(w - 18, Math.max(18, m * k)), h - 12);
    }
  });
}

/** Vinyl record: black grooves with a coloured centre label. */
export function vinylTexture() {
  return canvasTexture("vinyl", 512, 512, (ctx, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    ctx.fillStyle = "#0b0b0d";
    ctx.fillRect(0, 0, w, h);
    for (let r = w * 0.18; r < w * 0.49; r += 2.2) {
      ctx.strokeStyle = `rgba(255,255,255,${0.03 + 0.04 * Math.abs(Math.sin(r * 0.21))})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    // glossy reflection band
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0.35, "rgba(255,255,255,0)");
    grad.addColorStop(0.5, "rgba(255,255,255,0.08)");
    grad.addColorStop(0.65, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.49, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#dc2626";
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fde68a";
    ctx.font = "bold 30px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("ФизЛаб", cx, cy - 22);
    ctx.font = "20px sans-serif";
    ctx.fillText("33⅓ об/мин", cx, cy + 40);
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.fill();
  });
}

/** Playground carousel deck: coloured sectors. */
export function carouselTexture() {
  return canvasTexture("carousel", 512, 512, (ctx, w, h) => {
    const colors = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"];
    const n = 12;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = colors[i % colors.length];
      ctx.beginPath();
      ctx.moveTo(w / 2, h / 2);
      ctx.arc(w / 2, h / 2, w / 2, (i / n) * Math.PI * 2, ((i + 1) / n) * Math.PI * 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 3;
    for (const r of [0.3, 0.6]) {
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, (w / 2) * r, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}

/* ---------- balls ---------- */

export function basketballTexture() {
  return canvasTexture("basketball", 512, 256, (ctx, w, h) => {
    paintSphere(ctx, w, h, (x, y, z) => {
      const n = fbm3(x * 40, y * 40, z * 40, 2, 2);
      const k = 0.9 + n * 0.15;
      return [216 * k, 104 * k, 40 * k];
    });
    ctx.strokeStyle = "#1b1410";
    ctx.lineWidth = 3;
    // equator + meridian seams
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.moveTo(w / 4, 0);
    ctx.lineTo(w / 4, h);
    ctx.moveTo((3 * w) / 4, 0);
    ctx.lineTo((3 * w) / 4, h);
    ctx.stroke();
    // two curved seams: small circles on planes z = ±c
    const c = 0.72;
    for (const sign of [1, -1]) {
      ctx.beginPath();
      let first = true;
      const pts: [number, number][] = [];
      for (let i = 0; i <= 120; i++) {
        const theta = Math.asin(c) + (i / 120) * (Math.PI - 2 * Math.asin(c));
        const s = Math.min(1, c / Math.sin(theta));
        const phi = Math.asin(s);
        pts.push([sign > 0 ? phi : Math.PI + phi, theta]);
      }
      for (let i = 120; i >= 0; i--) {
        const theta = Math.asin(c) + (i / 120) * (Math.PI - 2 * Math.asin(c));
        const s = Math.min(1, c / Math.sin(theta));
        const phi = Math.asin(s);
        pts.push([sign > 0 ? Math.PI - phi : 2 * Math.PI - phi, theta]);
      }
      for (const [phi, theta] of pts) {
        const px = (phi / (Math.PI * 2)) * w;
        const py = (theta / Math.PI) * h;
        if (first) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
        first = false;
      }
      ctx.closePath();
      ctx.stroke();
    }
  });
}

const ICO_CENTERS: [number, number, number][] = (() => {
  const p = (1 + Math.sqrt(5)) / 2;
  const raw: [number, number, number][] = [
    [0, 1, p], [0, -1, p], [0, 1, -p], [0, -1, -p],
    [1, p, 0], [-1, p, 0], [1, -p, 0], [-1, -p, 0],
    [p, 0, 1], [-p, 0, 1], [p, 0, -1], [-p, 0, -1],
  ];
  return raw.map(([a, b, c]) => {
    const l = Math.hypot(a, b, c);
    return [a / l, b / l, c / l];
  });
})();

export function soccerTexture() {
  return canvasTexture("soccer", 512, 256, (ctx, w, h) => {
    const cosPatch = Math.cos(0.36);
    const cosSeam = Math.cos(0.555);
    paintSphere(ctx, w, h, (x, y, z) => {
      let best = -1;
      let second = -1;
      for (const [a, b, c] of ICO_CENTERS) {
        const d = x * a + y * b + z * c;
        if (d > best) {
          second = best;
          best = d;
        } else if (d > second) second = d;
      }
      if (best > cosPatch) return [24, 24, 28];
      // faint seams between the white hexagons
      if (Math.abs(best - second) < 0.012 || Math.abs(best - cosSeam) < 0.006) return [170, 170, 176];
      return [242, 242, 238];
    });
  });
}

const BILLIARD_COLORS = ["#f2c230", "#2350c8", "#d33a2c", "#6b2d8f", "#ef7a22", "#1f8a3c", "#8b1f2b", "#151515"];

export function billiardTexture(num: number) {
  const color = num === 0 ? "#f3efe6" : BILLIARD_COLORS[(num - 1) % 8];
  const striped = num > 8;
  return canvasTexture(`billiard-${num}`, 256, 128, (ctx, w, h) => {
    ctx.fillStyle = striped ? "#f3efe6" : color;
    ctx.fillRect(0, 0, w, h);
    if (striped) {
      ctx.fillStyle = color;
      ctx.fillRect(0, h * 0.28, w, h * 0.44);
    }
    if (num > 0) {
      for (const cx of [w * 0.25, w * 0.75]) {
        ctx.fillStyle = "#f3efe6";
        ctx.beginPath();
        ctx.ellipse(cx, h / 2, w * 0.07, h * 0.15, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#111";
        ctx.font = `bold ${Math.round(h * 0.2)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(num), cx, h / 2 + 1);
      }
    }
  });
}

/* ---------- planets ---------- */

export function earthTexture() {
  return canvasTexture("earth", 512, 256, (ctx, w, h) => {
    const ocean: [number, number, number] = [22, 74, 150];
    const deep: [number, number, number] = [12, 42, 104];
    const green: [number, number, number] = [58, 120, 52];
    const desert: [number, number, number] = [176, 150, 96];
    paintSphere(ctx, w, h, (x, y, z, lat) => {
      const n = fbm3(x * 1.7 + 3, y * 1.7, z * 1.7, 42, 5);
      const cloud = fbm3(x * 3 + 9, y * 3.6, z * 3, 77, 4);
      let col: [number, number, number];
      if (n > 0.53) {
        const dry = fbm3(x * 4, y * 4, z * 4, 9, 3);
        col = mixRGB(green, desert, (dry - 0.45) * 3 + (Math.abs(lat) < 0.45 ? 0.3 : -0.2));
      } else col = mixRGB(deep, ocean, (n - 0.3) * 4);
      if (Math.abs(lat) > 1.2) col = mixRGB(col, [240, 245, 250], (Math.abs(lat) - 1.2) * 6);
      if (cloud > 0.58) col = mixRGB(col, [250, 250, 252], (cloud - 0.58) * 4);
      return col;
    });
  });
}

export function marsTexture() {
  return canvasTexture("mars", 512, 256, (ctx, w, h) => {
    paintSphere(ctx, w, h, (x, y, z, lat) => {
      const n = fbm3(x * 2.2, y * 2.2, z * 2.2, 13, 5);
      let col = mixRGB([120, 48, 26], [206, 104, 58], n * 1.6 - 0.2);
      if (Math.abs(lat) > 1.3) col = mixRGB(col, [236, 226, 220], (Math.abs(lat) - 1.3) * 7);
      return col;
    });
  });
}

export function rockyTexture(seed = 31, tint: [number, number, number] = [150, 146, 140]) {
  return canvasTexture(`rocky-${seed}`, 512, 256, (ctx, w, h) => {
    paintSphere(ctx, w, h, (x, y, z) => {
      const n = fbm3(x * 3, y * 3, z * 3, seed, 5);
      const crater = fbm3(x * 9, y * 9, z * 9, seed + 5, 2);
      const k = 0.55 + n * 0.7 - (crater > 0.66 ? 0.25 : 0);
      return [tint[0] * k, tint[1] * k, tint[2] * k];
    });
  });
}

export function sunTexture() {
  return canvasTexture("sun", 256, 128, (ctx, w, h) => {
    paintSphere(ctx, w, h, (x, y, z) => {
      const n = fbm3(x * 6, y * 6, z * 6, 3, 4);
      return mixRGB([255, 140, 30], [255, 236, 150], n * 1.5 - 0.1);
    });
  });
}

/* ---------- signs and text ---------- */

/** Text drawn on a transparent canvas — for battery "+", magnet "N/S", weight "5 кг", etc. */
export function textTexture(text: string, options: { color?: string; background?: string; font?: string; width?: number; height?: number } = {}) {
  const { color = "#ffffff", background = "transparent", font = "bold 72px sans-serif", width = 128, height = 128 } = options;
  return canvasTexture(`text-${text}-${color}-${background}-${font}-${width}x${height}`, width, height, (ctx, w, h) => {
    if (background !== "transparent") {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.fillStyle = color;
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w / 2, h / 2 + 2);
  });
}

/** Round badge with a sign, used on charges ("+", "−") and particles ("e⁻", "p⁺"). */
export function badgeTexture(text: string, fill: string, ink = "#ffffff") {
  return canvasTexture(`badge-${text}-${fill}-${ink}`, 128, 128, (ctx, w, h) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.font = `bold ${text.length > 1 ? 54 : 78}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w / 2, h / 2 + 4);
  });
}
