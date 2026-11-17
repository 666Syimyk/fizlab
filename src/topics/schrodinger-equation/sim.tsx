import { useCallback, useMemo, useRef, useState } from "react";
import { useControls } from "leva";
import * as THREE from "three";
import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { PhysicsTicker } from "@/components/sim/PhysicsTicker";
import { TransportControls } from "@/components/sim/TransportControls";
import { SimShell } from "@/components/sim/SimShell";
import { NumberReadouts } from "@/components/sim/NumberReadouts";
import { LiveChart } from "@/components/sim/LiveChart";
import { SceneLabel } from "@/components/sim/SceneLabel";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { LabBench } from "@/components/sim/props/environment";
import { wavelengthToColor } from "@/components/sim/props/shared";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const HBAR = 1.0546e-34;
const M_E = 9.109e-31;
const N_BARS = 40;
const VIS_PERIOD = 4;
const EV = 1.602e-19;
const N_TUNNEL_BARS = 46;

function tunnelT(V0eV: number, EeV: number, aNm: number) {
  const kappa = Math.sqrt(2 * M_E * (V0eV - EeV) * EV) / HBAR;
  const aM = aNm * 1e-9;
  const kappaA = kappa * aM;
  const sh = Math.sinh(kappaA);
  const T = 1 / (1 + (V0eV * V0eV * sh * sh) / (4 * EeV * (V0eV - EeV)));
  return { T, kappa };
}

function psi(n: number, x: number, L: number) {
  return Math.sqrt(2 / L) * Math.sin((n * Math.PI * x) / L);
}
function energy(n: number, L: number, m: number) {
  return (n * n * Math.PI * Math.PI * HBAR * HBAR) / (2 * m * L * L);
}

/** Colour of a photon with wavelength λ, invisible bands get conventional colours. */
function photonHex(nm: number) {
  if (!Number.isFinite(nm) || nm > 750) return "#7f1d1d";
  if (nm < 380) return "#a855f7";
  return wavelengthToColor(nm);
}

interface SamplePoint {
  t: number;
  peakX: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  E1: number;
  E2: number;
  dE: number;
  beatPeriod: number;
}

interface SceneContentProps {
  n1: number;
  n2: number;
  L: number;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

const VIAL_L_NM = [0.55, 0.6, 0.65, 0.7, 0.75, 0.82];
const BOX_Y = 1.6;

/* ---------- an electron in a box = a quantum dot; vials of quantum dots of different sizes ---------- */
function SceneContent({ n1, n2, L, running, speed, onSample, onLive }: SceneContentProps) {
  const barsRef = useRef<THREE.InstancedMesh>(null!);
  const photon = useRef<THREE.Mesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const E1 = energy(n1, L, M_E);
  const E2 = energy(n2, L, M_E);
  const dE = Math.abs(E2 - E1);
  const wVis = (2 * Math.PI) / VIS_PERIOD;
  const lambdaNm = dE > 0 ? 1240 / (dE / EV) : Infinity;
  const glow = photonHex(lambdaNm);
  const vials = useMemo(
    () =>
      VIAL_L_NM.map((Lnm) => {
        const d = (3 * Math.PI * Math.PI * HBAR * HBAR) / (2 * M_E * (Lnm * 1e-9) ** 2) / EV; // n = 2 → 1
        return { Lnm, hex: photonHex(1240 / d) };
      }),
    [],
  );
  const Lnm = L * 1e9;
  const nearest = VIAL_L_NM.reduce((best, v, i) => (Math.abs(v - Lnm) < Math.abs(VIAL_L_NM[best] - Lnm) ? i : best), 0);

  const handleFrame = useCallback(
    (t: number) => {
      const mesh = barsRef.current;
      if (mesh) {
        const c = 1 / Math.sqrt(2);
        for (let i = 0; i < N_BARS; i++) {
          const xN = i / (N_BARS - 1);
          const x = xN * L;
          const p1 = psi(n1, x, L);
          const p2 = psi(n2, x, L);
          const prob = c * c * p1 * p1 + c * c * p2 * p2 + 2 * c * c * p1 * p2 * Math.cos(wVis * t);
          const h = Math.max(prob * L * 0.6, 0.01);
          dummy.position.set(-2.3 + xN * 3.2, BOX_Y - 0.6 + h / 2, 0);
          dummy.scale.set(1, h, 1);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
      }
      // a photon of energy ΔE leaves the dot now and then
      if (photon.current) {
        const u = (t % 3) / 3;
        photon.current.visible = n1 !== n2;
        photon.current.position.set(-0.7 + u * 0.2, BOX_Y + 0.9 + u * 1.6, 0.4 + u * 1.2);
      }
    },
    [n1, n2, L, wVis, dummy],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={15}
        onSample={(t) => {
          const beatPeriod = dE > 0 ? (2 * Math.PI * HBAR) / dE : 0;
          onSample({ t, peakX: Math.cos(wVis * t) });
          onLive({ t, E1, E2, dE, beatPeriod });
        }}
      />
      <LabBench position={[0, -0.9, 0]} length={7.4} depth={2.6} height={0.9} />

      {/* the "box": two walls the electron cannot pass, the probability sloshes between them */}
      <group>
        {[-2.4, 1.0].map((x) => (
          <mesh key={x} position={[x, BOX_Y, 0]}>
            <boxGeometry args={[0.08, 1.5, 0.9]} />
            <meshStandardMaterial color="#64748b" metalness={0.6} roughness={0.4} />
          </mesh>
        ))}
        <mesh position={[-0.7, BOX_Y - 0.62, 0]}>
          <boxGeometry args={[3.5, 0.04, 0.9]} />
          <meshStandardMaterial color="#334155" />
        </mesh>
        <mesh position={[-0.7, (BOX_Y - 0.64) / 2, 0]}>
          <boxGeometry args={[0.15, BOX_Y - 0.64, 0.15]} />
          <meshStandardMaterial color="#334155" />
        </mesh>
        <SceneLabel position={[-0.7, BOX_Y + 1.0, 0]}>{`«яма» шириной L = ${Lnm.toFixed(1).replace(".", ",")} нм (увеличено)`}</SceneLabel>
      </group>
      <instancedMesh ref={barsRef} args={[undefined, undefined, N_BARS]} frustumCulled={false}>
        <boxGeometry args={[0.07, 1, 0.5]} />
        <meshBasicMaterial color="#a78bfa" toneMapped={false} transparent opacity={0.85} />
      </instancedMesh>
      <mesh ref={photon}>
        <sphereGeometry args={[0.08, 12, 10]} />
        <meshBasicMaterial color={glow} toneMapped={false} />
      </mesh>

      {/* vials with quantum dots of different sizes, glowing under a UV lamp */}
      <group position={[1.75, 0, 0.3]}>
        <mesh position={[0.6, 1.75, -0.2]}>
          <boxGeometry args={[2.6, 0.12, 0.3]} />
          <meshStandardMaterial color="#1f2937" />
        </mesh>
        <mesh position={[0.6, 1.68, -0.2]}>
          <boxGeometry args={[2.4, 0.03, 0.12]} />
          <meshBasicMaterial color="#c084fc" toneMapped={false} />
        </mesh>
        <SceneLabel position={[0.6, 2.05, -0.2]}>УФ-лампа</SceneLabel>
        {vials.map((v, i) => (
          <group key={v.Lnm} position={[-0.4 + i * 0.42, 0, 0]}>
            <mesh position={[0, 0.42, 0]}>
              <cylinderGeometry args={[0.13, 0.13, 0.84, 18, 1, true]} />
              <meshStandardMaterial color="#e0f2fe" transparent opacity={0.25} roughness={0.05} side={THREE.DoubleSide} depthWrite={false} />
            </mesh>
            <mesh position={[0, 0.3, 0]}>
              <cylinderGeometry args={[0.12, 0.12, 0.58, 18]} />
              <meshBasicMaterial color={v.hex} transparent opacity={i === nearest ? 0.95 : 0.45} toneMapped={false} />
            </mesh>
            <mesh position={[0, 0.88, 0]}>
              <cylinderGeometry args={[0.135, 0.135, 0.1, 18]} />
              <meshStandardMaterial color="#111827" />
            </mesh>
            {i === nearest && <SceneLabel position={[0, 1.2, 0.2]}>как наша яма</SceneLabel>}
          </group>
        ))}
        <SceneLabel position={[0.6, -0.15, 0.4]}>квантовые точки: меньше → голубее</SceneLabel>
      </group>
    </>
  );
}

/* ---------- tunnelling: the tip of a scanning tunnelling microscope ---------- */
const N_HOPS = 10;
const X_BEFORE = -1.6;
const X_AFTER = 1.6;

function SceneTunnel({ V0eV, EeV, aNm, running, speed }: { V0eV: number; EeV: number; aNm: number; running: boolean; speed: number }) {
  const barsRef = useRef<THREE.InstancedMesh>(null!);
  const hops = useRef<(THREE.Mesh | null)[]>([]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const { T, kappa } = tunnelT(V0eV, EeV, aNm);
  const aM = aNm * 1e-9;
  const barrierVisWidth = 0.8;
  const bx0 = -barrierVisWidth / 2;
  const bx1 = barrierVisWidth / 2;
  // a log scale so that both 10⁻⁶ and 10⁻¹ are visible
  const active = THREE.MathUtils.clamp(1 + Math.log10(Math.max(T, 1e-9)) / 8, 0, 1);
  const tipGap = 0.15 + aNm * 0.55;
  const atoms = useMemo(() => {
    const out: [number, number, number][] = [];
    for (let i = -4; i <= 4; i++) for (let j = -2; j <= 2; j++) out.push([i * 0.3 + (j % 2) * 0.15, 0.95, j * 0.27]);
    return out;
  }, []);

  const handleFrame = useCallback(
    (t: number) => {
      const mesh = barsRef.current;
      if (mesh) {
        for (let i = 0; i < N_TUNNEL_BARS; i++) {
          const sx = X_BEFORE + ((X_AFTER - X_BEFORE) * i) / (N_TUNNEL_BARS - 1);
          let prob: number;
          if (sx < bx0) prob = 1;
          else if (sx <= bx1) prob = Math.exp(-2 * kappa * (((sx - bx0) / (bx1 - bx0)) * aM));
          else prob = Math.max(T, 0.003);
          const h = Math.max(prob, 0.02) * 1.1;
          dummy.position.set(2.1 + sx, 2.0 + h / 2, -1.0);
          dummy.scale.set(1, h, 1);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
      }
      // electrons jump across the vacuum gap — as often as the tunnelling probability allows
      hops.current.forEach((m, i) => {
        if (!m) return;
        const u = (t * 1.2 + i / N_HOPS) % 1;
        m.visible = i / N_HOPS < active;
        m.position.set(-1.0 + Math.sin(i * 1.7) * 0.03, 1.08 + tipGap * (1 - u), 0);
      });
    },
    [T, kappa, aM, dummy, bx0, bx1, active, tipGap],
  );

  return (
    <>
      <PhysicsTicker running={running} speed={speed} onFrame={handleFrame} />
      <LabBench position={[0, -0.9, 0]} length={6.6} depth={2.8} height={0.9} />
      {/* a crystal surface made of atoms */}
      <mesh position={[-1.0, 0.45, 0]}>
        <boxGeometry args={[3.0, 0.9, 1.6]} />
        <meshStandardMaterial color="#78350f" metalness={0.5} roughness={0.5} />
      </mesh>
      {atoms.map((p, i) => (
        <mesh key={i} position={[p[0] - 1.0, p[1], p[2]]}>
          <sphereGeometry args={[0.13, 14, 10]} />
          <meshStandardMaterial color="#facc15" metalness={0.7} roughness={0.3} />
        </mesh>
      ))}
      <SceneLabel position={[-2.3, 1.35, 0.8]}>атомы поверхности</SceneLabel>
      {/* the needle of the microscope, separated from the surface by a vacuum gap */}
      <group position={[-1.0, 1.08 + tipGap, 0]}>
        <mesh position={[0, 0.45, 0]}>
          <coneGeometry args={[0.12, 0.9, 20]} />
          <meshStandardMaterial color="#d4d4d8" metalness={0.95} roughness={0.15} />
        </mesh>
        <mesh position={[0, 1.2, 0]}>
          <cylinderGeometry args={[0.12, 0.12, 0.7, 16]} />
          <meshStandardMaterial color="#9ca3af" metalness={0.9} roughness={0.25} />
        </mesh>
        <SceneLabel position={[0.9, 0.6, 0]}>{`игла микроскопа, зазор ${aNm.toFixed(2).replace(".", ",")} нм`}</SceneLabel>
      </group>
      {Array.from({ length: N_HOPS }, (_, i) => (
        <mesh
          key={i}
          ref={(m) => {
            hops.current[i] = m;
          }}
        >
          <sphereGeometry args={[0.035, 10, 8]} />
          <meshBasicMaterial color="#38bdf8" toneMapped={false} />
        </mesh>
      ))}

      {/* the "monitor" with the wave function across the barrier */}
      <group position={[2.1, 2.55, -1.06]}>
        <mesh>
          <boxGeometry args={[3.6, 1.8, 0.06]} />
          <meshStandardMaterial color="#0f172a" roughness={0.7} />
        </mesh>
        <mesh position={[0, 0, 0.04]}>
          <boxGeometry args={[barrierVisWidth, 1.5, 0.01]} />
          <meshBasicMaterial color="#f87171" transparent opacity={0.25} />
        </mesh>
        <SceneLabel position={[0, 1.15, 0]}>{`волна частицы: за барьером T = ${(T * 100).toPrecision(2)} %`}</SceneLabel>
      </group>
      <instancedMesh ref={barsRef} args={[undefined, undefined, N_TUNNEL_BARS]} frustumCulled={false}>
        <boxGeometry args={[0.06, 1, 0.04]} />
        <meshBasicMaterial color="#a78bfa" toneMapped={false} />
      </instancedMesh>
    </>
  );
}

export function SchrodingerEquationSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, n1, n2, Lnm, V0eV, EeV, aNm } = useControls("Уравнение Шрёдингера (яма)", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Электрон в яме = квантовая точка": "abstract", "Туннелирование: игла микроскопа": "tunnel" },
    },
    n1: { value: 1, min: 1, max: 4, step: 1, label: "n₁ (первое состояние)", render: (get) => get("Уравнение Шрёдингера (яма).scenario") === "abstract" },
    n2: { value: 2, min: 1, max: 5, step: 1, label: "n₂ (второе состояние)", render: (get) => get("Уравнение Шрёдингера (яма).scenario") === "abstract" },
    Lnm: { value: 0.7, min: 0.3, max: 3, step: 0.05, label: "L, нм (ширина ямы)", render: (get) => get("Уравнение Шрёдингера (яма).scenario") === "abstract" },
    V0eV: { value: 5, min: 1, max: 10, step: 0.5, label: "V₀, эВ (высота барьера)", render: (get) => get("Уравнение Шрёдингера (яма).scenario") === "tunnel" },
    EeV: { value: 2, min: 0.2, max: 9, step: 0.2, label: "E, эВ (энергия частицы)", render: (get) => get("Уравнение Шрёдингера (яма).scenario") === "tunnel" },
    aNm: { value: 0.5, min: 0.1, max: 1.5, step: 0.05, label: "a, нм (ширина барьера)", render: (get) => get("Уравнение Шрёдингера (яма).scenario") === "tunnel" },
  });
  const isTunnel = scenario === "tunnel";
  const EeVClamped = Math.min(EeV, V0eV - 0.1);
  const { T: tunnelProb } = tunnelT(V0eV, EeVClamped, aNm);
  const L = Lnm * 1e-9;

  const eigCurve = useMemo(() => {
    const pts: { xN: number; psi1: number; psi2: number }[] = [];
    for (let i = 0; i <= 50; i++) {
      const xN = i / 50;
      const x = xN * L;
      pts.push({ xN: Number(xN.toFixed(2)), psi1: Number(Math.pow(psi(n1, x, L), 2).toFixed(2)) * L, psi2: Number(Math.pow(psi(n2, x, L), 2).toFixed(2)) * L });
    }
    return pts;
  }, [n1, n2, L]);

  const E1init = energy(n1, L, M_E);
  const E2init = energy(n2, L, M_E);
  const [live, setLive] = useState<LiveNumbers>({ t: 0, E1: E1init, E2: E2init, dE: Math.abs(E2init - E1init), beatPeriod: 0 });
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, peakX: 1 }]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 500 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);

  const resetState = useCallback(() => {
    setLive({ t: 0, E1: E1init, E2: E2init, dE: Math.abs(E2init - E1init), beatPeriod: 0 });
    setSeries([{ t: 0, peakX: 1 }]);
  }, [E1init, E2init]);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    resetState();
  }, [clock, resetState]);

  const eV = 1.602e-19;
  const dEeV = Math.abs(E2init - E1init) / eV;
  const lambdaNm = dEeV > 0 ? 1240 / dEeV : Infinity;
  const caption = isTunnel ? (
    <>
      Между иглой и поверхностью — пустота, и по классике электрон с энергией {EeVClamped.toFixed(1).replace(".", ",")} эВ её не перепрыгнет (барьер {V0eV} эВ). Но его волна{" "}
      <b>просачивается</b> сквозь зазор: вероятность T = {(tunnelProb * 100).toPrecision(2).replace(".", ",")} %. Чуть увеличьте зазор — ток упадёт в разы: так микроскоп «чувствует» отдельные атомы.
    </>
  ) : n1 === n2 ? (
    <>Выберите два разных состояния n₁ и n₂ — тогда вероятность начнёт «переливаться» между стенками ямы.</>
  ) : (
    <>
      Электрон заперт между стенками и может иметь только <b>определённые энергии</b> (как струна — определённые ноты). В смеси двух состояний вероятность найти его «переливается» туда-сюда. Переходя
      вниз, он излучает фотон ΔE = {dEeV.toFixed(2).replace(".", ",")} эВ ({Number.isFinite(lambdaNm) ? lambdaNm.toFixed(0) : "∞"} нм). Чем уже яма, тем больше ΔE — поэтому мелкие квантовые
      точки светятся голубым, а крупные — красным.
    </>
  );
  const legend: LegendItem[] = isTunnel
    ? [
        { color: "#38bdf8", label: "туннелирующие электроны", kind: "dot" },
        { color: "#a78bfa", label: "|ψ|² — вероятность", kind: "square" },
      ]
    : [{ color: "#a78bfa", label: "|ψ|² — где вероятнее электрон", kind: "square" }];

  return (
    <SimShell
      scene={
        <SceneCanvas
          key={scenario}
          camera={isTunnel ? { position: [0.6, 2.6, 5.8] as [number, number, number], fov: 50 } : { position: [0.5, 2.7, 7.0] as [number, number, number], fov: 50 }}
          orbitTarget={isTunnel ? [0.4, 1.5, -0.2] : [0.5, 1.1, 0]}
          simplified={isMobile}
          maxDistance={16}
          minDistance={3}
          bloomThreshold={0.7}
          fogRange={[14, 40]}
        >
          {isTunnel ? (
            <SceneTunnel key={clock.resetNonce} V0eV={V0eV} EeV={EeVClamped} aNm={aNm} running={clock.running} speed={clock.speed} />
          ) : (
            <SceneContent key={clock.resetNonce} n1={n1} n2={n2} L={L} running={clock.running} speed={clock.speed} onSample={handleSample} onLive={setLive} />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        isTunnel ? (
          <NumberReadouts
            items={[
              { label: "V₀ (барьер)", value: V0eV.toFixed(1), unit: "эВ" },
              { label: "E (частица)", value: EeVClamped.toFixed(1), unit: "эВ" },
              { label: "a (ширина барьера)", value: aNm.toFixed(2), unit: "нм" },
              { label: "Коэфф. прохождения T", value: (tunnelProb * 100).toFixed(3), unit: "%", color: "#a78bfa" },
              { label: "Классически (E<V₀)", value: "прохождение невозможно" },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "E₁ = n₁²π²ℏ²/(2mL²)", value: (live.E1 / eV).toFixed(3), unit: "эВ" },
              { label: "E₂", value: (live.E2 / eV).toFixed(3), unit: "эВ" },
              { label: "ΔE = |E₂−E₁|", value: (live.dE / eV).toFixed(3), unit: "эВ" },
              { label: "λ фотона = 1240/ΔE", value: Number.isFinite(lambdaNm) ? lambdaNm.toFixed(0) : "—", unit: "нм" },
              { label: "Период биений T=h/ΔE", value: (live.beatPeriod * 1e15).toFixed(2), unit: "фс" },
            ]}
          />
        )
      }
      graphs={
        isTunnel ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            Классическая частица с энергией E меньше высоты барьера V₀ никогда не может оказаться по другую
            сторону барьера — у неё просто не хватает энергии. Но волновая функция не обрывается на границе
            барьера, а экспоненциально затухает внутри него (фиолетовые столбики убывают по e^(−2κx)) и
            выходит с другой стороны с ненулевой, хоть и малой, амплитудой — частица «просачивается» сквозь
            барьер. Увеличьте ширину a или высоту V₀ — вероятность прохождения T упадёт экспоненциально.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-border bg-surface-2/60 p-3">
              <p className="mb-1 px-1 text-xs font-medium text-muted-2">Плотности вероятности |ψₙ|² чистых состояний</p>
              <LiveChart data={eigCurve} xKey="xN" xType="number" xLabel="x/L" series={[{ key: "psi1", color: "#5eead4", label: "|ψ_n₁|²" }, { key: "psi2", color: "#fbbf24", label: "|ψ_n₂|²" }]} />
            </div>
            <div className="rounded-xl border border-border bg-surface-2/60 p-3">
              <p className="mb-1 px-1 text-xs font-medium text-muted-2">Интерференционный член cos(ΔE·t/ℏ), управляющий биениями</p>
              <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "peakX", color: "#a78bfa", label: "cos(ωt)" }]} yDomain={[-1, 1]} />
            </div>
          </div>
        )
      }
      note={
        isTunnel ? (
          <>
            Туннельный эффект объясняет альфа-распад тяжёлых ядер: альфа-частица заперта внутри ядра
            кулоновским барьером, который классически непреодолим, но квантовое туннелирование даёт ей
            конечный (пусть и крошечный) шанс просочиться наружу. Тот же принцип лежит в основе
            сканирующего туннельного микроскопа: ток между иглой и поверхностью течёт за счёт туннелирования
            электронов через вакуумный «барьер», и экспоненциальная зависимость T от расстояния даёт
            микроскопу атомарное разрешение по высоте.
          </>
        ) : (
          <>
            Частица в бесконечной потенциальной яме: собственные состояния ψₙ(x)=√(2/L)sin(nπx/L) с энергиями
            Eₙ=n²π²ℏ²/(2mL²). Фиолетовые столбики — суперпозиция ψ₁ и ψ₂: плотность вероятности «перетекает»
            между стенками ямы с периодом биений T=h/ΔE (анимация замедлена, реальный период — фемтосекунды).
            Квантовые точки в экранах QLED — это такие «ямы» для электронов: размер кристаллика задаёт цвет
            (в настоящих точках размеры 2–10 нм, а масса электрона в кристалле меньше).
          </>
        )
      }
    />
  );
}
