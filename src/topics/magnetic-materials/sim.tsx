import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useControls } from "leva";
import * as THREE from "three";
import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { PhysicsTicker } from "@/components/sim/PhysicsTicker";
import { FieldArrow } from "@/components/sim/FieldArrow";
import { TransportControls } from "@/components/sim/TransportControls";
import { SimShell } from "@/components/sim/SimShell";
import { NumberReadouts } from "@/components/sim/NumberReadouts";
import { LiveChart } from "@/components/sim/LiveChart";
import { SceneLabel } from "@/components/sim/SceneLabel";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { BarMagnet, Coil } from "@/components/sim/props/electric";
import { LabBench, RetortStand } from "@/components/sim/props/environment";
import { Burner } from "@/components/sim/props/thermo";
import { badgeTexture } from "@/components/sim/props/textures";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const GRID = 6;
const SPACING = 0.55;
const N = GRID * GRID;

type Material = "ferro" | "para" | "dia";

const MATERIAL_INFO: Record<Material, { rate: number; maxAlign: number; sign: number; color: string; remanence: boolean; name: string }> = {
  ferro: { rate: 3.5, maxAlign: 1, sign: 1, color: "#9ca3af", remanence: true, name: "железо (ферромагнетик)" },
  para: { rate: 1.2, maxAlign: 0.5, sign: 1, color: "#e5e7eb", remanence: false, name: "алюминий (парамагнетик)" },
  dia: { rate: 1.2, maxAlign: 0.15, sign: -1, color: "#f0abfc", remanence: false, name: "висмут (диамагнетик)" },
};

interface SamplePoint {
  t: number;
  M: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  M: number;
}

interface DipolesProps {
  material: Material;
  B: number;
  running: boolean;
  speed: number;
  curieT?: number;
  curieTc?: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

/** A grid of atomic "micro-magnets" (red = N end, blue = S end) that turn toward the field. Grid centre at the origin. */
function Dipoles({ material, B, running, speed, curieT, curieTc, onSample, onLive }: DipolesProps) {
  const north = useRef<THREE.InstancedMesh>(null!);
  const south = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const halves = useMemo(() => {
    const n = new THREE.BoxGeometry(0.19, 0.07, 0.07);
    n.translate(0.095, 0, 0);
    const s = new THREE.BoxGeometry(0.19, 0.07, 0.07);
    s.translate(-0.095, 0, 0);
    return { n, s };
  }, []);
  useEffect(
    () => () => {
      halves.n.dispose();
      halves.s.dispose();
    },
    [halves],
  );
  const anglesRef = useRef<Float32Array>(
    (() => {
      const a = new Float32Array(N);
      for (let i = 0; i < N; i++) a[i] = Math.random() * Math.PI * 2;
      return a;
    })(),
  );
  const info = MATERIAL_INFO[material];
  const aboveCurie = curieTc !== undefined && curieT !== undefined && curieT >= curieTc;

  const handleFixedStep = useCallback(
    (dt: number) => {
      const angles = anglesRef.current;
      if (aboveCurie) {
        for (let i = 0; i < N; i++) angles[i] += (Math.random() - 0.5) * info.rate * 2 * dt;
        return;
      }
      const alignFrac = info.remanence ? (B > 0.01 ? info.maxAlign : null) : Math.min(B * info.maxAlign, info.maxAlign);
      for (let i = 0; i < N; i++) {
        if (alignFrac === null) continue; // ferro with B off: freeze (remanence)
        const targetAngle = info.sign > 0 ? 0 : Math.PI;
        const current = angles[i];
        let diff = targetAngle - current;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        angles[i] += diff * info.rate * alignFrac * dt;
      }
    },
    [B, info, aboveCurie],
  );

  const handleFrame = useCallback(() => {
    const angles = anglesRef.current;
    let idx = 0;
    for (let ix = 0; ix < GRID; ix++) {
      for (let iz = 0; iz < GRID; iz++) {
        const x = (ix - (GRID - 1) / 2) * SPACING;
        const z = (iz - (GRID - 1) / 2) * SPACING;
        dummy.position.set(x, 0, z);
        dummy.rotation.set(0, angles[idx], 0);
        dummy.updateMatrix();
        north.current?.setMatrixAt(idx, dummy.matrix);
        south.current?.setMatrixAt(idx, dummy.matrix);
        idx++;
      }
    }
    if (north.current) north.current.instanceMatrix.needsUpdate = true;
    if (south.current) south.current.instanceMatrix.needsUpdate = true;
  }, [dummy]);

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        onFixedStep={handleFixedStep}
        sampleHz={12}
        onSample={(t) => {
          const angles = anglesRef.current;
          let sum = 0;
          for (let i = 0; i < N; i++) sum += Math.cos(angles[i]);
          const M = sum / N;
          onSample({ t, M });
          onLive({ t, M });
        }}
      />
      <instancedMesh ref={north} args={[halves.n, undefined, N]} frustumCulled={false}>
        <meshStandardMaterial color="#dc2626" roughness={0.4} metalness={0.2} />
      </instancedMesh>
      <instancedMesh ref={south} args={[halves.s, undefined, N]} frustumCulled={false}>
        <meshStandardMaterial color="#2563eb" roughness={0.4} metalness={0.2} />
      </instancedMesh>
    </>
  );
}

const SAMPLE_HALF = (GRID * SPACING) / 2;

/** The sample is shown as a glass-like block, the dipoles inside are its atoms magnified. */
function SampleBlock({ color, y = 0.4 }: { color: string; y?: number }) {
  return (
    <>
      <mesh position={[0, y, 0]}>
        <boxGeometry args={[SAMPLE_HALF * 2, 0.4, SAMPLE_HALF * 2]} />
        <meshStandardMaterial color={color} transparent opacity={0.16} roughness={0.3} metalness={0.3} depthWrite={false} />
      </mesh>
      <lineSegments position={[0, y, 0]}>
        <edgesGeometry args={[new THREE.BoxGeometry(SAMPLE_HALF * 2, 0.4, SAMPLE_HALF * 2)]} />
        <lineBasicMaterial color={color} />
      </lineSegments>
    </>
  );
}

/* ---------- scenario 1: a sample between the poles of an electromagnet ---------- */
function SceneElectromagnet(props: DipolesProps) {
  const { B, material } = props;
  const nTex = useMemo(() => badgeTexture("N", "#dc2626"), []);
  const sTex = useMemo(() => badgeTexture("S", "#2563eb"), []);
  const info = MATERIAL_INFO[material];
  const POLE_X = SAMPLE_HALF + 0.55;
  return (
    <>
      <LabBench position={[0, -0.9, 0]} length={7} depth={4} height={0.9} />
      {/* U-shaped iron yoke with two coils; pole pieces face each other across the sample */}
      <mesh position={[0, 0.25, -2.1]} castShadow>
        <boxGeometry args={[2 * POLE_X + 0.9, 0.5, 0.5]} />
        <meshStandardMaterial color="#52525b" metalness={0.6} roughness={0.45} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[s * (POLE_X + 0.2), 0.25, -1.05]} castShadow>
            <boxGeometry args={[0.5, 0.5, 2.2]} />
            <meshStandardMaterial color="#52525b" metalness={0.6} roughness={0.45} />
          </mesh>
          <Coil position={[s * (POLE_X + 0.2), 0.25, -1.3]} rotation={[0, Math.PI / 2, 0]} turns={9} radius={0.36} length={0.9} wire={0.04} />
          <mesh position={[s * POLE_X, 0.4, 0]} castShadow>
            <boxGeometry args={[0.3, 0.8, 2.6]} />
            <meshStandardMaterial color={s < 0 ? "#b91c1c" : "#1d4ed8"} metalness={0.5} roughness={0.4} />
          </mesh>
          <sprite position={[s * POLE_X, 1.05, 0]} scale={0.35}>
            <spriteMaterial map={s < 0 ? nTex : sTex} depthTest={false} transparent />
          </sprite>
        </group>
      ))}
      <SceneLabel position={[0, 1.5, -2.1]}>электромагнит: катушки на железном сердечнике</SceneLabel>

      {B > 0.01 && [-1.1, 0, 1.1].map((z) => <FieldArrow key={z} origin={[-POLE_X + 0.2, 1.0, z]} vector={[2 * POLE_X - 0.4, 0, 0]} color="#fbbf24" opacity={0.75} />)}

      <SampleBlock color={info.color} />
      <group position={[0, 0.4, 0]}>
        <Dipoles {...props} />
      </group>
      <SceneLabel position={[0, 0.85, SAMPLE_HALF + 0.35]}>{`образец: ${info.name} — атомные «магнитики» (увеличено)`}</SceneLabel>
    </>
  );
}

/* ---------- scenario 2: a horseshoe magnet holding a chain of paper clips ---------- */
const N_CLIPS = 5;
const B_PER_CLIP = 0.35;
const CLIP_GAP = 0.36;
const MAGNET_TIP_Y = 2.35;
const G = 9.8;

function paperClipGeometry() {
  const raw: [number, number][] = [
    [0.024, 0.16],
    [0.024, 0.5],
    [0, 0.53],
    [-0.024, 0.5],
    [-0.024, 0.06],
    [0, 0.03],
    [0.044, 0.06],
    [0.044, 0.55],
    [0, 0.6],
    [-0.044, 0.55],
    [-0.044, 0.24],
  ];
  const curve = new THREE.CatmullRomCurve3(raw.map(([x, y]) => new THREE.Vector3(x, -y, 0)), false, "catmullrom", 0.3);
  return new THREE.TubeGeometry(curve, 80, 0.008, 6, false);
}

function SceneMagnetClips({ B, running, speed }: { B: number; running: boolean; speed: number }) {
  const nHeld = Math.min(N_CLIPS, Math.floor(B / B_PER_CLIP));
  const groupRefs = useRef<(THREE.Group | null)[]>([]);
  const releaseRef = useRef<(number | null)[]>(Array(N_CLIPS).fill(null));
  const wasHeldRef = useRef<boolean[]>(Array(N_CLIPS).fill(true));
  const clipGeo = useMemo(() => paperClipGeometry(), []);
  useEffect(() => () => clipGeo.dispose(), [clipGeo]);
  const horseshoeGeo = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 60; i++) {
      const u = i / 60;
      if (u < 0.3) pts.push(new THREE.Vector3(-0.3, (u / 0.3) * 0.55, 0));
      else if (u < 0.7) {
        const a = Math.PI - ((u - 0.3) / 0.4) * Math.PI;
        pts.push(new THREE.Vector3(0.3 * Math.cos(a), 0.55 + 0.3 * Math.sin(a), 0));
      } else pts.push(new THREE.Vector3(0.3, 0.55 - ((u - 0.7) / 0.3) * 0.55, 0));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 90, 0.11, 16, false);
  }, []);
  useEffect(() => () => horseshoeGeo.dispose(), [horseshoeGeo]);

  const handleFrame = useCallback(
    (t: number) => {
      for (let i = 0; i < N_CLIPS; i++) {
        const held = i < nHeld;
        if (!held && wasHeldRef.current[i] && releaseRef.current[i] === null) releaseRef.current[i] = t;
        if (held) releaseRef.current[i] = null;
        wasHeldRef.current[i] = held;
        const grp = groupRefs.current[i];
        if (!grp) continue;
        const baseY = MAGNET_TIP_Y - i * CLIP_GAP;
        if (releaseRef.current[i] === null) {
          grp.position.set(-0.3, baseY, 0);
          grp.rotation.set(0, 0, 0);
        } else {
          const dt = t - releaseRef.current[i]!;
          const y = baseY - 0.5 * G * dt * dt;
          if (y <= 0.03) {
            // lying on the table
            grp.position.set(-0.3 + (i - N_CLIPS / 2) * 0.16, 0.012, 0.2 + (i % 3) * 0.14);
            grp.rotation.set(-Math.PI / 2, 0, 0.4 * i);
          } else grp.position.set(-0.3, y, 0);
        }
      }
    },
    [nHeld],
  );

  return (
    <>
      <PhysicsTicker running={running} speed={speed} onFrame={handleFrame} />
      <LabBench position={[0, -0.9, 0]} length={4} depth={2.6} height={0.9} />
      <RetortStand position={[0.95, 0, -0.1]} height={3.3} armLength={1.25} />

      {/* horseshoe magnet hanging poles-down from the stand */}
      <group position={[0, MAGNET_TIP_Y + 0.02, 0]}>
        <mesh geometry={horseshoeGeo} castShadow>
          <meshStandardMaterial color="#dc2626" roughness={0.35} metalness={0.3} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.3, 0.02, 0]}>
            <cylinderGeometry args={[0.112, 0.112, 0.12, 16]} />
            <meshStandardMaterial color="#d4d4d8" metalness={0.9} roughness={0.2} />
          </mesh>
        ))}
      </group>
      <SceneLabel position={[0.6, MAGNET_TIP_Y + 1.15, 0]}>{`подковообразный магнит, B = ${B.toFixed(2).replace(".", ",")} Тл`}</SceneLabel>

      {Array.from({ length: N_CLIPS }).map((_, i) => (
        <group
          key={i}
          ref={(el) => {
            groupRefs.current[i] = el;
          }}
          position={[-0.3, MAGNET_TIP_Y - i * CLIP_GAP, 0]}
        >
          <mesh geometry={clipGeo} castShadow>
            <meshStandardMaterial color="#cbd5e1" metalness={0.9} roughness={0.25} />
          </mesh>
        </group>
      ))}
      <SceneLabel position={[-1.2, 1.5, 0]}>{`держится скрепок: ${nHeld} из ${N_CLIPS}`}</SceneLabel>
    </>
  );
}

/* ---------- scenario 3: an iron nail on a magnet, heated by a burner (Curie point) ---------- */
const NAIL_TOP = 1.85;
const NAIL_LEN = 0.75;

function NailGlow({ temp, fallen }: { temp: number; fallen: boolean }) {
  // red heat starts at ~800 K (≈ 525 °C)
  const glow = THREE.MathUtils.clamp((temp - 800) / 500, 0, 1);
  const color = new THREE.Color("#71717a").lerp(new THREE.Color("#f97316"), glow);
  return (
    <group position={fallen ? [-0.2, 0.02, 0.45] : [-0.45, NAIL_TOP - NAIL_LEN / 2, 0]} rotation={fallen ? [0, 0.5, Math.PI / 2] : [0, 0, 0]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.05, 0.05, NAIL_LEN, 12]} />
        <meshStandardMaterial color={color} emissive="#f97316" emissiveIntensity={glow * 2.2} metalness={0.7} roughness={0.35} toneMapped={false} />
      </mesh>
      <mesh position={[0, NAIL_LEN / 2, 0]}>
        <cylinderGeometry args={[0.08, 0.08, 0.03, 16]} />
        <meshStandardMaterial color={color} emissive="#f97316" emissiveIntensity={glow * 2} metalness={0.7} roughness={0.35} toneMapped={false} />
      </mesh>
      <mesh position={[0, -NAIL_LEN / 2 - 0.05, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.05, 0.12, 12]} />
        <meshStandardMaterial color={color} emissive="#f97316" emissiveIntensity={glow * 2.2} metalness={0.7} roughness={0.35} toneMapped={false} />
      </mesh>
    </group>
  );
}

function SceneCurie(props: DipolesProps & { temp: number; Tc: number }) {
  const { temp, Tc } = props;
  const fallen = temp >= Tc;
  const power = THREE.MathUtils.clamp((temp - 300) / 900, 0, 1);
  return (
    <>
      <LabBench position={[0, -0.9, 0]} length={6} depth={2.8} height={0.9} />
      <RetortStand position={[-1.75, 0, -0.2]} height={2.25} armLength={0.95} />
      <BarMagnet position={[-0.75, NAIL_TOP + 0.13, 0]} length={1.0} thickness={0.24} />
      <SceneLabel position={[-0.9, NAIL_TOP + 0.6, 0]}>магнит</SceneLabel>
      <NailGlow temp={temp} fallen={fallen} />
      <SceneLabel position={[0.1, NAIL_TOP - 0.3, 0]}>{fallen ? "гвоздь упал — больше не магнитится" : "железный гвоздь держится"}</SceneLabel>
      {/* burner on a small stand under the nail */}
      <mesh position={[-0.45, 0.25, 0]} castShadow>
        <boxGeometry args={[0.6, 0.5, 0.6]} />
        <meshStandardMaterial color="#3f3f46" roughness={0.6} />
      </mesh>
      <Burner position={[-0.45, 0.5, 0]} power={power} />
      <SceneLabel position={[-1.15, 0.75, 0.4]}>{`горелка: ${Math.round(temp - 273)} °C`}</SceneLabel>

      {/* magnified view of the atoms inside the nail */}
      <group position={[1.45, 0.9, 0]} scale={0.4}>
        <SampleBlock color="#9ca3af" y={0} />
        <Dipoles {...props} />
      </group>
      <SceneLabel position={[1.45, 1.5, 0]}>внутри гвоздя (увеличено)</SceneLabel>
    </>
  );
}

export function MagneticMaterialsSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, material, B, Bclips, temp } = useControls("Магнитные материалы", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Образец между полюсами магнита": "abstract", "Магнит и скрепки": "clips", "Точка Кюри: нагретый гвоздь": "curie" },
    },
    material: { value: "ferro", options: { "Железо (ферромагнетик)": "ferro", "Алюминий (парамагнетик)": "para", "Висмут (диамагнетик)": "dia" }, label: "Материал", render: (get) => get("Магнитные материалы.scenario") === "abstract" },
    B: { value: 1, min: 0, max: 2, step: 0.05, label: "B внешнее, Тл", render: (get) => get("Магнитные материалы.scenario") === "abstract" },
    Bclips: { value: 1.2, min: 0, max: 2, step: 0.05, label: "B магнита, Тл", render: (get) => get("Магнитные материалы.scenario") === "clips" },
    temp: { value: 300, min: 250, max: 1400, step: 10, label: "Температура гвоздя, К", render: (get) => get("Магнитные материалы.scenario") === "curie" },
  });
  const isClips = scenario === "clips";
  const isCurie = scenario === "curie";
  const CURIE_TC = 1043; // iron: 770 °C

  const [live, setLive] = useState<LiveNumbers>({ t: 0, M: 0 });
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, M: 0 }]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 500 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);

  const resetState = useCallback(() => {
    setLive({ t: 0, M: 0 });
    setSeries([{ t: 0, M: 0 }]);
  }, []);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    resetState();
  }, [clock, resetState]);

  const dipoleProps = {
    running: clock.running,
    speed: clock.speed,
    onSample: handleSample,
    onLive: setLive,
  };
  const nHeld = Math.min(N_CLIPS, Math.floor(Bclips / B_PER_CLIP));
  const mat = material as Material;
  const fmt = (v: number, d = 2) => v.toFixed(d).replace(".", ",");

  const caption = isClips ? (
    <>
      Скрепки — мягкое железо. В поле магнита каждая сама становится маленьким магнитом и держит следующую: получается цепочка. Чем сильнее магнит, тем длиннее цепочка — сейчас держится{" "}
      <b>{nHeld}</b>. Ослабьте поле — нижние скрепки размагнитятся и упадут.
    </>
  ) : isCurie ? (
    temp >= CURIE_TC ? (
      <>
        Гвоздь нагрет выше <b>точки Кюри</b> (770 °C для железа): тепловое движение перемешало атомные «магнитики», намагниченность пропала — и магнит его <b>отпустил</b>. Остудите гвоздь — свойства
        вернутся.
      </>
    ) : (
      <>
        Магнит держит железный гвоздь: атомные «магнитики» внутри выстроены в одну сторону. Нагревайте гвоздь горелкой — при {CURIE_TC} К (770 °C) порядок разрушится. Сейчас {Math.round(temp - 273)} °C.
      </>
    )
  ) : B <= 0.01 ? (
    mat === "ferro" ? (
      <>
        Поле выключено, а у железа «магнитики» <b>так и остались</b> выстроенными — это остаточная намагниченность. Так делают постоянные магниты.
      </>
    ) : (
      <>Поле выключено — атомные «магнитики» снова разбросаны хаотично, намагниченность исчезла.</>
    )
  ) : mat === "ferro" ? (
    <>
      В железе атомные «магнитики» дружно поворачиваются <b>вдоль поля</b> (красным концом к S-полюсу) — намагниченность почти 100 %. Поэтому железо сильно притягивается к магниту. Выключите поле
      (B = 0) — порядок останется.
    </>
  ) : mat === "para" ? (
    <>
      В алюминии «магнитики» лишь <b>слегка</b> поворачиваются по полю, тепловое движение им мешает: M = {fmt(live.M)}. Алюминий притягивается к магниту, но так слабо, что в быту это незаметно.
    </>
  ) : (
    <>
      Висмут — <b>диамагнетик</b>: поле наводит в нём слабую намагниченность <b>против</b> поля, и образец выталкивается из магнита. Так можно даже подвесить в воздухе лягушку в очень сильном поле.
    </>
  );
  const legend: LegendItem[] = isClips
    ? [{ color: "#dc2626", label: "магнит", kind: "square" }]
    : [
        { color: "#dc2626", label: "северный конец «магнитика»", kind: "square" },
        { color: "#2563eb", label: "южный конец", kind: "square" },
        ...(isCurie ? [] : [{ color: "#fbbf24", label: "поле магнита B" } as LegendItem]),
      ];

  return (
    <SimShell
      scene={
        <SceneCanvas
          key={scenario}
          camera={isClips ? { position: [1.4, 2.0, 4.4] as [number, number, number], fov: 50 } : isCurie ? { position: [0.5, 2.4, 5.7] as [number, number, number], fov: 50 } : { position: [0, 4.0, 5.6] as [number, number, number], fov: 50 }}
          orbitTarget={isClips ? [0, 1.4, 0] : isCurie ? [0.35, 1.0, 0] : [0, 0.3, 0]}
          simplified={isMobile}
          maxDistance={16}
          minDistance={2.5}
          bloomThreshold={0.7}
          fogRange={[14, 40]}
        >
          {isClips ? (
            <SceneMagnetClips key={clock.resetNonce} B={Bclips} running={clock.running} speed={clock.speed} />
          ) : isCurie ? (
            <SceneCurie key={clock.resetNonce} material="ferro" B={1} curieT={temp} curieTc={CURIE_TC} temp={temp} Tc={CURIE_TC} {...dipoleProps} />
          ) : (
            <SceneElectromagnet key={clock.resetNonce} material={mat} B={B} {...dipoleProps} />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        isClips ? (
          <NumberReadouts
            items={[
              { label: "B магнита", value: Bclips.toFixed(2), unit: "Тл" },
              { label: "Скрепок держится", value: String(nHeld) },
            ]}
          />
        ) : isCurie ? (
          <NumberReadouts
            items={[
              { label: "Температура", value: temp.toFixed(0), unit: "К" },
              { label: "Точка Кюри (железо)", value: CURIE_TC.toFixed(0), unit: "К" },
              { label: "Намагниченность M", value: live.M.toFixed(3) },
              { label: "Состояние", value: temp >= CURIE_TC ? "выше T_Кюри — размагничен" : "ниже T_Кюри — ферромагнетик" },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "Время t", value: live.t.toFixed(2), unit: "с" },
              { label: "Намагниченность M (⟨cosθ⟩)", value: live.M.toFixed(3) },
              { label: "B внешнее", value: B.toFixed(2), unit: "Тл" },
            ]}
          />
        )
      }
      graphs={
        isClips ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            Магнит намагничивает первую скрепку, та — следующую и так далее по цепочке (магнитная индукция).
            Чем сильнее поле магнита, тем длиннее цепочка, которую можно удержать — уменьшите B, и лишние
            скрепки, переставшие быть намагниченными, падают под собственным весом.
          </div>
        ) : isCurie ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            Ниже точки Кюри тепловые колебания слабее магнитного взаимодействия соседних атомов, и их магнитные
            моменты выстраиваются в домены — материал ферромагнитен. Выше точки Кюри тепловое движение
            разрушает порядок, моменты ориентируются хаотично, и намагниченность исчезает — ферромагнетик
            становится парамагнетиком.
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">Намагниченность M(t)</p>
            <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "M", color: "#f87171", label: "M" }]} yDomain={[-1, 1]} />
          </div>
        )
      }
      note={
        isClips ? (
          <>
            Скрепки — мягкое железо: сами по себе они не намагничены, но во внешнем поле магнита каждая
            становится временным магнитом и способна удерживать следующую. Это то же выравнивание атомных
            магнитных моментов по полю, что и в модели с образцом, но на знакомом бытовом примере.
          </>
        ) : isCurie ? (
          <>
            Точка Кюри — температура, выше которой тепловое движение разрушает магнитный порядок. Для железа
            T_Кюри ≈ 1043 К (770 °C): раскалённый докрасна гвоздь магнит не удержит; остывший — снова
            притянется. У никеля точка Кюри 358 °C, у кобальта — 1115 °C.
          </>
        ) : (
          <>
            Ферромагнетик (железо) быстро и почти полностью выстраивает атомные магнитные моменты по полю и
            сохраняет намагниченность даже при B=0 (остаточный магнетизм, гистерезис). Парамагнетик (алюминий)
            слабо и частично ориентируется по полю и сразу теряет упорядоченность при B=0. Диамагнетик
            (висмут, медь, вода) слабо намагничивается ПРОТИВ поля и выталкивается из него. Установите B=0
            после насыщения, чтобы увидеть разницу.
          </>
        )
      }
    />
  );
}
