import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useControls } from "leva";
import * as THREE from "three";
import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { PhysicsTicker } from "@/components/sim/PhysicsTicker";
import { TransportControls } from "@/components/sim/TransportControls";
import { SimShell } from "@/components/sim/SimShell";
import { NumberReadouts } from "@/components/sim/NumberReadouts";
import { LiveChart } from "@/components/sim/LiveChart";
import { FieldArrow } from "@/components/sim/FieldArrow";
import { SceneLabel } from "@/components/sim/SceneLabel";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { BarMagnet, Coil, LightBulb, Wire } from "@/components/sim/props/electric";
import { BulbSocket, CurrentFlow, Meter } from "@/components/sim/props/circuit";
import { LabBench } from "@/components/sim/props/environment";
import { badgeTexture } from "@/components/sim/props/textures";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

/** full scale of the galvanometer, А (needle at the stop beyond it) */
const GALVO_MAX = 0.1;
const COIL_Y = 0.55;
const COIL_LEN = 1.1;
const COIL_RAD = 0.42;
const COIL_TURNS = 14;

interface SamplePoint {
  t: number;
  Phi: number;
  EMF: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  x: number;
  Phi: number;
  EMF: number;
  I: number;
}

function fluxAt(x: number, Phi0: number, a: number) {
  return Phi0 / (1 + (x / a) * (x / a));
}
function dFluxDx(x: number, Phi0: number, a: number) {
  const u = x / a;
  return (-Phi0 * 2 * u) / a / Math.pow(1 + u * u, 2);
}

function coilHelix(): [number, number, number][] {
  const pts: [number, number, number][] = [];
  const steps = COIL_TURNS * 16;
  for (let i = 0; i <= steps; i++) {
    const a = (i / 16) * Math.PI * 2;
    pts.push([-COIL_LEN / 2 + (i / steps) * COIL_LEN, COIL_Y + Math.sin(a) * COIL_RAD, Math.cos(a) * COIL_RAD]);
  }
  return pts;
}

interface SceneContentProps {
  N: number;
  Phi0: number;
  a: number;
  Amp: number;
  T: number;
  R: number;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

/* ---------- Faraday's experiment: a magnet moved through a coil connected to a galvanometer ---------- */
function SceneContent({ N, Phi0, a, Amp, T, R, running, speed, onSample, onLive }: SceneContentProps) {
  const magnetRef = useRef<THREE.Group>(null!);
  const galvo = useRef(0.5);
  const flow = useRef(0);
  const poleN = useRef<THREE.Sprite>(null!);
  const poleS = useRef<THREE.Sprite>(null!);
  const helix = useMemo(() => coilHelix(), []);
  const nTex = useMemo(() => badgeTexture("N", "#dc2626"), []);
  const sTex = useMemo(() => badgeTexture("S", "#2563eb"), []);

  const xAt = useCallback((t: number) => Amp * Math.sin((2 * Math.PI * t) / T), [Amp, T]);
  const vAt = useCallback((t: number) => Amp * ((2 * Math.PI) / T) * Math.cos((2 * Math.PI * t) / T), [Amp, T]);

  useEffect(() => {
    if (!running) flow.current = 0;
  }, [running]);

  const handleFrame = useCallback(
    (t: number) => {
      const x = xAt(t);
      if (magnetRef.current) magnetRef.current.position.x = x;
      const emf = -N * dFluxDx(x, Phi0, a) * vAt(t);
      const I = emf / R;
      galvo.current = 0.5 + 0.5 * THREE.MathUtils.clamp(I / GALVO_MAX, -1.1, 1.1);
      flow.current = Math.sign(I) * Math.min(Math.abs(I) / GALVO_MAX, 1.2) * 4 * speed;
      // Lenz's rule: the coil becomes a magnet that opposes the change of the flux
      const show = Math.abs(I) > GALVO_MAX * 0.05;
      const nAtRight = emf > 0;
      if (poleN.current) {
        poleN.current.visible = show;
        poleN.current.position.x = nAtRight ? COIL_LEN / 2 + 0.2 : -COIL_LEN / 2 - 0.2;
      }
      if (poleS.current) {
        poleS.current.visible = show;
        poleS.current.position.x = nAtRight ? -COIL_LEN / 2 - 0.2 : COIL_LEN / 2 + 0.2;
      }
    },
    [xAt, vAt, N, Phi0, a, R, speed],
  );

  const end = helix[helix.length - 1];
  const start = helix[0];
  const wireA: [number, number, number][] = [end, [COIL_LEN / 2 + 0.25, 0.04, 0.6], [0.25, 0.04, 1.3], [0.15, 0.04, 1.42]];
  const wireB: [number, number, number][] = [[-0.15, 0.04, 1.42], [-0.25, 0.04, 1.3], [-COIL_LEN / 2 - 0.25, 0.04, 0.6], start];

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={(t) => {
          const x = xAt(t);
          const Phi = N * fluxAt(x, Phi0, a);
          const emf = -N * dFluxDx(x, Phi0, a) * vAt(t);
          onSample({ t, Phi, EMF: emf });
          onLive({ t, x, Phi, EMF: emf, I: emf / R });
        }}
      />

      <LabBench position={[0, -0.9, 0]} length={7} depth={3.2} height={0.9} />
      {/* coil on a cardboard tube with two wooden supports */}
      {[-0.4, 0.4].map((x) => (
        <mesh key={x} position={[x, (COIL_Y - COIL_RAD) / 2, 0]} castShadow>
          <boxGeometry args={[0.16, COIL_Y - COIL_RAD, 0.6]} />
          <meshStandardMaterial color="#8b5a2b" roughness={0.7} />
        </mesh>
      ))}
      <mesh position={[0, COIL_Y, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[COIL_RAD - 0.035, COIL_RAD - 0.035, COIL_LEN + 0.12, 32, 1, true]} />
        <meshStandardMaterial color="#d6b98c" roughness={0.9} side={THREE.DoubleSide} transparent opacity={0.45} depthWrite={false} />
      </mesh>
      <Coil position={[0, COIL_Y, 0]} turns={COIL_TURNS} radius={COIL_RAD} length={COIL_LEN} wire={0.03} />
      <CurrentFlow points={helix} count={36} speedRef={flow} radius={0.04} />
      <SceneLabel position={[0, COIL_Y + COIL_RAD + 0.45, 0]}>{`катушка, ${N} витков`}</SceneLabel>
      <sprite ref={poleN} position={[COIL_LEN / 2 + 0.2, COIL_Y + COIL_RAD + 0.15, 0]} scale={0.3} visible={false}>
        <spriteMaterial map={nTex} depthTest={false} transparent />
      </sprite>
      <sprite ref={poleS} position={[-COIL_LEN / 2 - 0.2, COIL_Y + COIL_RAD + 0.15, 0]} scale={0.3} visible={false}>
        <spriteMaterial map={sTex} depthTest={false} transparent />
      </sprite>

      {/* the bar magnet slides along the coil axis */}
      <group ref={magnetRef} position={[0, COIL_Y, 0]}>
        <BarMagnet length={1.2} thickness={0.26} />
        <SceneLabel position={[0, 0.42, 0]}>магнит</SceneLabel>
      </group>

      {/* centre-zero galvanometer */}
      <Meter position={[0, 0.23, 1.45]} letter="мА" valueRef={galvo} />
      <SceneLabel position={[0, 0.68, 1.45]}>гальванометр</SceneLabel>
      <Wire points={wireA} color="#dc2626" radius={0.022} />
      <Wire points={wireB} color="#1f2937" radius={0.022} />
      <CurrentFlow points={wireA} count={10} speedRef={flow} radius={0.035} />
      <CurrentFlow points={wireB} count={10} speedRef={flow} radius={0.035} />
    </>
  );
}

/* ---------- generator: a frame turning between magnet poles, slip rings, brushes, a bulb ---------- */
interface GenLive {
  t: number;
  theta: number;
  emf: number;
  P: number;
}

const FRAME_W = 1.2;
const FRAME_H = 1.0;
const FRAME_Y = 1.25;

function SceneGenerator({ Bgen, omega, Rload, running, speed, onLive }: { Bgen: number; omega: number; Rload: number; running: boolean; speed: number; onLive: (n: GenLive) => void }) {
  const loopRef = useRef<THREE.Group>(null!);
  const brightness = useRef(0);
  const flow = useRef(0);
  const AREA = 0.6; // m², the frame
  const Nturns = 8;
  const frameGeo = useMemo(() => {
    const pts = [
      new THREE.Vector3(0, -FRAME_H / 2, 0),
      new THREE.Vector3(FRAME_W / 2, -FRAME_H / 2, 0),
      new THREE.Vector3(FRAME_W / 2, FRAME_H / 2, 0),
      new THREE.Vector3(-FRAME_W / 2, FRAME_H / 2, 0),
      new THREE.Vector3(-FRAME_W / 2, -FRAME_H / 2, 0),
      new THREE.Vector3(-0.02, -FRAME_H / 2, 0),
    ];
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.02), 120, 0.05, 8, false);
  }, []);
  useEffect(() => () => frameGeo.dispose(), [frameGeo]);
  const nTex = useMemo(() => badgeTexture("N", "#dc2626"), []);
  const sTex = useMemo(() => badgeTexture("S", "#2563eb"), []);

  useEffect(() => {
    if (!running) flow.current = 0;
  }, [running]);

  const handleFrame = useCallback(
    (t: number) => {
      const theta = omega * t;
      if (loopRef.current) loopRef.current.rotation.y = theta;
      const emf = Nturns * Bgen * AREA * omega * Math.sin(theta);
      const P = (emf * emf) / Rload;
      brightness.current = Math.min(P / 150, 1.5);
      flow.current = Math.sign(emf) * Math.min(Math.abs(emf) / Rload, 6) * 0.8 * speed;
    },
    [omega, Bgen, Rload, speed],
  );

  const wire1: [number, number, number][] = [[0.28, 0.32, 0], [0.7, 0.32, 0.3], [1.6, 0.04, 0.9], [2.04, 0.06, 1.0]];
  const wire2: [number, number, number][] = [[2.36, 0.06, 1.0], [2.6, 0.04, 0.6], [1.0, 0.04, -0.4], [0.28, 0.55, -0.05]];

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={30}
        onSample={(t) => {
          const theta = omega * t;
          const emf = Nturns * Bgen * AREA * omega * Math.sin(theta);
          onLive({ t, theta, emf, P: (emf * emf) / Rload });
        }}
      />

      <LabBench position={[0.4, -0.9, 0]} length={6.2} depth={3.2} height={0.9} />
      {/* permanent magnet poles on both sides of the frame */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 1.25, FRAME_Y, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.5, 1.3, 1.3]} />
            <meshStandardMaterial color={s < 0 ? "#b91c1c" : "#1d4ed8"} metalness={0.4} roughness={0.45} />
          </mesh>
          <mesh position={[0, -FRAME_Y / 2 - 0.3, 0]}>
            <boxGeometry args={[0.4, FRAME_Y - 0.45, 0.5]} />
            <meshStandardMaterial color="#3f3f46" metalness={0.5} roughness={0.5} />
          </mesh>
          <sprite position={[0, 0.9, 0]} scale={0.32}>
            <spriteMaterial map={s < 0 ? nTex : sTex} depthTest={false} transparent />
          </sprite>
        </group>
      ))}
      {[-0.35, 0.35].map((z) => (
        <FieldArrow key={z} origin={[-0.95, FRAME_Y + 0.55, z]} vector={[1.9, 0, 0]} color="#5eead4" opacity={0.7} />
      ))}
      <SceneLabel position={[0, FRAME_Y + 1.15, 0]}>однородное поле B магнита</SceneLabel>

      {/* rotating part: frame, shaft, crank handle, two slip rings */}
      <group ref={loopRef}>
        <mesh geometry={frameGeo} position={[0, FRAME_Y, 0]} castShadow>
          <meshStandardMaterial color="#b87333" metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh position={[0, FRAME_Y - 0.1, 0]}>
          <cylinderGeometry args={[0.03, 0.03, FRAME_H + 2.0, 10]} />
          <meshStandardMaterial color="#a1a1aa" metalness={0.9} roughness={0.25} />
        </mesh>
        {[0.32, 0.55].map((y) => (
          <mesh key={y} position={[0, y, 0]}>
            <cylinderGeometry args={[0.13, 0.13, 0.1, 24]} />
            <meshStandardMaterial color="#c2773a" metalness={0.85} roughness={0.3} />
          </mesh>
        ))}
        <mesh position={[0.25, FRAME_Y + FRAME_H / 2 + 0.9, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.025, 0.025, 0.5, 8]} />
          <meshStandardMaterial color="#a1a1aa" metalness={0.9} roughness={0.25} />
        </mesh>
        <mesh position={[0.5, FRAME_Y + FRAME_H / 2 + 1.0, 0]}>
          <cylinderGeometry args={[0.05, 0.05, 0.22, 12]} />
          <meshStandardMaterial color="#7c2d12" roughness={0.6} />
        </mesh>
      </group>
      <SceneLabel position={[0, FRAME_Y + FRAME_H / 2 + 1.35, 0]}>ручка: крутим рамку</SceneLabel>
      <SceneLabel position={[-0.75, FRAME_Y - 0.75, 0.7]}>{`рамка, ${Nturns} витков`}</SceneLabel>
      {/* brushes pressing on the slip rings */}
      {[0.32, 0.55].map((y) => (
        <mesh key={y} position={[0.2, y, 0]}>
          <boxGeometry args={[0.12, 0.08, 0.08]} />
          <meshStandardMaterial color="#27272a" roughness={0.8} />
        </mesh>
      ))}
      <SceneLabel position={[-0.5, 0.45, 0.5]}>кольца и щётки</SceneLabel>

      <BulbSocket position={[2.2, 0, 1.0]} />
      <LightBulb position={[2.2, 0.12, 1.0]} brightnessRef={brightness} />
      <SceneLabel position={[2.2, 1.2, 1.0]}>лампочка</SceneLabel>
      <Wire points={wire1} color="#dc2626" radius={0.022} />
      <Wire points={wire2} color="#1f2937" radius={0.022} />
      <CurrentFlow points={wire1} count={12} speedRef={flow} radius={0.035} />
      <CurrentFlow points={wire2} count={14} speedRef={flow} radius={0.035} />
    </>
  );
}

export function ElectromagneticInductionSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, N, Phi0m, a, Amp, T, R, Bgen, rpm, Rload } = useControls("Электромагнитная индукция", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Опыт Фарадея: магнит и катушка": "abstract", "Генератор (рамка + лампочка)": "generator" },
    },
    N: { value: 20, min: 5, max: 60, step: 5, label: "N витков катушки", render: (get) => get("Электромагнитная индукция.scenario") === "abstract" },
    Phi0m: { value: 8, min: 2, max: 20, step: 1, label: "Φ₀, мВб (макс. поток на виток)", render: (get) => get("Электромагнитная индукция.scenario") === "abstract" },
    a: { value: 0.8, min: 0.4, max: 1.5, step: 0.1, label: "a, м (характ. размер поля магнита)", render: (get) => get("Электромагнитная индукция.scenario") === "abstract" },
    Amp: { value: 2, min: 1, max: 3, step: 0.1, label: "Амплитуда движения магнита, м", render: (get) => get("Электромагнитная индукция.scenario") === "abstract" },
    T: { value: 4, min: 2, max: 8, step: 0.5, label: "Период движения, с", render: (get) => get("Электромагнитная индукция.scenario") === "abstract" },
    R: { value: 5, min: 1, max: 30, step: 1, label: "R катушки, Ом", render: (get) => get("Электромагнитная индукция.scenario") === "abstract" },
    Bgen: { value: 0.6, min: 0.1, max: 1.5, step: 0.05, label: "B поля, Тл", render: (get) => get("Электромагнитная индукция.scenario") === "generator" },
    rpm: { value: 60, min: 20, max: 400, step: 10, label: "Обороты, об/мин", render: (get) => get("Электромагнитная индукция.scenario") === "generator" },
    Rload: { value: 8, min: 2, max: 30, step: 1, label: "R лампочки, Ом", render: (get) => get("Электромагнитная индукция.scenario") === "generator" },
  });
  const isGenerator = scenario === "generator";
  const Phi0 = Phi0m / 1000;
  const omegaGen = (rpm * 2 * Math.PI) / 60;
  const [genLive, setGenLive] = useState<GenLive>({ t: 0, theta: 0, emf: 0, P: 0 });

  const curve = useMemo(() => {
    const pts: { x: number; Phi: number }[] = [];
    for (let i = 0; i <= 40; i++) {
      const x = -3 + (6 * i) / 40;
      pts.push({ x: Number(x.toFixed(2)), Phi: Number((N * fluxAt(x, Phi0, a) * 1000).toFixed(3)) });
    }
    return pts;
  }, [N, Phi0, a]);

  const [live, setLive] = useState<LiveNumbers>({ t: 0, x: 0, Phi: 0, EMF: 0, I: 0 });
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, Phi: 0, EMF: 0 }]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 500 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);

  const resetState = useCallback(() => {
    setLive({ t: 0, x: 0, Phi: 0, EMF: 0, I: 0 });
    setSeries([{ t: 0, Phi: 0, EMF: 0 }]);
  }, []);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    resetState();
  }, [clock, resetState]);

  const fmt = (v: number, d = 1) => v.toFixed(d).replace(".", ",");
  const deg = (((genLive.theta * 180) / Math.PI) % 360 + 360) % 360;
  const caption = isGenerator ? (
    <>
      Крутим ручку — рамка вращается между полюсами магнита, и поток через неё всё время меняется. Наводится <b>переменная ЭДС</b>: сейчас {fmt(genLive.emf)} В. Она наибольшая, когда рамка стоит{" "}
      <b>вдоль</b> поля, и ноль, когда поперёк — лампочка мигает дважды за оборот. Так работают генераторы электростанций.
    </>
  ) : Math.abs(live.I) < GALVO_MAX * 0.05 ? (
    <>
      Магнит {Math.abs(live.x) > Amp * 0.9 ? "на миг остановился" : "почти не меняет поток"} — тока нет, стрелка гальванометра на нуле. Ток возникает, только пока <b>поток меняется</b>.
    </>
  ) : (
    <>
      Магнит {live.Phi > 0 && live.EMF < 0 ? "входит в катушку — поток растёт" : "выходит из катушки — поток падает"}, и в катушке наводится ток {fmt(Math.abs(live.I) * 1000, 0)} мА: стрелка
      гальванометра отклонилась {live.I > 0 ? "вправо" : "влево"}. Катушка сама становится магнитом (N/S) и <b>мешает</b> движению магнита — правило Ленца.
    </>
  );
  const legend: LegendItem[] = isGenerator
    ? [
        { color: "#5eead4", label: "поле магнита B" },
        { color: "#7dd3fc", label: "электроны (ток туда-сюда)", kind: "dot" },
      ]
    : [
        { color: "#7dd3fc", label: "индукционный ток (электроны)", kind: "dot" },
        { color: "#dc2626", label: "полюс N", kind: "dot" },
        { color: "#2563eb", label: "полюс S", kind: "dot" },
      ];

  return (
    <SimShell
      scene={
        <SceneCanvas
          key={scenario}
          camera={isGenerator ? { position: [2.6, 3.3, 6.4] as [number, number, number], fov: 50 } : { position: [0.4, 2.4, 5.2] as [number, number, number], fov: 50 }}
          orbitTarget={isGenerator ? [0.5, 1.1, 0] : [0, 0.5, 0.3]}
          simplified={isMobile}
          maxDistance={18}
          minDistance={3}
          bloomThreshold={0.7}
          fogRange={[14, 40]}
        >
          {isGenerator ? (
            <SceneGenerator key={clock.resetNonce} Bgen={Bgen} omega={omegaGen} Rload={Rload} running={clock.running} speed={clock.speed} onLive={setGenLive} />
          ) : (
            <SceneContent key={clock.resetNonce} N={N} Phi0={Phi0} a={a} Amp={Amp} T={T} R={R} running={clock.running} speed={clock.speed} onSample={handleSample} onLive={setLive} />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        isGenerator ? (
          <NumberReadouts
            items={[
              { label: "ω = 2π·об/мин/60", value: omegaGen.toFixed(2), unit: "рад/с" },
              { label: "Угол рамки", value: deg.toFixed(0), unit: "°" },
              { label: "ЭДС(t) = NBAω·sinθ", value: genLive.emf.toFixed(2), unit: "В" },
              { label: "P на лампочке", value: genLive.P.toFixed(2), unit: "Вт", color: "#facc15" },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "x(t) магнита", value: live.x.toFixed(2), unit: "м" },
              { label: "Φ(t) = NΦ(x)", value: (live.Phi * 1000).toFixed(2), unit: "мВб" },
              { label: "ЭДС = −dΦ/dt", value: (live.EMF * 1000).toFixed(2), unit: "мВ" },
              { label: "I = ЭДС/R", value: (live.I * 1000).toFixed(2), unit: "мА" },
            ]}
          />
        )
      }
      graphs={
        isGenerator ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            Вращающаяся в постоянном магнитном поле рамка — основа любого генератора переменного тока
            (от велосипедной динамо-машины до турбин электростанций). ЭДС меняется по синусоиде
            ЭДС(t)=NBAω·sin(ωt): она максимальна, когда плоскость рамки параллельна полю (поток меняется
            быстрее всего), и равна нулю, когда рамка перпендикулярна полю (поток на мгновение не меняется).
            Кольца и щётки передают ток с вращающейся рамки на неподвижные провода.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-border bg-surface-2/60 p-3">
              <p className="mb-1 px-1 text-xs font-medium text-muted-2">Φ(x) — поток через катушку по мере приближения магнита</p>
              <LiveChart data={curve} xKey="x" xType="number" xLabel="x, м" series={[{ key: "Phi", color: "#5eead4", label: "Φ, мВб" }]} />
            </div>
            <div className="rounded-xl border border-border bg-surface-2/60 p-3">
              <p className="mb-1 px-1 text-xs font-medium text-muted-2">Φ(t) и ЭДС(t)</p>
              <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "Phi", color: "#5eead4", label: "Φ, Вб" }, { key: "EMF", color: "#fbbf24", label: "ЭДС, В" }]} />
            </div>
          </div>
        )
      }
      note={
        isGenerator ? (
          <>
            Закон Фарадея ЭДС=−dΦ/dt применён к вращению: Φ(t)=NBA·cos(ωt), поэтому ЭДС(t)=NBAω·sin(ωt) —
            синусоидальное переменное напряжение. Чем быстрее вращение (обороты) и сильнее поле, тем ярче
            горит лампочка — мощность на нагрузке растёт как ω² при фиксированном R.
          </>
        ) : (
          <>
            Закон Фарадея: ЭДС=−N·dΦ/dt. Когда магнит приближается к катушке, поток растёт, наводится ЭДС
            одного знака; когда удаляется — поток падает, ЭДС меняет знак (правило Ленца: индукционный ток
            противодействует изменению потока, поэтому катушка отталкивает приближающийся магнит и
            притягивает уходящий). Чем быстрее движется магнит и чем больше витков, тем сильнее ток.
          </>
        )
      }
    />
  );
}
