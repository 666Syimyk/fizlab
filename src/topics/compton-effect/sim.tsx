import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { badgeTexture } from "@/components/sim/props/textures";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const LAMBDA_C_PM = 2.426; // Compton wavelength, pm
const PERIOD = 8;
const BEAM_Y = 0.6;
const ARM = 2.2;
const SHOT = PERIOD / 1.5;

interface SamplePoint {
  t: number;
  thetaDeg: number;
  dLambda: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  thetaDeg: number;
  dLambda: number;
  lambdaOut: number;
  phiDeg: number;
}

/** A short wave train along +x: the photon drawn as a "wiggle" whose spacing shows its wavelength. */
function wiggleGeometry() {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 120; i++) {
    const x = -0.45 + (0.9 * i) / 120;
    const env = Math.exp(-((x / 0.32) ** 2));
    pts.push(new THREE.Vector3(x, Math.sin((x / 0.12) * Math.PI * 2) * 0.1 * env, 0));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.012, 5, false);
}

function recoilAngle(theta: number, lambda0: number) {
  const cotPhi = (1 + LAMBDA_C_PM / lambda0) * Math.tan(theta / 2);
  return Math.atan(1 / Math.max(cotPhi, 1e-6));
}

interface SceneContentProps {
  lambda0: number;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

function SceneContent({ lambda0, running, speed, onSample, onLive }: SceneContentProps) {
  const incoming = useRef<THREE.Group>(null!);
  const outgoing = useRef<THREE.Group>(null!);
  const outWave = useRef<THREE.Group>(null!);
  const electron = useRef<THREE.Group>(null!);
  const arm = useRef<THREE.Group>(null!);
  const wiggle = useMemo(() => wiggleGeometry(), []);
  useEffect(() => () => wiggle.dispose(), [wiggle]);
  const eTex = useMemo(() => badgeTexture("e⁻", "#0284c7"), []);

  const handleFrame = useCallback(
    (t: number) => {
      const theta = Math.PI * ((t % PERIOD) / PERIOD);
      const phi = recoilAngle(theta, lambda0);
      const lambdaOut = lambda0 + LAMBDA_C_PM * (1 - Math.cos(theta));
      // the detector arm follows the scattering angle
      if (arm.current) arm.current.rotation.y = -theta;
      const shot = (t % SHOT) / SHOT;
      if (incoming.current) {
        incoming.current.visible = shot < 0.5;
        incoming.current.position.set(-2.1 + (shot / 0.5) * 2.1, BEAM_Y, 0);
      }
      const after = Math.max(0, (shot - 0.5) / 0.5);
      if (outgoing.current) {
        outgoing.current.visible = shot >= 0.5;
        outgoing.current.position.set(Math.cos(theta) * after * ARM * 0.92, BEAM_Y, Math.sin(theta) * after * ARM * 0.92);
        outgoing.current.rotation.y = -theta;
      }
      // a longer wavelength = a stretched wiggle (the stretch is exaggerated ×3 to be visible)
      if (outWave.current) outWave.current.scale.x = 1 + 3 * (lambdaOut / lambda0 - 1);
      if (electron.current) {
        electron.current.visible = shot >= 0.5;
        const d = after * 1.6;
        electron.current.position.set(Math.cos(phi) * d, BEAM_Y, -Math.sin(phi) * d);
      }
    },
    [lambda0],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={(t) => {
          const theta = Math.PI * ((t % PERIOD) / PERIOD);
          const dLambda = LAMBDA_C_PM * (1 - Math.cos(theta));
          const lambdaOut = lambda0 + dLambda;
          const phi = recoilAngle(theta, lambda0);
          onSample({ t, thetaDeg: (theta * 180) / Math.PI, dLambda });
          onLive({ t, thetaDeg: (theta * 180) / Math.PI, dLambda, lambdaOut, phiDeg: (phi * 180) / Math.PI });
        }}
      />

      <LabBench position={[0, -0.9, 0]} length={6.4} depth={5} height={0.9} />
      {/* X-ray tube and a lead collimator */}
      <group position={[-2.75, BEAM_Y, 0]}>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <capsuleGeometry args={[0.22, 0.7, 8, 20]} />
          <meshStandardMaterial color="#e0f2fe" transparent opacity={0.3} roughness={0.05} depthWrite={false} />
        </mesh>
        <mesh position={[-0.25, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.06, 0.06, 0.25, 12]} />
          <meshStandardMaterial color="#b45309" metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh position={[0.25, 0, 0]} rotation={[0, 0, 0.6]}>
          <boxGeometry args={[0.04, 0.22, 0.2]} />
          <meshStandardMaterial color="#9ca3af" metalness={0.9} roughness={0.2} />
        </mesh>
        <mesh position={[0, -BEAM_Y / 2 - 0.05, 0]}>
          <boxGeometry args={[0.5, BEAM_Y - 0.1, 0.4]} />
          <meshStandardMaterial color="#334155" />
        </mesh>
        <SceneLabel position={[0, 0.55, 0]}>рентгеновская трубка</SceneLabel>
      </group>
      <mesh position={[-1.75, BEAM_Y, 0]}>
        <boxGeometry args={[0.25, 0.6, 0.6]} />
        <meshStandardMaterial color="#52525b" metalness={0.4} roughness={0.6} />
      </mesh>

      {/* graphite target: its loosely bound electrons scatter the X-rays */}
      <mesh position={[0, BEAM_Y, 0]} castShadow>
        <boxGeometry args={[0.35, 0.7, 0.35]} />
        <meshStandardMaterial color="#1c1917" roughness={0.85} />
      </mesh>
      <mesh position={[0, (BEAM_Y - 0.35) / 2, 0]}>
        <cylinderGeometry args={[0.05, 0.05, BEAM_Y - 0.35, 10]} />
        <meshStandardMaterial color="#52525b" />
      </mesh>
      <SceneLabel position={[0, BEAM_Y + 0.6, 0]}>графит (мишень)</SceneLabel>

      {/* detector on an arm that swings round the target */}
      <group ref={arm} position={[0, BEAM_Y, 0]}>
        <mesh position={[ARM / 2, -0.25, 0]}>
          <boxGeometry args={[ARM, 0.05, 0.12]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.6} roughness={0.4} />
        </mesh>
        <group position={[ARM + 0.15, 0, 0]}>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.16, 0.16, 0.5, 20]} />
            <meshStandardMaterial color="#facc15" roughness={0.5} />
          </mesh>
          <SceneLabel position={[0, 0.45, 0]}>детектор</SceneLabel>
        </group>
      </group>

      <group ref={incoming}>
        <mesh geometry={wiggle}>
          <meshBasicMaterial color="#c084fc" toneMapped={false} />
        </mesh>
      </group>
      <group ref={outgoing} visible={false}>
        <group ref={outWave}>
          <mesh geometry={wiggle}>
            <meshBasicMaterial color="#f472b6" toneMapped={false} />
          </mesh>
        </group>
      </group>
      <group ref={electron} visible={false}>
        <mesh>
          <sphereGeometry args={[0.08, 14, 10]} />
          <meshBasicMaterial color="#38bdf8" toneMapped={false} />
        </mesh>
        <sprite position={[0, 0.22, 0]} scale={0.22}>
          <spriteMaterial map={eTex} transparent depthTest={false} />
        </sprite>
      </group>
    </>
  );
}

export function ComptonEffectSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { lambda0 } = useControls("Эффект Комптона", {
    lambda0: { value: 20, min: 5, max: 50, step: 1, label: "λ₀, пм (падающий рентген)" },
  });

  const curve = useMemo(() => {
    const pts: { thetaDeg: number; dLambda: number }[] = [];
    for (let i = 0; i <= 36; i++) {
      const deg = i * 5;
      const dLambda = LAMBDA_C_PM * (1 - Math.cos((deg * Math.PI) / 180));
      pts.push({ thetaDeg: deg, dLambda: Number(dLambda.toFixed(3)) });
    }
    return pts;
  }, []);

  const [live, setLive] = useState<LiveNumbers>({ t: 0, thetaDeg: 0, dLambda: 0, lambdaOut: lambda0, phiDeg: 90 });
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, thetaDeg: 0, dLambda: 0 }]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 500 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);

  const resetState = useCallback(() => {
    setLive({ t: 0, thetaDeg: 0, dLambda: 0, lambdaOut: lambda0, phiDeg: 90 });
    setSeries([{ t: 0, thetaDeg: 0, dLambda: 0 }]);
  }, [lambda0]);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    resetState();
  }, [clock, resetState]);

  const fmt = (v: number, d = 1) => v.toFixed(d).replace(".", ",");
  const caption = (
    <>
      Рентгеновский фотон бьёт по электрону в графите, как бильярдный шар по неподвижному: электрон отлетает (голубой), а фотон уходит под углом θ = {fmt(live.thetaDeg, 0)}°, <b>потеряв часть
      энергии</b> — его длина волны выросла на Δλ = {fmt(live.dLambda, 2)} пм (волна на картинке «растянулась»). Чем больше угол, тем больше сдвиг: значит, у света есть импульс, как у частицы.
    </>
  );
  const legend: LegendItem[] = [
    { color: "#c084fc", label: "фотон до удара (λ₀)", kind: "line" },
    { color: "#f472b6", label: "фотон после (λ' > λ₀)", kind: "line" },
    { color: "#38bdf8", label: "электрон отдачи", kind: "dot" },
  ];

  return (
    <SimShell
      scene={
        <SceneCanvas camera={{ position: [0.6, 4.2, 4.8] as [number, number, number], fov: 50 }} orbitTarget={[-0.2, 0.4, 0.2]} simplified={isMobile} maxDistance={16} minDistance={3} bloomThreshold={0.7} fogRange={[14, 40]}>
          <SceneContent key={clock.resetNonce} lambda0={lambda0} running={clock.running} speed={clock.speed} onSample={handleSample} onLive={setLive} />
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        <NumberReadouts
          items={[
            { label: "Угол рассеяния θ", value: live.thetaDeg.toFixed(1), unit: "°" },
            { label: "Δλ = λ_C(1−cosθ)", value: live.dLambda.toFixed(3), unit: "пм" },
            { label: "λ' = λ₀+Δλ", value: live.lambdaOut.toFixed(2), unit: "пм" },
            { label: "Угол отдачи электрона φ", value: live.phiDeg.toFixed(1), unit: "°" },
            { label: "λ_C (комптоновская длина волны)", value: LAMBDA_C_PM.toFixed(3), unit: "пм" },
          ]}
        />
      }
      graphs={
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">Δλ(θ) = λ_C(1−cosθ)</p>
            <LiveChart data={curve} xKey="thetaDeg" xType="number" xLabel="θ, °" series={[{ key: "dLambda", color: "#f87171", label: "Δλ, пм" }]} />
          </div>
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">θ(t) и Δλ(t) при развёртке угла рассеяния</p>
            <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "thetaDeg", color: "#5eead4", label: "θ, °" }, { key: "dLambda", color: "#f87171", label: "Δλ, пм" }]} />
          </div>
        </div>
      }
      note={
        <>
          Опыт Комптона (1923): рентгеновские лучи рассеиваются на электронах графита, а детектор на
          поворотном плече измеряет длину волны рассеянного излучения. Сдвиг Δλ=λ_C(1−cosθ) не зависит от
          λ₀ и материала — так ведут себя столкновения частиц, и это прямое доказательство корпускулярной
          природы света (фотон — частица с импульсом p=h/λ). Растяжение волны на рисунке преувеличено.
        </>
      }
    />
  );
}
