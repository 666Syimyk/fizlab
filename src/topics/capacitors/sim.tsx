import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useControls } from "leva";
import * as THREE from "three";
import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { PhysicsTicker } from "@/components/sim/PhysicsTicker";
import { FieldArrow } from "@/components/sim/FieldArrow";
import { SceneLabel } from "@/components/sim/SceneLabel";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { Battery, Resistor, Wire } from "@/components/sim/props/electric";
import { CurrentFlow, Meter } from "@/components/sim/props/circuit";
import { Ground, LabBench } from "@/components/sim/props/environment";
import { Person } from "@/components/sim/props/Person";
import { badgeTexture, textTexture } from "@/components/sim/props/textures";
import { TransportControls } from "@/components/sim/TransportControls";
import { SimShell } from "@/components/sim/SimShell";
import { NumberReadouts } from "@/components/sim/NumberReadouts";
import { LiveChart } from "@/components/sim/LiveChart";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const EPS0 = 8.854e-12;
/** τ of the default settings (A = 100 см², d = 2 мм, εr = 3, R = 5 кОм) */
const TAU_DEFAULT = ((EPS0 * 3 * 100e-4) / 2e-3) * 5e3;
/** the real charging takes microseconds: replay it slowed down so that the default τ lasts 2 s on screen */
const SLOWMO = 2 / TAU_DEFAULT;

interface SamplePoint {
  t: number;
  Vn: number;
  Wn: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  V: number;
  Q: number;
  W: number;
  I: number;
}

/* ---------- circuit geometry on the bench (bench top at y = 0) ---------- */
const PLATE_X = 1.5;
const PLATE_SIZE = 1.5;
const TOP_Y = 1.25;
const BOT_Y = 0.45;
const BAT_PLUS: [number, number, number] = [-1.68, 0.16, 0.7];
const BAT_MINUS: [number, number, number] = [-2.67, 0.16, 0.7];
const RES_X = -0.7;
const PLUS_PATH: [number, number, number][] = [BAT_PLUS, [RES_X - 0.56, 0.14, 0.7], [RES_X + 0.56, 0.14, 0.7], [0.4, 0.14, 0.7], [0.4, TOP_Y, 0.7], [PLATE_X - PLATE_SIZE / 2 + 0.05, TOP_Y, 0.3]];
const PLUS_WIRE_A = PLUS_PATH.slice(0, 2);
const PLUS_WIRE_B = PLUS_PATH.slice(2);
const MINUS_PATH: [number, number, number][] = [BAT_MINUS, [-3.0, 0.1, 0.7], [-3.0, 0.1, -1.0], [0.5, 0.1, -1.0], [0.5, BOT_Y, -0.5], [PLATE_X - PLATE_SIZE / 2 + 0.05, BOT_Y, -0.3]];
const BADGES: [number, number][] = [-0.45, 0, 0.45].flatMap((x) => [-0.45, 0, 0.45].map((z) => [x, z] as [number, number]));

interface SceneContentProps {
  V0: number;
  C: number;
  R: number;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

function SceneContent({ V0, C, R, running, speed, onSample, onLive }: SceneContentProps) {
  const tau = R * C;
  const topGlow = useRef<THREE.MeshStandardMaterial>(null!);
  const botGlow = useRef<THREE.MeshStandardMaterial>(null!);
  const arrowsGroupRef = useRef<THREE.Group>(null!);
  const plusBadges = useRef<(THREE.Sprite | null)[]>([]);
  const minusBadges = useRef<(THREE.Sprite | null)[]>([]);
  const electronSpeed = useRef(0);
  const negSpeed = useRef(0);
  const meterValue = useRef(0);
  const plusTex = useMemo(() => badgeTexture("+", "#dc2626"), []);
  const minusTex = useMemo(() => badgeTexture("−", "#2563eb"), []);

  const vAt = useCallback((tAnim: number) => V0 * (1 - Math.exp(-tAnim / SLOWMO / tau)), [V0, tau]);

  useEffect(() => {
    if (!running) {
      electronSpeed.current = 0;
      negSpeed.current = 0;
    }
  }, [running]);

  const handleFrame = useCallback(
    (t: number) => {
      const V = vAt(t);
      const frac = V / V0;
      if (topGlow.current) topGlow.current.emissiveIntensity = 0.05 + 0.6 * frac;
      if (botGlow.current) botGlow.current.emissiveIntensity = 0.05 + 0.6 * frac;
      if (arrowsGroupRef.current) arrowsGroupRef.current.scale.y = Math.max(frac, 0.02);
      const n = Math.round(frac * BADGES.length);
      plusBadges.current.forEach((s, i) => s && (s.visible = i < n));
      minusBadges.current.forEach((s, i) => s && (s.visible = i < n));
      // electrons: from the "−" terminal to the lower plate, from the upper plate back to the "+" terminal
      const current = 1 - frac; // I/I₀ = e^(−t/τ)
      electronSpeed.current = 1.3 * current * speed;
      negSpeed.current = -1.3 * current * speed;
      meterValue.current = frac;
    },
    [vAt, V0, speed],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={(t) => {
          const V = vAt(t);
          const Q = C * V;
          const W = 0.5 * C * V * V;
          const tPhys = t / SLOWMO;
          const I = (V0 / R) * Math.exp(-tPhys / tau);
          onSample({ t: Number((tPhys / tau).toFixed(3)), Vn: V / V0, Wn: W / (0.5 * C * V0 * V0) });
          onLive({ t: tPhys, V, Q, W, I });
        }}
      />

      <LabBench position={[0, -0.9, 0]} length={7} depth={3.2} height={0.9} />

      {/* battery and resistor */}
      <Battery position={[-2.2, 0.16, 0.7]} voltage={`${V0} В`} />
      <SceneLabel position={[-2.2, 0.62, 0.7]}>батарейка</SceneLabel>
      <Resistor position={[RES_X, 0.14, 0.7]} ohms={R} />
      <SceneLabel position={[RES_X, 0.55, 0.7]}>{`резистор ${(R / 1000).toFixed(0)} кОм`}</SceneLabel>

      {/* wires */}
      <Wire points={PLUS_WIRE_A} color="#dc2626" />
      <Wire points={PLUS_WIRE_B} color="#dc2626" />
      <Wire points={MINUS_PATH} color="#1f2937" />
      <CurrentFlow points={PLUS_PATH} count={22} speedRef={negSpeed} />
      <CurrentFlow points={MINUS_PATH} count={26} speedRef={electronSpeed} />

      {/* the capacitor: two aluminium plates on glass posts */}
      {[TOP_Y, BOT_Y].map((y) => (
        <mesh key={y} position={[PLATE_X, y, 0]} castShadow receiveShadow>
          <boxGeometry args={[PLATE_SIZE, 0.06, PLATE_SIZE]} />
          <meshStandardMaterial ref={y === TOP_Y ? topGlow : botGlow} color="#d4d4d8" metalness={0.55} roughness={0.35} emissive={y === TOP_Y ? "#dc2626" : "#2563eb"} emissiveIntensity={0.05} />
        </mesh>
      ))}
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`${sx}${sz}`} position={[PLATE_X + sx * (PLATE_SIZE / 2 - 0.08), TOP_Y / 2, sz * (PLATE_SIZE / 2 - 0.08)]}>
            <cylinderGeometry args={[0.025, 0.025, TOP_Y, 8]} />
            <meshStandardMaterial color="#e0f2fe" transparent opacity={0.5} roughness={0.05} />
          </mesh>
        )),
      )}
      <SceneLabel position={[PLATE_X + 1.05, TOP_Y + 0.25, 0]}>обкладка +</SceneLabel>
      <SceneLabel position={[PLATE_X + 1.05, BOT_Y + 0.05, 0]}>обкладка −</SceneLabel>
      {BADGES.map(([x, z], i) => (
        <sprite key={`p${i}`} ref={(s) => void (plusBadges.current[i] = s)} position={[PLATE_X + x, TOP_Y + 0.12, z]} scale={0.17} visible={false} renderOrder={3}>
          <spriteMaterial map={plusTex} depthTest={false} transparent />
        </sprite>
      ))}
      {BADGES.map(([x, z], i) => (
        <sprite key={`m${i}`} ref={(s) => void (minusBadges.current[i] = s)} position={[PLATE_X + x, BOT_Y + 0.12, z]} scale={0.17} visible={false} renderOrder={3}>
          <spriteMaterial map={minusTex} depthTest={false} transparent />
        </sprite>
      ))}

      {/* the field between the plates points from + to − (down) and grows with the charge */}
      <group ref={arrowsGroupRef} position={[PLATE_X, TOP_Y - 0.05, 0]}>
        {[
          [-0.45, -0.45],
          [-0.45, 0.45],
          [0.45, -0.45],
          [0.45, 0.45],
          [0, 0],
        ].map(([x, z], i) => (
          <FieldArrow key={i} origin={[x, 0, z]} vector={[0, -(TOP_Y - BOT_Y - 0.12), 0]} color="#5eead4" opacity={0.85} />
        ))}
      </group>

      <Meter position={[PLATE_X, 0.23, 1.15]} letter="V" valueRef={meterValue} />
      <SceneLabel position={[PLATE_X, 0.62, 1.15]}>вольтметр</SceneLabel>
    </>
  );
}

/* ---------- camera flash ---------- */

interface FlashLive {
  t: number;
  V: number;
  phase: "charging" | "flash" | "done";
}

const FLASH_PAUSE = 1.2;
/** the real discharge lasts ~1/60 τ; the glow is stretched a little so the eye can catch it */
const GLOW_TAU = 0.07;

function CameraModel({ flashMat, ledMat }: { flashMat: RefObject<THREE.MeshStandardMaterial>; ledMat: RefObject<THREE.MeshStandardMaterial> }) {
  return (
    <group>
      {/* tripod */}
      {[0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2 + 0.3;
        const foot = new THREE.Vector3(Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55);
        const top = new THREE.Vector3(0, 1.12, 0);
        const mid = foot.clone().add(top).multiplyScalar(0.5);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(foot).normalize());
        return (
          <mesh key={i} position={mid} quaternion={q} castShadow>
            <cylinderGeometry args={[0.022, 0.03, top.distanceTo(foot), 8]} />
            <meshStandardMaterial color="#27272a" metalness={0.6} roughness={0.4} />
          </mesh>
        );
      })}
      <mesh position={[0, 1.15, 0]}>
        <cylinderGeometry args={[0.09, 0.09, 0.08, 16]} />
        <meshStandardMaterial color="#18181b" metalness={0.5} roughness={0.4} />
      </mesh>
      {/* body, grip, prism hump */}
      <mesh position={[0, 1.47, 0]} castShadow>
        <boxGeometry args={[0.95, 0.58, 0.34]} />
        <meshStandardMaterial color="#1c1c1f" roughness={0.55} />
      </mesh>
      <mesh position={[0.38, 1.45, 0.08]} castShadow>
        <boxGeometry args={[0.22, 0.54, 0.4]} />
        <meshStandardMaterial color="#111113" roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.83, 0]} castShadow>
        <cylinderGeometry args={[0.14, 0.2, 0.16, 4, 1, false, Math.PI / 4]} />
        <meshStandardMaterial color="#1c1c1f" roughness={0.55} />
      </mesh>
      <mesh position={[0.32, 1.78, 0.08]}>
        <cylinderGeometry args={[0.045, 0.045, 0.04, 16]} />
        <meshStandardMaterial color="#9ca3af" metalness={0.8} roughness={0.3} />
      </mesh>
      {/* lens */}
      <mesh position={[-0.05, 1.45, 0.36]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.22, 0.2, 0.42, 32]} />
        <meshStandardMaterial color="#18181b" roughness={0.4} metalness={0.3} />
      </mesh>
      <mesh position={[-0.05, 1.45, 0.4]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.215, 0.012, 8, 32]} />
        <meshStandardMaterial color="#dc2626" />
      </mesh>
      <mesh position={[-0.05, 1.45, 0.575]}>
        <circleGeometry args={[0.17, 32]} />
        <meshStandardMaterial color="#1e3a8a" metalness={0.9} roughness={0.05} />
      </mesh>
      {/* flash unit on the hot shoe */}
      <mesh position={[0, 1.97, 0]} castShadow>
        <boxGeometry args={[0.14, 0.14, 0.18]} />
        <meshStandardMaterial color="#27272a" roughness={0.6} />
      </mesh>
      <mesh position={[0, 2.12, 0.02]} castShadow>
        <boxGeometry args={[0.42, 0.2, 0.26]} />
        <meshStandardMaterial color="#1c1c1f" roughness={0.6} />
      </mesh>
      <mesh position={[0, 2.12, 0.152]}>
        <planeGeometry args={[0.36, 0.15]} />
        <meshStandardMaterial ref={flashMat} color="#f8fafc" emissive="#fffbeb" emissiveIntensity={0.05} toneMapped={false} />
      </mesh>
      {/* "ready" lamp on the back of the flash */}
      <mesh position={[0.12, 2.12, -0.115]}>
        <sphereGeometry args={[0.025, 12, 10]} />
        <meshStandardMaterial ref={ledMat} color="#dc2626" emissive="#dc2626" emissiveIntensity={1.5} toneMapped={false} />
      </mesh>
    </group>
  );
}

function SceneFlash({ V0, C, R, running, speed, onLive }: { V0: number; C: number; R: number; running: boolean; speed: number; onLive: (n: FlashLive) => void }) {
  const tau = R * C;
  const tCharge = tau * 5;
  const dischargeTau = tau / 60;
  const cycle = tCharge + FLASH_PAUSE;
  const flashRef = useRef<THREE.PointLight>(null!);
  const flashMat = useRef<THREE.MeshStandardMaterial>(null!);
  const ledMat = useRef<THREE.MeshStandardMaterial>(null!);
  const level = useRef<THREE.Mesh>(null!);
  const sleeve = useMemo(
    () =>
      textTexture("200 мкФ  330 В", { color: "#e0f2fe", background: "#1e293b", font: "bold 30px sans-serif", width: 512, height: 128 }),
    [],
  );

  const vAt = useCallback(
    (t: number) => {
      const tc = t % cycle;
      if (tc < tCharge) return V0 * (1 - Math.exp(-tc / tau));
      return V0 * (1 - Math.exp(-tCharge / tau)) * Math.exp(-(tc - tCharge) / dischargeTau);
    },
    [V0, tau, tCharge, dischargeTau, cycle],
  );

  const handleFrame = useCallback(
    (t: number) => {
      const tc = t % cycle;
      const V = vAt(t);
      const glow = tc >= tCharge ? Math.exp(-(tc - tCharge) / GLOW_TAU) : 0;
      if (flashRef.current) flashRef.current.intensity = glow * 60;
      if (flashMat.current) flashMat.current.emissiveIntensity = 0.05 + glow * 8;
      const ready = tc < tCharge && V / V0 > 0.9;
      if (ledMat.current) {
        ledMat.current.color.set(ready ? "#22c55e" : "#dc2626");
        ledMat.current.emissive.set(ready ? "#22c55e" : "#dc2626");
      }
      if (level.current) level.current.scale.y = Math.max(V / V0, 0.01);
    },
    [vAt, tCharge, V0, cycle],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={30}
        onSample={(t) => {
          const tc = t % cycle;
          const V = vAt(t);
          const phase = tc < tCharge ? "charging" : tc < tCharge + 0.35 ? "flash" : "done";
          onLive({ t: tc, V, phase });
        }}
      />

      <Ground kind="parquet" from={-6} to={6} width={10} tile={2} tileZ={2} />

      <CameraModel flashMat={flashMat} ledMat={ledMat} />
      <SceneLabel position={[0, 2.55, 0]}>фотоаппарат со вспышкой</SceneLabel>
      <pointLight ref={flashRef} position={[0, 2.12, 0.5]} color="#fffbeb" intensity={0} distance={12} decay={1.4} />

      {/* the person being photographed */}
      <Person position={[0, 0, 3.4]} rotation={[0, Math.PI, 0]} shirt="#f97316" pants="#334155" longHair />
      <SceneLabel position={[0, 2.15, 3.4]}>кого фотографируют</SceneLabel>

      {/* the flash capacitor shown next to the tripod */}
      <group position={[-0.6, 0, -1.0]}>
        <mesh position={[0, 0.25, 0]}>
          <cylinderGeometry args={[0.3, 0.3, 0.5, 20]} />
          <meshStandardMaterial color="#52525b" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.85, 0]} castShadow>
          <cylinderGeometry args={[0.2, 0.2, 0.7, 28, 1, true]} />
          <meshStandardMaterial map={sleeve} roughness={0.45} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 1.205, 0]}>
          <cylinderGeometry args={[0.2, 0.2, 0.01, 28]} />
          <meshStandardMaterial color="#d4d4d8" metalness={0.9} roughness={0.25} />
        </mesh>
        {/* charge level, like a fuel gauge */}
        <mesh position={[0.32, 0.85, 0]}>
          <boxGeometry args={[0.09, 0.7, 0.09]} />
          <meshStandardMaterial color="#e0f2fe" transparent opacity={0.25} />
        </mesh>
        <mesh ref={level} position={[0.32, 0.5, 0]}>
          <boxGeometry args={[0.07, 0.7, 0.07]} />
          <meshStandardMaterial color="#fbbf24" emissive="#f59e0b" emissiveIntensity={0.8} toneMapped={false} />
        </mesh>
        <SceneLabel position={[0, 1.55, 0]}>конденсатор вспышки</SceneLabel>
      </group>
    </>
  );
}

export function CapacitorsSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, Acm2, dmm, epsR, V0, Rk } = useControls("Конденсатор", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Зарядка конденсатора от батарейки": "abstract", "Вспышка фотоаппарата": "flash" },
    },
    Acm2: { value: 100, min: 20, max: 300, step: 10, label: "A, см²", render: (get) => get("Конденсатор.scenario") === "abstract" },
    dmm: { value: 2, min: 0.5, max: 8, step: 0.5, label: "d, мм", render: (get) => get("Конденсатор.scenario") === "abstract" },
    epsR: { value: 3, min: 1, max: 10, step: 0.5, label: "εr", render: (get) => get("Конденсатор.scenario") === "abstract" },
    V0: { value: 12, min: 3, max: 50, step: 1, label: "V₀ батареи, В" },
    Rk: { value: 5, min: 1, max: 30, step: 1, label: "R, кОм (зарядка)" },
  });
  const flash = scenario === "flash";

  const A = Acm2 * 1e-4;
  const d = dmm * 1e-3;
  const Cabstract = (EPS0 * epsR * A) / d;
  const Cflash = 200e-6; // 200 µF — a typical photo-flash electrolytic capacitor
  const C = flash ? Cflash : Cabstract;
  const R = Rk * 1000;
  const tau = R * C;
  const [flashLive, setFlashLive] = useState<FlashLive>({ t: 0, V: 0, phase: "charging" });

  const [live, setLive] = useState<LiveNumbers>({ t: 0, V: 0, Q: 0, W: 0, I: V0 / R });
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, Vn: 0, Wn: 0 }]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 400 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);

  const resetState = useCallback(() => {
    setLive({ t: 0, V: 0, Q: 0, W: 0, I: V0 / R });
    setSeries([{ t: 0, Vn: 0, Wn: 0 }]);
    setFlashLive({ t: 0, V: 0, phase: "charging" });
  }, [V0, R]);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    resetState();
  }, [clock, resetState]);

  // any parameter change restarts the charging from an empty capacitor
  const paramKey = `${scenario}|${Acm2}|${dmm}|${epsR}|${V0}|${Rk}`;
  const lastKey = useRef(paramKey);
  useEffect(() => {
    if (lastKey.current === paramKey) return;
    lastKey.current = paramKey;
    handleReset();
  }, [paramKey, handleReset]);

  const fmt = (v: number, digits = 1) => v.toFixed(digits).replace(".", ",");
  const tauUs = tau * 1e6;
  const pct = V0 > 0 ? Math.round((live.V / V0) * 100) : 0;
  const caption = flash ? (
    flashLive.phase === "charging" ? (
      <>
        Батарейка <b>медленно заряжает</b> конденсатор вспышки через большое сопротивление: τ = RC = {fmt(tau, 1)} с. Жёлтая шкала — его заряд; когда он почти полный, лампочка «готово» на
        вспышке становится зелёной.
      </>
    ) : (
      <>
        <b>Вспышка!</b> Лампа почти не сопротивляется, и вся энергия W = CV²/2 ≈ {fmt(0.5 * C * V0 * V0 * 1000, 1)} мДж выходит за сотые доли секунды. Копить — секунды, отдать — мгновенно: на этом
        работают вспышка и дефибриллятор.
      </>
    )
  ) : (
    <>
      Батарейка перекачивает электроны (голубые точки) с верхней пластины на нижнюю: верхняя становится «+», нижняя «−», между ними растёт поле. Чем больше заряд, тем сильнее он мешает —{" "}
      <b>ток слабеет</b>, точки замедляются. За τ = RC = {tauUs < 1 ? fmt(tauUs * 1000, 0) + " нс" : fmt(tauUs, 2) + " мкс"} конденсатор заряжается на 63 %. Сейчас {pct} %.
    </>
  );
  const legend: LegendItem[] = flash
    ? [
        { color: "#fbbf24", label: "заряд конденсатора", kind: "square" },
        { color: "#22c55e", label: "лампочка «готово»", kind: "dot" },
      ]
    : [
        { color: "#7dd3fc", label: "электроны", kind: "dot" },
        { color: "#5eead4", label: "поле E (от + к −)" },
        { color: "#dc2626", label: "заряд +", kind: "dot" },
        { color: "#2563eb", label: "заряд −", kind: "dot" },
      ];

  return (
    <SimShell
      scene={
        <SceneCanvas
          key={scenario}
          camera={flash ? { position: [5.2, 2.5, 2.3], fov: 50 } : { position: [0.2, 3.1, 6.9], fov: 50 }}
          orbitTarget={flash ? [0, 1.1, 1.6] : [0, 0.5, 0]}
          simplified={isMobile}
          maxDistance={16}
          minDistance={3}
          bloomThreshold={0.6}
          fogRange={[14, 40]}
        >
          {flash ? (
            <SceneFlash key={clock.resetNonce} V0={V0} C={C} R={R} running={clock.running} speed={clock.speed} onLive={setFlashLive} />
          ) : (
            <SceneContent key={clock.resetNonce} V0={V0} C={C} R={R} running={clock.running} speed={clock.speed} onSample={handleSample} onLive={setLive} />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        flash ? (
          <NumberReadouts
            items={[
              { label: "Время с начала зарядки", value: flashLive.t.toFixed(2), unit: "с" },
              { label: "C (конденсатор вспышки)", value: (C * 1e6).toFixed(0), unit: "мкФ" },
              { label: "Напряжение V(t)", value: flashLive.V.toFixed(1), unit: "В" },
              { label: "Энергия W = CV²/2", value: (0.5 * C * flashLive.V * flashLive.V * 1000).toFixed(1), unit: "мДж" },
              { label: "Фаза", value: flashLive.phase === "charging" ? "медленная зарядка" : flashLive.phase === "flash" ? "мгновенный разряд!" : "снимок сделан", color: flashLive.phase === "flash" ? "#fbbf24" : undefined },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "Время t (замедлено)", value: (live.t * 1e6).toFixed(3), unit: "мкс" },
              { label: "C = ε₀εrA/d", value: (C * 1e9).toFixed(3), unit: "нФ" },
              { label: "τ = RC", value: tauUs.toFixed(3), unit: "мкс" },
              { label: "V(t) на обкладках", value: live.V.toFixed(2), unit: "В" },
              { label: "Q(t) = CV", value: (live.Q * 1e9).toFixed(2), unit: "нКл" },
              { label: "W(t) = CV²/2", value: (live.W * 1e9).toFixed(2), unit: "нДж" },
            ]}
          />
        )
      }
      graphs={
        flash ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            Батарейка заряжает конденсатор вспышки медленно, через большое сопротивление (секунды — вы слышите
            характерный писк зарядки). А вот лампа-вспышка имеет очень маленькое сопротивление, поэтому весь
            запасённый заряд выходит почти мгновенно (миллисекунды) — короткий, но очень яркий импульс света.
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">Зарядка: V/V₀ и W/W_max (время в единицах τ)</p>
            <LiveChart data={series} xKey="t" xType="number" xLabel="t / τ" series={[{ key: "Vn", color: "#4ade80", label: "V/V₀" }, { key: "Wn", color: "#fbbf24", label: "W/W_max" }]} />
          </div>
        )
      }
      note={
        flash ? (
          <>
            Энергия, запасённая в конденсаторе, W=CV²/2 не зависит от того, как быстро её отдать — только от C
            и V. Меняя сопротивление разрядной цепи, можно растянуть или сжать время разряда: у дефибриллятора
            конденсатор заряжают до тысяч вольт и разряжают через грудную клетку за миллисекунды — тот же
            принцип, что и во вспышке, только энергии в сотни раз больше.
          </>
        ) : (
          <>
            Ёмкость плоского конденсатора C=ε₀εrA/d. При зарядке через резистор R напряжение растёт по
            экспоненте V(t)=V₀(1−e^(−t/τ)), τ=RC — за время τ конденсатор заряжается до 63% от V₀. Энергия
            поля W=CV²/2 растёт быстрее напряжения (квадратично). Настоящая зарядка длится микросекунды,
            поэтому она показана в замедленной съёмке (при настройках по умолчанию — примерно в 3 млн раз):
            увеличьте R, A или εr — и зарядка пойдёт медленнее.
          </>
        )
      }
    />
  );
}
