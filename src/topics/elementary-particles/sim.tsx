import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useControls } from "leva";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { PhysicsTicker } from "@/components/sim/PhysicsTicker";
import { TransportControls } from "@/components/sim/TransportControls";
import { SimShell } from "@/components/sim/SimShell";
import { NumberReadouts } from "@/components/sim/NumberReadouts";
import { Histogram } from "@/components/sim/Histogram";
import { SceneLabel } from "@/components/sim/SceneLabel";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { Ground } from "@/components/sim/props/environment";
import { badgeTexture, canvasTexture } from "@/components/sim/props/textures";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

/* ================= the Standard Model ================= */
type Category = "quark" | "lepton" | "boson" | "higgs";
interface ParticleDef {
  name: string;
  symbol: string;
  short: string;
  massMeV: number;
  /** the mass is only an upper limit */
  upper?: boolean;
  charge: string;
  category: Category;
  col: number;
  row: number;
  where: string;
}

const PARTICLES: ParticleDef[] = [
  { name: "u (верхний)", symbol: "u", short: "верхний", massMeV: 2.16, charge: "+2/3", category: "quark", col: 0, row: 0, where: "Два кварка u и один d — это протон. Значит, u есть в каждом атоме водорода: в воде, в вашем теле, в Солнце." },
  { name: "d (нижний)", symbol: "d", short: "нижний", massMeV: 4.7, charge: "−1/3", category: "quark", col: 0, row: 1, where: "Нейтрон = u + d + d. Вместе с протонами нейтроны собраны в ядра всех атомов вокруг вас." },
  { name: "c (очарованный)", symbol: "c", short: "очарованный", massMeV: 1273, charge: "+2/3", category: "quark", col: 1, row: 0, where: "Живёт триллионные доли секунды. Рождается в ускорителях и при ударах космических лучей об атмосферу." },
  { name: "s (странный)", symbol: "s", short: "странный", massMeV: 93.5, charge: "−1/3", category: "quark", col: 1, row: 1, where: "Входит в «странные» частицы — каоны. Их рождают космические лучи высоко в атмосфере." },
  { name: "t (истинный)", symbol: "t", short: "истинный", massMeV: 172570, charge: "+2/3", category: "quark", col: 2, row: 0, where: "Самая тяжёлая частица — весит почти как целый атом золота. Открыт в 1995 году, живёт 5·10⁻²⁵ с." },
  { name: "b (прелестный)", symbol: "b", short: "прелестный", massMeV: 4183, charge: "−1/3", category: "quark", col: 2, row: 1, where: "Рождается на коллайдерах. По распадам b-кварков выясняют, почему во Вселенной вещества больше, чем антивещества." },
  { name: "e (электрон)", symbol: "e", short: "электрон", massMeV: 0.511, charge: "−1", category: "lepton", col: 0, row: 2, where: "Ток в проводах, молния, искра от свитера — это движение электронов. Они же образуют оболочки всех атомов." },
  { name: "μ (мюон)", symbol: "μ", short: "мюон", massMeV: 105.66, charge: "−1", category: "lepton", col: 1, row: 2, where: "Рождается в атмосфере от космических лучей: сквозь вашу ладонь пролетает примерно один мюон в секунду." },
  { name: "τ (тау)", symbol: "τ", short: "тау", massMeV: 1776.9, charge: "−1", category: "lepton", col: 2, row: 2, where: "Тяжёлый «брат» электрона: живёт 3·10⁻¹³ с. Открыт в 1975 году." },
  { name: "νe (эл. нейтрино)", symbol: "νe", short: "э-нейтрино", massMeV: 4.5e-7, upper: true, charge: "0", category: "lepton", col: 0, row: 3, where: "Солнце испускает их в термоядерных реакциях: сквозь каждый квадратный сантиметр вашего тела пролетает 65 млрд нейтрино в секунду — и почти ни одно не задерживается." },
  { name: "νμ (мюонное нейтрино)", symbol: "νμ", short: "μ-нейтрино", massMeV: 4.5e-7, upper: true, charge: "0", category: "lepton", col: 1, row: 3, where: "Рождается при распадах в атмосфере. Нейтрино умеют превращаться друг в друга на лету — за это открытие дали Нобелевскую премию 2015 года." },
  { name: "ντ (тау-нейтрино)", symbol: "ντ", short: "τ-нейтрино", massMeV: 4.5e-7, upper: true, charge: "0", category: "lepton", col: 2, row: 3, where: "Последний открытый лептон: его следы впервые увидели в 2000 году." },
  { name: "g (глюон)", symbol: "g", short: "глюон", massMeV: 0, charge: "0", category: "boson", col: 3, row: 0, where: "Склеивает кварки внутри протона так крепко, что вырвать кварк поодиночке невозможно." },
  { name: "γ (фотон)", symbol: "γ", short: "фотон", massMeV: 0, charge: "0", category: "boson", col: 3, row: 1, where: "Свет лампы, радиоволны, рентген, тепло от батареи — всё это фотоны, переносчики электромагнитной силы." },
  { name: "Z", symbol: "Z", short: "Z-бозон", massMeV: 91188, charge: "0", category: "boson", col: 3, row: 2, where: "Нейтральный переносчик слабой силы. Открыт в 1983 году в ЦЕРНе вместе с W." },
  { name: "W", symbol: "W", short: "W-бозон", massMeV: 80369, charge: "±1", category: "boson", col: 3, row: 3, where: "Переносит слабую силу: из-за W идёт β-распад и горит Солнце — в нём протон превращается в нейтрон." },
  { name: "H (Хиггс)", symbol: "H", short: "Хиггс", massMeV: 125200, charge: "0", category: "higgs", col: 4, row: 1.5, where: "Открыт в 2012 году на Большом адронном коллайдере. Поле Хиггса придаёт массу W, Z, кваркам и электрону." },
];

const CAT_BG: Record<Category, string> = { quark: "#7c3aed", lepton: "#059669", boson: "#dc2626", higgs: "#ca8a04" };
const CAT_NAME: Record<Category, string> = { quark: "кварк", lepton: "лептон", boson: "переносчик силы", higgs: "бозон Хиггса" };
const M_E = 0.511;

function fmtMass(p: ParticleDef) {
  if (p.upper) return "< 0,45 эВ";
  if (p.massMeV === 0) return "0";
  if (p.massMeV >= 1000) return `${(p.massMeV / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} ГэВ`;
  if (p.massMeV >= 1) return `${p.massMeV.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МэВ`;
  return `${(p.massMeV * 1000).toLocaleString("ru-RU", { maximumFractionDigits: 0 })} кэВ`;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function tileTexture(p: ParticleDef) {
  return canvasTexture(`sm-tile-${p.symbol}`, 256, 256, (ctx, w, h) => {
    ctx.fillStyle = CAT_BG[p.category];
    roundRectPath(ctx, 6, 6, w - 12, h - 12, 26);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 100px sans-serif";
    ctx.fillText(p.symbol, w / 2, h * 0.5);
    ctx.font = "26px sans-serif";
    ctx.fillText(p.short, w / 2, h * 0.82);
    ctx.font = "22px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(fmtMass(p), 22, 36);
    ctx.textAlign = "right";
    ctx.fillText(p.charge, w - 22, 36);
  });
}

const tilePos = (p: ParticleDef): [number, number] => [(p.col - 1.6) * 1.08 + (p.col === 4 ? 0.15 : 0), (1.5 - p.row) * 1.08];

function SceneTable({ selected }: { selected: string }) {
  const tiles = useRef<(THREE.Group | null)[]>([]);
  useFrame((_, dt) => {
    PARTICLES.forEach((p, i) => {
      const g = tiles.current[i];
      if (!g) return;
      const on = p.name === selected;
      const k = Math.min(1, dt * 8);
      g.position.z += ((on ? 0.5 : 0) - g.position.z) * k;
      const s = g.scale.x + ((on ? 1.2 : 1) - g.scale.x) * k;
      g.scale.setScalar(s);
    });
  });
  return (
    <>
      {PARTICLES.map((p, i) => {
        const [x, y] = tilePos(p);
        const on = p.name === selected;
        return (
          <group key={p.name} position={[x, y, 0]} ref={(el) => void (tiles.current[i] = el)}>
            <mesh position={[0, 0, -0.04]}>
              <boxGeometry args={[0.96, 0.96, 0.06]} />
              <meshStandardMaterial color="#18181b" roughness={0.6} />
            </mesh>
            <mesh>
              <planeGeometry args={[0.94, 0.94]} />
              <meshBasicMaterial map={tileTexture(p)} color={on ? "#ffffff" : "#a1a1aa"} toneMapped={false} transparent />
            </mesh>
          </group>
        );
      })}
      <SceneLabel position={[-2.75, 1.08, 0]}>кварки</SceneLabel>
      <SceneLabel position={[-2.75, -1.08, 0]}>лептоны</SceneLabel>
      <SceneLabel position={[1.51, 2.35, 0]}>переносчики сил</SceneLabel>
      <SceneLabel position={[2.9, 0.85, 0]}>Хиггс</SceneLabel>
    </>
  );
}

/* ================= protons, neutrons and their quarks ================= */
type QuarkKind = "u" | "d";
const QUARK_FILL: Record<QuarkKind, string> = { u: "#f97316", d: "#16a34a" };
const QUARK_BASE: [number, number][] = [
  [0, 0.42],
  [-0.36, -0.21],
  [0.36, -0.21],
];
const SPRING_N = 48;
const PAIRS: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 0],
];

/** three quarks held by gluon "springs" inside a hazy ball */
function Hadron({ kinds, running, cloud = 0.9 }: { kinds: QuarkKind[]; running: boolean; cloud?: number }) {
  const sprites = useRef<(THREE.Sprite | null)[]>([]);
  const time = useRef(0);
  const springs = useMemo(
    () =>
      PAIRS.map(() => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SPRING_N * 3), 3));
        return new THREE.Line(geo, new THREE.LineBasicMaterial({ color: "#facc15", transparent: true, opacity: 0.9 }));
      }),
    [],
  );
  useEffect(
    () => () =>
      springs.forEach((l) => {
        l.geometry.dispose();
        (l.material as THREE.Material).dispose();
      }),
    [springs],
  );
  useFrame((_, dt) => {
    if (running) time.current += dt;
    const tt = time.current;
    const pos = QUARK_BASE.map(([x, y], i) => [x + 0.05 * Math.sin(tt * 3.1 + i * 2.1), y + 0.05 * Math.cos(tt * 2.7 + i * 1.3), 0.05 * Math.sin(tt * 2.3 + i)]);
    pos.forEach((p, i) => sprites.current[i]?.position.set(p[0], p[1], p[2]));
    PAIRS.forEach(([a, b], k) => {
      const attr = springs[k].geometry.getAttribute("position") as THREE.BufferAttribute;
      const A = pos[a];
      const B = pos[b];
      const dx = B[0] - A[0];
      const dy = B[1] - A[1];
      const len = Math.hypot(dx, dy) || 1;
      for (let i = 0; i < SPRING_N; i++) {
        const s = i / (SPRING_N - 1);
        const w = Math.sin(s * Math.PI * 12 + tt * 8) * 0.035 * Math.sin(s * Math.PI);
        attr.setXYZ(i, A[0] + dx * s - (dy / len) * w, A[1] + dy * s + (dx / len) * w, A[2] + (B[2] - A[2]) * s);
      }
      attr.needsUpdate = true;
    });
  });
  return (
    <group>
      <mesh>
        <sphereGeometry args={[cloud, 32, 24]} />
        <meshStandardMaterial color="#e2e8f0" transparent opacity={0.13} depthWrite={false} roughness={0.4} />
      </mesh>
      {springs.map((l, i) => (
        <primitive key={i} object={l} />
      ))}
      {kinds.map((k, i) => (
        <sprite key={i} ref={(el) => void (sprites.current[i] = el)} scale={[0.32, 0.32, 1]}>
          <spriteMaterial map={badgeTexture(k, QUARK_FILL[k])} />
        </sprite>
      ))}
    </group>
  );
}

/* ================= 1. The matryoshka of matter ================= */
interface Level {
  name: string;
  short: string;
  size: number;
  sizeText: string;
  made: string;
  ratio: string;
  caption: string;
}
const LEVELS: Level[] = [
  {
    name: "Капля воды",
    short: "капля",
    size: 2e-3,
    sizeText: "2 мм",
    made: "≈ 1,4·10²⁰ молекул воды",
    ratio: "—",
    caption: "Обычная капля воды на листе. В ней около 1,4·10²⁰ молекул — в 17 миллиардов раз больше, чем людей на Земле. Двигайте «Увеличение», чтобы заглянуть внутрь.",
  },
  {
    name: "Молекула воды H₂O",
    short: "молекула",
    size: 2.8e-10,
    sizeText: "0,28 нм",
    made: "атом кислорода + 2 атома водорода",
    ratio: "в 7 млн раз",
    caption: "Молекула воды: атом кислорода и два атома водорода под углом 104,5°. Если каплю раздуть до размеров Земли, одна молекула станет ростом с человека.",
  },
  {
    name: "Атом кислорода",
    short: "атом",
    size: 1.5e-10,
    sizeText: "≈ 0,15 нм",
    made: "ядро + 8 электронов",
    ratio: "≈ в 2 раза",
    caption: "Атом почти пустой: в центре крошечное ядро, вокруг — облако из 8 электронов. Если атом увеличить до футбольного стадиона, ядро будет горошиной в центре поля.",
  },
  {
    name: "Ядро кислорода-16",
    short: "ядро",
    size: 6e-15,
    sizeText: "6 фм",
    made: "8 протонов + 8 нейтронов",
    ratio: "в 25 000 раз",
    caption: "Ядро кислорода: 8 протонов и 8 нейтронов, сжатых ядерными силами. В нём 99,97 % массы атома, хотя по размеру оно в 25 000 раз меньше атома.",
  },
  {
    name: "Протон",
    short: "протон",
    size: 1.7e-15,
    sizeText: "1,7 фм",
    made: "кварки u, u, d + глюоны",
    ratio: "≈ в 3,5 раза",
    caption: "Протон: три кварка (u, u, d), склеенные глюонами. Вытащить кварк нельзя: чем дальше тянешь, тем сильнее тянет «пружина», а энергия разрыва рождает новые кварки.",
  },
  {
    name: "Кварк",
    short: "кварк",
    size: 1e-18,
    sizeText: "< 0,001 фм",
    made: "внутреннего строения не найдено",
    ratio: "более чем в 1000 раз",
    caption: "Кварк, по нынешним данным, — точка: размер меньше 10⁻¹⁸ м, внутреннего строения не нашли. Кварки и электроны — настоящие «кирпичики» вещества.",
  },
];
const SUP: Record<string, string> = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
function sci(x: number) {
  const e = Math.floor(Math.log10(x) + 1e-9);
  const m = (x / 10 ** e).toFixed(1).replace(".0", "").replace(".", ",");
  const es = String(e)
    .split("")
    .map((c) => SUP[c])
    .join("");
  return `${m === "1" ? "" : `${m}·`}10${es} м`;
}
const SIZE_DATA = LEVELS.map((l) => ({ name: l.short, v: Number((-Math.log10(l.size)).toFixed(1)) }));

/** fades and scales a level as the zoom passes through it */
function ZoomLayer({ index, shown, children }: { index: number; shown: RefObject<number>; children: ReactNode }) {
  const g = useRef<THREE.Group>(null!);
  useFrame(() => {
    const grp = g.current;
    if (!grp) return;
    const d = shown.current - index;
    grp.visible = d > -1 && d < 1;
    if (!grp.visible) return;
    grp.scale.setScalar(Math.pow(6, d));
    const op = THREE.MathUtils.clamp(1 - Math.abs(d) * 1.25, 0, 1);
    grp.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m || Array.isArray(m)) return;
      if (m.userData.base === undefined) {
        m.userData.base = m.opacity;
        m.transparent = true;
      }
      const base = m.userData.base as number;
      m.opacity = base * op;
      m.depthWrite = base >= 1 && op > 0.98;
    });
  });
  return <group ref={g}>{children}</group>;
}

function DropModel() {
  return (
    <group>
      <mesh position={[0, -0.25, 0]} scale={[1, 0.72, 1]} castShadow>
        <sphereGeometry args={[1.1, 48, 32]} />
        <meshStandardMaterial color="#7dd3fc" transparent opacity={0.6} roughness={0.05} metalness={0.2} emissive="#0c4a6e" emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[-0.38, 0.2, 0.72]}>
        <sphereGeometry args={[0.11, 16, 12]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.85} />
      </mesh>
      <mesh position={[0, -1.06, 0]} scale={[2.7, 0.05, 1.6]} receiveShadow>
        <sphereGeometry args={[1, 40, 16]} />
        <meshStandardMaterial color="#16a34a" roughness={0.55} />
      </mesh>
      <mesh position={[0, -1.0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.018, 0.018, 4.8, 6]} />
        <meshStandardMaterial color="#86efac" roughness={0.6} />
      </mesh>
    </group>
  );
}

function MoleculeModel() {
  const a = (104.5 / 2) * (Math.PI / 180);
  return (
    <group position={[0, 0.15, 0]}>
      <mesh castShadow>
        <sphereGeometry args={[0.62, 32, 24]} />
        <meshStandardMaterial color="#ef4444" roughness={0.35} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * Math.sin(a) * 0.78, -Math.cos(a) * 0.78, 0]} castShadow>
          <sphereGeometry args={[0.4, 24, 16]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.35} />
        </mesh>
      ))}
    </group>
  );
}

function AtomModel({ running }: { running: boolean }) {
  const els = useRef<THREE.Group>(null!);
  const time = useRef(0);
  const orbits = useMemo(
    () =>
      Array.from({ length: 8 }, (_, i) => ({
        r: i < 2 ? 0.3 : 0.72 + (i % 3) * 0.12,
        q: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, 0)),
        w: i < 2 ? 2.6 : 1.1 + Math.random() * 0.5,
        ph: Math.random() * Math.PI * 2,
      })),
    [],
  );
  useFrame((_, dt) => {
    if (running) time.current += dt;
    const g = els.current;
    if (!g) return;
    orbits.forEach((o, i) => {
      const ch = g.children[i];
      if (!ch) return;
      const a = o.ph + o.w * time.current;
      ch.position.set(o.r * Math.cos(a), o.r * Math.sin(a), 0).applyQuaternion(o.q);
    });
  });
  return (
    <group>
      <mesh>
        <sphereGeometry args={[0.05, 16, 12]} />
        <meshBasicMaterial color="#fb923c" toneMapped={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.36, 32, 24]} />
        <meshStandardMaterial color="#38bdf8" transparent opacity={0.22} depthWrite={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[1.05, 40, 28]} />
        <meshStandardMaterial color="#38bdf8" transparent opacity={0.1} depthWrite={false} />
      </mesh>
      <group ref={els}>
        {orbits.map((_, i) => (
          <mesh key={i}>
            <sphereGeometry args={[0.045, 12, 8]} />
            <meshBasicMaterial color="#7dd3fc" toneMapped={false} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

const PHI = (1 + Math.sqrt(5)) / 2;
/** 4 inner + 12 outer nucleons; every other one is a proton → 8 p + 8 n */
const O16 = (() => {
  const inner = [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ].map((v) => new THREE.Vector3(...(v as [number, number, number])).setLength(0.28));
  const outer = [
    [0, 1, PHI],
    [0, -1, PHI],
    [0, 1, -PHI],
    [0, -1, -PHI],
    [1, PHI, 0],
    [-1, PHI, 0],
    [1, -PHI, 0],
    [-1, -PHI, 0],
    [PHI, 0, 1],
    [-PHI, 0, 1],
    [PHI, 0, -1],
    [-PHI, 0, -1],
  ].map((v) => new THREE.Vector3(...(v as [number, number, number])).setLength(0.64));
  return [...inner, ...outer].map((p, i) => ({ p, proton: i % 2 === 0 }));
})();

function NucleusModel() {
  return (
    <group>
      {O16.map(({ p, proton }, i) => (
        <mesh key={i} position={p} castShadow>
          <sphereGeometry args={[0.31, 20, 16]} />
          <meshStandardMaterial color={proton ? "#ef4444" : "#94a3b8"} roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

function QuarkModel() {
  return (
    <group>
      <mesh>
        <sphereGeometry args={[0.06, 16, 12]} />
        <meshBasicMaterial color="#fdba74" toneMapped={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.32, 24, 16]} />
        <meshBasicMaterial color="#f97316" transparent opacity={0.15} depthWrite={false} />
      </mesh>
    </group>
  );
}

const UUD: QuarkKind[] = ["u", "u", "d"];
const UDD: QuarkKind[] = ["u", "d", "d"];
const UDU: QuarkKind[] = ["u", "d", "u"];

function SceneZoom({ level, running }: { level: number; running: boolean }) {
  const shown = useRef(level);
  useFrame((_, dt) => {
    const diff = level - shown.current;
    shown.current += Math.sign(diff) * Math.min(Math.abs(diff), dt * 1.3);
  });
  return (
    <>
      <ZoomLayer index={0} shown={shown}>
        <DropModel />
      </ZoomLayer>
      <ZoomLayer index={1} shown={shown}>
        <MoleculeModel />
      </ZoomLayer>
      <ZoomLayer index={2} shown={shown}>
        <AtomModel running={running} />
      </ZoomLayer>
      <ZoomLayer index={3} shown={shown}>
        <NucleusModel />
      </ZoomLayer>
      <ZoomLayer index={4} shown={shown}>
        <Hadron kinds={UUD} running={running} cloud={1.0} />
      </ZoomLayer>
      <ZoomLayer index={5} shown={shown}>
        <QuarkModel />
      </ZoomLayer>
      {level === 0 && <SceneLabel position={[0, 0.85, 0]}>капля воды на листе</SceneLabel>}
      {level === 1 && (
        <>
          <SceneLabel position={[0, 1.05, 0]}>O — кислород</SceneLabel>
          <SceneLabel position={[1.05, -0.75, 0]}>H — водород</SceneLabel>
        </>
      )}
      {level === 2 && (
        <>
          <SceneLabel position={[0, 1.35, 0]}>облако из 8 электронов</SceneLabel>
          <SceneLabel position={[0.9, -0.25, 0.6]}>ядро — в 25 000 раз меньше атома</SceneLabel>
        </>
      )}
      {level === 3 && <SceneLabel position={[0, 1.25, 0]}>8 протонов (красные) + 8 нейтронов (серые)</SceneLabel>}
      {level === 4 && <SceneLabel position={[0, -1.25, 0]}>жёлтые «пружинки» — глюоны</SceneLabel>}
      {level === 5 && <SceneLabel position={[0, 0.65, 0]}>размер меньше 10⁻¹⁸ м</SceneLabel>}
    </>
  );
}

/* ================= 2. Decay of a free neutron ================= */
type DecayPhase = "neutron" | "convert" | "wdecay" | "fly" | "detected";
const DECAY_CYCLE = 7.5;
const decayPhase = (tt: number): DecayPhase => (tt < 2 ? "neutron" : tt < 2.6 ? "convert" : tt < 3 ? "wdecay" : tt < 4.4 ? "fly" : "detected");
const HADRON_Y = 0.85;
const Q2 = new THREE.Vector3(0.36, HADRON_Y - 0.21, 0);
const WP = new THREE.Vector3(0.95, 0.45, 0.25);
const DET = new THREE.Vector3(2.45, 0.62, 0);
const NU_END = new THREE.Vector3(-7.5, 0.95, 0.3);
const M_N = 939.565;
const M_P = 938.272;
const Q_VALUE = M_N - M_P - M_E;

function SceneDecay({ running, speed, onPhase }: { running: boolean; speed: number; onPhase: (p: DecayPhase) => void }) {
  const [phase, setPhase] = useState<DecayPhase>("neutron");
  const last = useRef<DecayPhase>("neutron");
  const wRef = useRef<THREE.Sprite>(null!);
  const eRef = useRef<THREE.Sprite>(null!);
  const nuRef = useRef<THREE.Sprite>(null!);
  const sparkRef = useRef<THREE.Mesh>(null!);
  const tubeMat = useRef<THREE.MeshStandardMaterial>(null!);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  const handleFrame = useCallback(
    (t: number) => {
      const tt = t % DECAY_CYCLE;
      const ph = decayPhase(tt);
      if (ph !== last.current) {
        last.current = ph;
        setPhase(ph);
        onPhase(ph);
      }
      const w = wRef.current;
      if (w) {
        w.visible = ph === "convert" || ph === "wdecay";
        if (ph === "convert") {
          const u = (tt - 2) / 0.6;
          w.position.copy(tmp.copy(Q2).lerp(WP, u));
          w.scale.setScalar(0.08 + 0.3 * u);
        } else if (ph === "wdecay") {
          w.position.copy(WP);
          w.scale.setScalar(Math.max(0.38 * (1 - (tt - 2.6) / 0.4), 0.001));
        }
      }
      if (sparkRef.current) {
        sparkRef.current.visible = ph === "convert" && tt < 2.35;
        sparkRef.current.scale.setScalar(0.1 + (tt - 2) * 0.9);
      }
      const e = eRef.current;
      if (e) {
        e.visible = ph === "wdecay" || ph === "fly";
        e.position.copy(ph === "fly" ? tmp.copy(WP).lerp(DET, (tt - 3) / 1.4) : WP);
      }
      const nu = nuRef.current;
      if (nu) {
        nu.visible = tt >= 2.6;
        nu.position.copy(tt >= 3 ? tmp.copy(WP).lerp(NU_END, (tt - 3) / 4.5) : WP);
      }
      // the counter clicks when the electron arrives
      if (tubeMat.current) tubeMat.current.emissiveIntensity = ph === "detected" ? 1.6 * Math.exp(-(tt - 4.4) * 4) : 0;
    },
    [onPhase, tmp],
  );

  const converted = phase !== "neutron";
  return (
    <>
      <PhysicsTicker running={running} speed={speed} onFrame={handleFrame} />
      <Ground kind="tiles" from={-8} to={8} width={10} tile={2} y={-0.3} />

      <group position={[0, HADRON_Y, 0]}>
        <Hadron kinds={converted ? UDU : UDD} running={running} />
      </group>
      <SceneLabel position={[0, HADRON_Y + 1.15, 0]}>{converted ? "протон (u u d), заряд +1" : "нейтрон (u d d), заряд 0"}</SceneLabel>
      <mesh ref={sparkRef} position={Q2} visible={false}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial color="#e9d5ff" toneMapped={false} transparent opacity={0.7} />
      </mesh>
      <sprite ref={wRef} visible={false}>
        <spriteMaterial map={badgeTexture("W⁻", "#7c3aed")} />
      </sprite>
      <sprite ref={eRef} visible={false} scale={[0.26, 0.26, 1]}>
        <spriteMaterial map={badgeTexture("e⁻", "#2563eb")} />
      </sprite>
      <sprite ref={nuRef} visible={false} scale={[0.24, 0.24, 1]}>
        <spriteMaterial map={badgeTexture("ν̄", "#64748b")} opacity={0.85} />
      </sprite>

      {/* Geiger counter catches the electron */}
      <mesh position={[2.6, -0.12, 0]} castShadow>
        <boxGeometry args={[0.8, 0.36, 0.55]} />
        <meshStandardMaterial color="#facc15" roughness={0.5} />
      </mesh>
      <mesh position={[2.6, 0.56, 0]} castShadow>
        <cylinderGeometry args={[0.17, 0.17, 1.0, 24]} />
        <meshStandardMaterial ref={tubeMat} color="#d4d4d8" metalness={0.8} roughness={0.25} emissive="#38bdf8" emissiveIntensity={0} />
      </mesh>
      <SceneLabel position={[2.6, 1.4, 0]}>{phase === "detected" ? "щёлк!" : "счётчик Гейгера"}</SceneLabel>

      {/* a lead block does not stop the antineutrino */}
      <mesh position={[-2.5, 0.6, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.7, 1.8, 1.8]} />
        <meshStandardMaterial color="#6b7280" metalness={0.45} roughness={0.55} />
      </mesh>
      <SceneLabel position={[-2.5, 1.85, 0]}>свинцовый блок</SceneLabel>
    </>
  );
}

const DECAY_NAMES: Record<DecayPhase, string> = {
  neutron: "нейтрон ждёт распада",
  convert: "кварк d → u + W⁻",
  wdecay: "W⁻ → e⁻ + ν̄",
  fly: "разлёт продуктов",
  detected: "электрон пойман счётчиком",
};

export function ElementaryParticlesSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, level, particleName } = useControls("Элементарные частицы", {
    scenario: {
      value: "zoom",
      label: "Жизненный пример",
      options: { "Матрёшка вещества: от капли до кварка": "zoom", "Распад нейтрона: кварк d становится u": "decay", "Таблица частиц: где мы их встречаем": "table" },
    },
    level: { value: 0, min: 0, max: 5, step: 1, label: "Увеличение (уровень)", render: (get) => get("Элементарные частицы.scenario") === "zoom" },
    particleName: { value: "u (верхний)", options: PARTICLES.map((p) => p.name), label: "Частица", render: (get) => get("Элементарные частицы.scenario") === "table" },
  });
  const particle = PARTICLES.find((p) => p.name === particleName) ?? PARTICLES[0];
  const lv = LEVELS[THREE.MathUtils.clamp(Math.round(level), 0, LEVELS.length - 1)];

  const [decay, setDecay] = useState<DecayPhase>("neutron");
  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    setDecay("neutron");
  }, [clock]);
  const lastScenario = useRef(scenario);
  useEffect(() => {
    if (lastScenario.current === scenario) return;
    lastScenario.current = scenario;
    handleReset();
  }, [scenario, handleReset]);

  const massChart = useMemo(() => PARTICLES.filter((p) => p.massMeV > 0).map((p) => ({ name: p.symbol, log10m: Number(Math.log10(p.massMeV).toFixed(2)) })), []);

  const caption =
    scenario === "zoom" ? (
      <>{lv.caption}</>
    ) : scenario === "decay" ? (
      decay === "neutron" ? (
        <>Свободный нейтрон: кварки u, d, d склеены глюонами (жёлтые «пружинки»). Вне ядра нейтрон живёт в среднем около 15 минут, а затем распадается.</>
      ) : decay === "convert" ? (
        <>
          <b>Слабое взаимодействие:</b> один кварк d превращается в u и испускает W⁻-бозон. Заряд сохраняется: −⅓ = +⅔ + (−1).
        </>
      ) : decay === "wdecay" ? (
        <>W⁻-бозон живёт всего 3·10⁻²⁵ с и распадается на электрон и антинейтрино.</>
      ) : (
        <>
          Нейтрон стал протоном. Электрон долетает до счётчика — <b>щёлк!</b> Антинейтрино почти не задевает вещество: оно пролетит сквозь свинец и всю Землю. Так идёт β-распад, например,
          углерода-14, по которому датируют находки археологов.
        </>
      )
    ) : (
      <>
        <b>{particle.name}</b> — {CAT_NAME[particle.category]}. {particle.where}
      </>
    );

  const legend: LegendItem[] =
    scenario === "zoom"
      ? [
          { color: "#ef4444", label: "кислород / протон", kind: "dot" },
          { color: "#f8fafc", label: "водород", kind: "dot" },
          { color: "#94a3b8", label: "нейтрон", kind: "dot" },
          { color: "#f97316", label: "кварк u", kind: "dot" },
          { color: "#16a34a", label: "кварк d", kind: "dot" },
          { color: "#facc15", label: "глюоны", kind: "line" },
        ]
      : scenario === "decay"
        ? [
            { color: "#f97316", label: "кварк u (+⅔)", kind: "dot" },
            { color: "#16a34a", label: "кварк d (−⅓)", kind: "dot" },
            { color: "#facc15", label: "глюоны", kind: "line" },
            { color: "#7c3aed", label: "W⁻-бозон", kind: "dot" },
            { color: "#2563eb", label: "электрон", kind: "dot" },
            { color: "#64748b", label: "антинейтрино", kind: "dot" },
          ]
        : [
            { color: CAT_BG.quark, label: "кварки", kind: "square" },
            { color: CAT_BG.lepton, label: "лептоны", kind: "square" },
            { color: CAT_BG.boson, label: "переносчики сил", kind: "square" },
            { color: CAT_BG.higgs, label: "бозон Хиггса", kind: "square" },
          ];

  const camera =
    scenario === "decay"
      ? { position: [0, 1.8, 8.2] as [number, number, number], fov: 50 }
      : scenario === "table"
        ? { position: [0.2, 0.2, 7.6] as [number, number, number], fov: 50 }
        : { position: [0, 0.7, 5.2] as [number, number, number], fov: 50 };
  const target: [number, number, number] = scenario === "decay" ? [0, 0.55, 0] : scenario === "table" ? [0.2, 0, 0] : [0, -0.05, 0];

  return (
    <SimShell
      scene={
        <SceneCanvas key={scenario} camera={camera} orbitTarget={target} simplified={isMobile} maxDistance={16} minDistance={2} bloomThreshold={0.85}>
          {scenario === "zoom" ? (
            <SceneZoom level={Math.round(level)} running={clock.running} />
          ) : scenario === "decay" ? (
            <SceneDecay key={clock.resetNonce} running={clock.running} speed={clock.speed} onPhase={setDecay} />
          ) : (
            <SceneTable selected={particle.name} />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={<TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />}
      numbers={
        scenario === "zoom" ? (
          <NumberReadouts
            items={[
              { label: "Что видим", value: lv.name },
              { label: "Размер", value: lv.sizeText },
              { label: "В метрах", value: lv.size < 1e-17 ? `< ${sci(lv.size)}` : sci(lv.size) },
              { label: "Меньше предыдущего", value: lv.ratio },
              { label: "Из чего состоит", value: lv.made },
            ]}
          />
        ) : scenario === "decay" ? (
          <NumberReadouts
            items={[
              { label: "Стадия", value: DECAY_NAMES[decay] },
              { label: "Масса нейтрона", value: M_N.toFixed(3), unit: "МэВ/c²" },
              { label: "Масса протона + электрона", value: (M_P + M_E).toFixed(3), unit: "МэВ/c²" },
              { label: "Выделяется энергии Q", value: Q_VALUE.toFixed(3), unit: "МэВ" },
              { label: "Среднее время жизни", value: "≈ 880 с (≈ 15 мин)" },
              { label: "Заряд до → после", value: "0 → (+1) + (−1) + 0" },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "Частица", value: particle.name },
              { label: "Масса", value: fmtMass(particle) },
              {
                label: "Тяжелее электрона в",
                value: particle.upper ? "в миллион раз легче" : particle.massMeV === 0 ? "массы нет" : `${(particle.massMeV / M_E).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} раз`,
              },
              { label: "Заряд", value: particle.charge, unit: "e" },
              { label: "Тип", value: CAT_NAME[particle.category] },
            ]}
          />
        )
      }
      graphs={
        scenario === "zoom" ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">Сколько нулей после запятой в размере (в метрах): каждый шаг — в 10 раз мельче</p>
            <Histogram data={SIZE_DATA} xKey="name" barKey="v" barColor="#38bdf8" xLabel="уровень" yLabel="−lg(размер, м)" />
          </div>
        ) : scenario === "decay" ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-3 text-xs text-muted-2">
            <p className="mb-2 font-medium">β-распад: n(udd) → p(uud) + e⁻ + ν̄e</p>
            <ul className="flex flex-col gap-1.5 font-mono">
              <li>m_n c² = {M_N.toFixed(3)} МэВ</li>
              <li>m_p c² = {M_P.toFixed(3)} МэВ</li>
              <li>m_e c² = {M_E.toFixed(3)} МэВ</li>
              <li className="text-[#4ade80]">Q = m_n c² − m_p c² − m_e c² = {Q_VALUE.toFixed(3)} МэВ — делят электрон и антинейтрино</li>
            </ul>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">lg(масса, МэВ): от нейтрино до топ-кварка — разброс в 17 порядков</p>
            <Histogram data={massChart} xKey="name" barKey="log10m" barColor="#a78bfa" xLabel="частица" yLabel="lg(m/МэВ)" />
          </div>
        )
      }
      note={
        scenario === "zoom" ? (
          <>
            Всё вещество вокруг — это вложенные «матрёшки»: молекулы из атомов, атомы из ядер и электронов, ядра из протонов и нейтронов, а те — из кварков. Электрон и кварки, насколько известно, ни из
            чего не состоят. Размеры атома задают электроны, а массу — ядро.
          </>
        ) : scenario === "decay" ? (
          <>
            Свободный нейтрон тяжелее протона с электроном на 0,78 МэВ, поэтому может распасться. Внутри устойчивых ядер распад запрещён энергетически, а в радиоактивных (например, углерод-14 или
            тритий) идёт тот же процесс d → u. Энергию делят электрон и антинейтрино, поэтому электроны β-распада вылетают с разной скоростью — именно так Паули в 1930 году догадался о нейтрино.
          </>
        ) : (
          <>
            Стандартная модель: 6 кварков, 6 лептонов, 4 переносчика сил и бозон Хиггса. Обычное вещество собрано всего из трёх частиц первого столбца — кварков u, d и электрона. Остальные рождаются в
            космических лучах и ускорителях и быстро распадаются. Масса нейтрино известна только сверху (опыт KATRIN: меньше 0,45 эВ). Гравитация в Стандартную модель не входит.
          </>
        )
      }
    />
  );
}
