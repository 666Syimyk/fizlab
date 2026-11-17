import { useCallback, useMemo, useRef, useState } from "react";
import { useControls } from "leva";
import * as THREE from "three";
import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { PhysicsTicker } from "@/components/sim/PhysicsTicker";
import { TransportControls } from "@/components/sim/TransportControls";
import { SimShell } from "@/components/sim/SimShell";
import { NumberReadouts } from "@/components/sim/NumberReadouts";
import { Histogram } from "@/components/sim/Histogram";
import { SceneLabel } from "@/components/sim/SceneLabel";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { Ground, LabBench } from "@/components/sim/props/environment";
import { SoccerBall } from "@/components/sim/props/sport";
import { badgeTexture } from "@/components/sim/props/textures";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const MAX_HITS = 700;
const SLIT_D = 0.7;
const SLIT_LAMBDA = 0.45;
const SCREEN_L = 3;
const Y_RANGE = 2.6;
const ELECTRON_PERIOD = 0.22;
const AXIS_Y = 1.3;

function slitIntensity(y: number) {
  const theta = Math.atan2(y, SCREEN_L);
  const delta = SLIT_D * Math.sin(theta);
  return Math.cos((Math.PI * delta) / SLIT_LAMBDA) ** 2;
}

function sampleY(rng: () => number) {
  for (let i = 0; i < 40; i++) {
    const y = (rng() * 2 - 1) * Y_RANGE;
    if (rng() < slitIntensity(y)) return y;
  }
  return 0;
}

const H_PLANCK = 6.626e-34;
const N_WAVE_PTS = 60;
const X_MIN = -3;
const X_MAX = 3;

const MASSES: Record<string, number> = {
  Электрон: 9.109e-31,
  Протон: 1.673e-27,
  "Футбольный мяч": 0.43,
};

interface SceneContentProps {
  particle: string;
  m: number;
  v: number;
  running: boolean;
  speed: number;
}

const LAMBDA_REF = H_PLANCK / (MASSES.Электрон * 1e6); // electron @ 1e6 m/s, reference for visual scaling

/* ---------- a moving particle and its de Broglie wave packet ---------- */
function SceneContent({ particle, m, v, running, speed }: SceneContentProps) {
  const particleRef = useRef<THREE.Group>(null!);
  const waveRef = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const ball = particle === "Футбольный мяч";
  const badge = useMemo(() => badgeTexture(particle === "Протон" ? "p⁺" : "e⁻", particle === "Протон" ? "#dc2626" : "#0284c7"), [particle]);

  // real λ = h/(mv) spans dozens of orders of magnitude; it is mapped onto a visible range, keeping the order
  const lambdaReal = H_PLANCK / (m * v);
  const visLambda = Math.max(0.2, Math.min(2.5, 0.9 * Math.pow(lambdaReal / LAMBDA_REF, 0.15)));
  // for a football the wave is unobservably small: draw it practically flat
  const amp = ball ? 0.015 : 0.32;
  const visSpeed = 1.2;
  const y0 = ball ? 0.25 : AXIS_Y;

  const handleFrame = useCallback(
    (t: number) => {
      const x = X_MIN + ((visSpeed * t) % (X_MAX - X_MIN));
      if (particleRef.current) {
        particleRef.current.position.set(x, y0, 0);
        if (ball) particleRef.current.rotation.z = -x / 0.25;
      }
      const mesh = waveRef.current;
      if (mesh) {
        const k = (2 * Math.PI) / visLambda;
        for (let i = 0; i < N_WAVE_PTS; i++) {
          const wx = X_MIN + ((X_MAX - X_MIN) * i) / (N_WAVE_PTS - 1);
          const envelope = Math.exp(-Math.pow((wx - x) / 1.2, 2));
          dummy.position.set(wx, y0 + 0.55 + Math.sin(k * wx - visSpeed * 5 * t) * amp * envelope, 0);
          dummy.scale.setScalar(0.04);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
      }
    },
    [dummy, visLambda, amp, y0, ball],
  );

  return (
    <>
      <PhysicsTicker running={running} speed={speed} onFrame={handleFrame} />
      {ball ? (
        <Ground kind="grass" from={-6} to={6} width={6} tile={3} tileZ={3} />
      ) : (
        <>
          <LabBench position={[0, -0.9, 0]} length={7.4} depth={2.2} height={0.9} />
          {/* evacuated glass tube with an electron/proton gun at the left end */}
          <mesh position={[0, AXIS_Y, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.85, 0.85, 6.8, 32, 1, true]} />
            <meshStandardMaterial color="#e0f2fe" transparent opacity={0.1} roughness={0.05} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          <mesh position={[-3.5, AXIS_Y, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.3, 0.38, 0.5, 20]} />
            <meshStandardMaterial color="#475569" metalness={0.6} roughness={0.4} />
          </mesh>
          {[-2.4, 2.4].map((x) => (
            <mesh key={x} position={[x, (AXIS_Y - 0.85) / 2, 0]}>
              <boxGeometry args={[0.2, AXIS_Y - 0.85, 0.5]} />
              <meshStandardMaterial color="#334155" />
            </mesh>
          ))}
          <SceneLabel position={[-3.5, AXIS_Y + 0.65, 0]}>{particle === "Протон" ? "ускоритель протонов" : "электронная пушка"}</SceneLabel>
        </>
      )}

      <instancedMesh ref={waveRef} args={[undefined, undefined, N_WAVE_PTS]} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial color="#5eead4" toneMapped={false} />
      </instancedMesh>

      <group ref={particleRef}>
        {ball ? (
          <SoccerBall radius={0.25} castShadow />
        ) : (
          <>
            <mesh>
              <sphereGeometry args={[0.13, 18, 18]} />
              <meshBasicMaterial color={particle === "Протон" ? "#f87171" : "#38bdf8"} toneMapped={false} />
            </mesh>
            <sprite position={[0, 0.3, 0]} scale={0.24}>
              <spriteMaterial map={badge} transparent depthTest={false} />
            </sprite>
          </>
        )}
      </group>
      <SceneLabel position={[0, y0 + 1.25, 0]}>{ball ? "волна мяча в 10³⁴ раз меньше — её не видно" : "волна де Бройля летит вместе с частицей"}</SceneLabel>
    </>
  );
}

/* ---------- double slit with electrons sent one by one ---------- */
function SceneDoubleSlitSingle({ running, speed, onLive }: { running: boolean; speed: number; onLive: (n: { count: number }) => void }) {
  const electronRef = useRef<THREE.Mesh>(null!);
  const flashRef = useRef<THREE.Mesh>(null!);
  const pointsRef = useRef<THREE.Points>(null!);
  const posArray = useRef<Float32Array>(new Float32Array(MAX_HITS * 3));
  const countRef = useRef(0);
  const lastIdxRef = useRef(-1);
  const pendingYRef = useRef(0);

  const handleFrame = useCallback((t: number) => {
    const idx = Math.floor(t / ELECTRON_PERIOD);
    const frac = (t % ELECTRON_PERIOD) / ELECTRON_PERIOD;
    if (idx !== lastIdxRef.current) {
      lastIdxRef.current = idx;
      pendingYRef.current = sampleY(Math.random) * 0.42;
    }
    const x = -3 + frac * 6;
    const y = frac < 0.5 ? AXIS_Y : AXIS_Y + pendingYRef.current * ((frac - 0.5) / 0.5);
    if (electronRef.current) {
      electronRef.current.visible = true;
      electronRef.current.position.set(x, y, 0);
    }
    if (flashRef.current) {
      flashRef.current.visible = frac > 0.9;
      flashRef.current.position.set(2.98, AXIS_Y + pendingYRef.current, 0);
    }
    if (frac > 0.97 && countRef.current < MAX_HITS) {
      const n = countRef.current;
      posArray.current[n * 3] = 2.97;
      posArray.current[n * 3 + 1] = AXIS_Y + pendingYRef.current;
      posArray.current[n * 3 + 2] = (Math.random() - 0.5) * 1.1;
      countRef.current += 1;
      if (pointsRef.current) {
        pointsRef.current.geometry.setDrawRange(0, countRef.current);
        (pointsRef.current.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      }
    }
  }, []);

  return (
    <>
      <PhysicsTicker running={running} speed={speed} onFrame={handleFrame} sampleHz={4} onSample={() => onLive({ count: countRef.current })} />
      <LabBench position={[0, -0.9, 0]} length={7.6} depth={2.6} height={0.9} />
      <mesh position={[0, AXIS_Y, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.95, 0.95, 6.6, 32, 1, true]} />
        <meshStandardMaterial color="#e0f2fe" transparent opacity={0.08} roughness={0.05} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {/* electron gun */}
      <group position={[-3.3, AXIS_Y, 0]}>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.28, 0.36, 0.6, 20]} />
          <meshStandardMaterial color="#475569" metalness={0.6} roughness={0.4} />
        </mesh>
        <mesh position={[0.32, 0, 0]}>
          <sphereGeometry args={[0.05, 12, 10]} />
          <meshBasicMaterial color="#fb923c" toneMapped={false} />
        </mesh>
        <SceneLabel position={[0, 0.65, 0]}>электроны по одному</SceneLabel>
      </group>
      {/* plate with two slits */}
      <group position={[0, AXIS_Y, 0]}>
        {[
          [0.85, 1.0],
          [-0.85, 1.0],
          [0, 0.5],
        ].map(([y, h], i) => (
          <mesh key={i} position={[0, y as number, 0]}>
            <boxGeometry args={[0.05, h as number, 1.6]} />
            <meshStandardMaterial color="#27272a" metalness={0.5} roughness={0.5} />
          </mesh>
        ))}
        <SceneLabel position={[0, 1.6, 0]}>пластинка с двумя щелями</SceneLabel>
      </group>
      <mesh ref={electronRef} visible={false}>
        <sphereGeometry args={[0.055, 12, 12]} />
        <meshBasicMaterial color="#38bdf8" toneMapped={false} />
      </mesh>
      {/* fluorescent screen: every electron makes one green flash */}
      <mesh position={[3.0, AXIS_Y, 0]}>
        <boxGeometry args={[0.04, 2.6, 1.6]} />
        <meshStandardMaterial color="#052e16" roughness={0.6} />
      </mesh>
      <mesh ref={flashRef} visible={false}>
        <sphereGeometry args={[0.09, 12, 10]} />
        <meshBasicMaterial color="#bbf7d0" toneMapped={false} />
      </mesh>
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[posArray.current, 3]} />
        </bufferGeometry>
        <pointsMaterial color="#4ade80" size={0.05} sizeAttenuation transparent opacity={0.95} />
      </points>
      <SceneLabel position={[3, AXIS_Y + 1.6, 0]}>светящийся экран (следы ударов)</SceneLabel>
    </>
  );
}

export function WaveParticleDualitySim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, particle, v } = useControls("Корпускулярно-волновой дуализм", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Волна де Бройля: электрон, протон, мяч": "abstract", "Двухщелевой опыт с одиночными электронами": "singleslit" },
    },
    particle: { value: "Электрон", options: Object.keys(MASSES), label: "Частица", render: (get) => get("Корпускулярно-волновой дуализм.scenario") === "abstract" },
    v: { value: 1e6, min: 1e3, max: 5e6, step: 1e3, label: "v, м/с", render: (get) => get("Корпускулярно-волновой дуализм.scenario") === "abstract" },
  });
  const isSingleSlit = scenario === "singleslit";
  const [singleLive, setSingleLive] = useState({ count: 0 });
  const m = MASSES[particle];
  const p = m * v;
  const lambda = H_PLANCK / p;

  const lambdaElectron = H_PLANCK / (MASSES["Электрон"] * v);
  const lambdaProton = H_PLANCK / (MASSES["Протон"] * v);
  const lambdaBall = H_PLANCK / (MASSES["Футбольный мяч"] * v);

  const logCurve = [
    { name: "Электрон", log10lambda: Number(Math.log10(lambdaElectron).toFixed(2)) },
    { name: "Протон", log10lambda: Number(Math.log10(lambdaProton).toFixed(2)) },
    { name: "Мяч", log10lambda: Number(Math.log10(lambdaBall).toFixed(2)) },
  ];

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
  }, [clock]);

  const caption = isSingleSlit ? (
    singleLive.count < 40 ? (
      <>
        Пушка выпускает электроны <b>по одному</b>. Каждый оставляет на экране одну точку — как пулька. Где он ударит, заранее не знает никто. Смотрите, что будет, когда точек станет много…
      </>
    ) : (
      <>
        Уже {singleLive.count} электронов — и точки складываются в <b>полосы</b>, как у волн, прошедших через две щели! Каждый электрон летит как волна (через обе щели сразу), а ударяет в экран как
        частица.
      </>
    )
  ) : particle === "Футбольный мяч" ? (
    <>
      У мяча тоже есть волна де Бройля λ = h/(mv), но она в 10³⁴ раз меньше атомного ядра — никакой прибор её не заметит. Поэтому большие тела ведут себя как обычные шары.
    </>
  ) : (
    <>
      Движущийся {particle === "Протон" ? "протон" : "электрон"} — это ещё и <b>волна</b> с длиной λ = h/(mv) = {lambda.toExponential(1).replace(".", ",")} м: сравнимо с расстоянием между атомами. Поэтому
      пучок электронов даёт дифракцию на кристаллах — на этом работает электронный микроскоп.
    </>
  );
  const legend: LegendItem[] = isSingleSlit
    ? [
        { color: "#38bdf8", label: "летящий электрон", kind: "dot" },
        { color: "#4ade80", label: "след на экране", kind: "dot" },
      ]
    : [{ color: "#5eead4", label: "волна де Бройля (масштаб условный)", kind: "dot" }];

  return (
    <SimShell
      scene={
        <SceneCanvas
          key={scenario}
          camera={isSingleSlit ? { position: [1.6, 2.8, 5.8] as [number, number, number], fov: 50 } : { position: [0, 2.6, 6.4] as [number, number, number], fov: 50 }}
          orbitTarget={isSingleSlit ? [0.4, AXIS_Y, 0] : [0, 1.1, 0]}
          simplified={isMobile}
          maxDistance={16}
          minDistance={3}
          bloomThreshold={0.7}
          fogRange={[14, 40]}
        >
          {isSingleSlit ? (
            <SceneDoubleSlitSingle key={clock.resetNonce} running={clock.running} speed={clock.speed} onLive={setSingleLive} />
          ) : (
            <SceneContent key={`${clock.resetNonce}-${particle}`} particle={particle} m={m} v={v} running={clock.running} speed={clock.speed} />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        isSingleSlit ? (
          <NumberReadouts
            items={[
              { label: "Электронов зарегистрировано", value: singleLive.count.toString() },
              { label: "Ширина полосы Δy = λL/d", value: ((SLIT_LAMBDA * SCREEN_L) / SLIT_D).toFixed(2), unit: "усл.ед." },
              { label: "Каждый электрон", value: "попадает в одну точку" },
              { label: "Со временем", value: "точки складываются в полосы" },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "p = mv (импульс)", value: p.toExponential(3), unit: "кг·м/с" },
              { label: "λ = h/p (де Бройль)", value: lambda.toExponential(3), unit: "м" },
              { label: "λ электрона при этой v", value: lambdaElectron.toExponential(3), unit: "м" },
              { label: "λ протона при этой v", value: lambdaProton.toExponential(3), unit: "м" },
              { label: "λ мяча при этой v", value: lambdaBall.toExponential(3), unit: "м" },
            ]}
          />
        )
      }
      graphs={
        isSingleSlit ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            Это самый знаменитый эксперимент квантовой физики. Электроны запускаются по одному — каждый
            регистрируется на экране как одна точка в одном конкретном месте (частица!), и заранее
            невозможно предсказать, куда именно попадёт данный электрон. Но вероятность попадания в точку y
            задаётся волновой интерференционной формулой I(y)=cos²(πd·sinθ/λ) — и по мере накопления тысяч
            одиночных попаданий на экране постепенно проступает та же полосатая картина, что и при
            интерференции классических волн. Электрон словно «интерферирует сам с собой», проходя сразу
            через обе щели.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-border bg-surface-2/60 p-3">
              <p className="mb-1 px-1 text-xs font-medium text-muted-2">lg(λ) при текущей v — разница на десятки порядков</p>
              <Histogram data={logCurve} xKey="name" barKey="log10lambda" barColor="#5eead4" xLabel="частица" yLabel="lg(λ/1м)" />
            </div>
            <div className="rounded-xl border border-border bg-surface-2/60 p-3 text-xs text-muted-2">
              <p className="mb-2 font-medium">Почему волновые свойства заметны только у микрочастиц</p>
              <p className="leading-relaxed">
                При одинаковой скорости длина волны де Бройля обратно пропорциональна массе (λ=h/mv). У
                электрона λ порядка ангстрема — сравнима с межатомными расстояниями, поэтому проявляется
                дифракция электронов. У футбольного мяча λ на ~30 порядков меньше размера атомного ядра —
                волновые эффекты абсолютно ненаблюдаемы.
              </p>
            </div>
          </div>
        )
      }
      note={
        isSingleSlit ? (
          <>
            Этот результат (реально поставленный эксперимент, начиная с опытов Клауса Йёнссона и позже
            с одиночными электронами) убедительно показывает: квантовые объекты не являются ни классическими
            частицами, ни классическими волнами — вероятность их обнаружения описывается волновой функцией,
            а сам акт обнаружения всегда даёт локализованную «частицу».
          </>
        ) : (
          <>
            Частица движется вдоль оси, бирюзовый волновой пакет сопровождает её — визуализация волны де
            Бройля (длина волны на сцене увеличена для наглядности; реальное значение — в панели чисел).
            Каждой движущейся частице соответствует волна λ=h/p — и наоборот, свет (волна) ведёт себя как
            поток фотонов-частиц (см. фотоэффект и эффект Комптона).
          </>
        )
      }
    />
  );
}
