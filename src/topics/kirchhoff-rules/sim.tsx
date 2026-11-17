import { useCallback, useMemo } from "react";
import { useControls } from "leva";
import * as THREE from "three";
import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { TransportControls } from "@/components/sim/TransportControls";
import { SimShell } from "@/components/sim/SimShell";
import { NumberReadouts } from "@/components/sim/NumberReadouts";
import { LiveChart } from "@/components/sim/LiveChart";
import { SceneLabel } from "@/components/sim/SceneLabel";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { LightBulb, Resistor, Wire } from "@/components/sim/props/electric";
import { BulbSocket, CurrentFlow, PowerSupply } from "@/components/sim/props/circuit";
import { PSU_MINUS, PSU_PLUS } from "@/components/sim/props/circuitLayout";
import { LabBench } from "@/components/sim/props/environment";
import { textTexture } from "@/components/sim/props/textures";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

type V3 = [number, number, number];

/* Both scenes share one layout: a "+" bus bar on the right (node A) and a "−" bus bar on the left (node B),
   with three branches between them at z = −1.2, 0 and +1.2. */
const XA = 1.9;
const XB = -1.9;
const Z1 = -1.2;
const Z3 = 0;
const Z2 = 1.2;
const BUS_Y = 0.04;

/** on-screen drift speed of the "electrons" for a current I (sign = direction along the path) */
const dot = (I: number) => Math.sign(I) * Math.min(0.9 * Math.abs(I), 5);

function BusBars() {
  return (
    <>
      {[XA, XB].map((x) => (
        <mesh key={x} position={[x, 0.025, 0]} castShadow>
          <boxGeometry args={[0.1, 0.05, Z2 - Z1 + 0.2]} />
          <meshStandardMaterial color="#c2773a" metalness={0.85} roughness={0.3} />
        </mesh>
      ))}
      <SceneLabel position={[XA + 0.15, 0.45, Z1 - 0.35]}>узел A</SceneLabel>
      <SceneLabel position={[XB - 0.15, 0.45, Z1 - 0.35]}>узел B</SceneLabel>
    </>
  );
}

/** Electron streams along the two bus bars (paths listed in the direction of electron motion for positive currents). */
function BusFlows({ a1, a2, b1, b2 }: { a1: number; a2: number; b1: number; b2: number }) {
  return (
    <>
      <CurrentFlow points={[[XA, BUS_Y, Z3], [XA, BUS_Y, Z1]]} count={6} speed={a1} />
      <CurrentFlow points={[[XA, BUS_Y, Z3], [XA, BUS_Y, Z2]]} count={6} speed={a2} />
      <CurrentFlow points={[[XB, BUS_Y, Z1], [XB, BUS_Y, Z3]]} count={6} speed={b1} />
      <CurrentFlow points={[[XB, BUS_Y, Z2], [XB, BUS_Y, Z3]]} count={6} speed={b2} />
    </>
  );
}

/* ---------- scenario 1: one source, two resistors in parallel ---------- */
const PSU_POS: V3 = [0, 0, Z1 - 0.35];
const P_PLUS: V3 = [PSU_POS[0] + PSU_PLUS[0], PSU_PLUS[1], PSU_POS[2] + PSU_PLUS[2]];
const P_MINUS: V3 = [PSU_POS[0] + PSU_MINUS[0], PSU_MINUS[1], PSU_POS[2] + PSU_MINUS[2]];

function SceneSplit({ V0, R1, R2, I1, I2, k }: { V0: number; R1: number; R2: number; I1: number; I2: number; k: number }) {
  const I = I1 + I2;
  const fmt = (v: number) => v.toFixed(2).replace(".", ",");
  // electrons: from the "−" bus through the resistors to the "+" bus, then into the source's "+" and out of its "−"
  const src1: V3[] = [[XA, BUS_Y, Z1], [XA - 0.6, BUS_Y, P_PLUS[2]], P_PLUS];
  const src2: V3[] = [P_MINUS, [XB + 0.6, BUS_Y, P_MINUS[2]], [XB, BUS_Y, Z1]];
  const branch = (z: number): [V3[], V3[]] => [
    [[XB, BUS_Y, z], [-0.56, 0.14, z]],
    [[0.56, 0.14, z], [XA, BUS_Y, z]],
  ];
  const [r1a, r1b] = branch(Z3);
  const [r2a, r2b] = branch(Z2);
  return (
    <>
      <LabBench position={[0, -0.9, 0]} length={5.6} depth={3.8} height={0.9} />
      <BusBars />
      <PowerSupply position={PSU_POS} volts={V0} />
      <SceneLabel position={[0, 0.95, PSU_POS[2]]}>{`источник: I = ${fmt(I)} А`}</SceneLabel>
      <Wire points={src1} color="#dc2626" />
      <Wire points={src2} color="#1f2937" />
      <CurrentFlow points={src1} count={8} speed={dot(I) * k} />
      <CurrentFlow points={src2} count={8} speed={dot(I) * k} />

      {[
        { z: Z3, R: R1, I: I1, name: "R₁", a: r1a, b: r1b },
        { z: Z2, R: R2, I: I2, name: "R₂", a: r2a, b: r2b },
      ].map((br) => (
        <group key={br.name}>
          <Resistor position={[0, 0.14, br.z]} ohms={br.R} />
          <SceneLabel position={[0, 0.55, br.z]}>{`${br.name} = ${br.R.toString().replace(".", ",")} Ом: I = ${fmt(br.I)} А`}</SceneLabel>
          <Wire points={br.a} color="#475569" />
          <Wire points={br.b} color="#475569" />
          <CurrentFlow points={br.a} count={9} speed={dot(br.I) * k} />
          <CurrentFlow points={br.b} count={9} speed={dot(br.I) * k} />
        </group>
      ))}
      <BusFlows a1={dot(I) * k} a2={-dot(I2) * k} b1={dot(I) * k} b2={-dot(I2) * k} />
      <SceneLabel position={[XA - 0.5, 0.9, Z2 + 0.6]}>{`в узел: ${fmt(I)} А = ${fmt(I1)} + ${fmt(I2)}`}</SceneLabel>
    </>
  );
}

/* ---------- scenario 2: a car — alternator and battery in parallel feeding a headlight ---------- */

function Alternator(props: { position: V3 }) {
  return (
    <group position={props.position}>
      <mesh position={[0, 0.3, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.26, 0.26, 0.46, 28]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.75} roughness={0.35} />
      </mesh>
      {[-0.15, -0.05, 0.05, 0.15].map((x) => (
        <mesh key={x} position={[x, 0.3, 0]} rotation={[0, 0, Math.PI / 2]}>
          <torusGeometry args={[0.262, 0.012, 6, 28]} />
          <meshStandardMaterial color="#334155" metalness={0.5} roughness={0.5} />
        </mesh>
      ))}
      {/* pulley driven by the engine belt */}
      <mesh position={[-0.3, 0.3, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.13, 0.13, 0.1, 20]} />
        <meshStandardMaterial color="#111827" metalness={0.4} roughness={0.5} />
      </mesh>
      <mesh position={[0.26, 0.48, 0]}>
        <cylinderGeometry args={[0.035, 0.035, 0.1, 10]} />
        <meshStandardMaterial color="#b45309" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.06, 0]}>
        <boxGeometry args={[0.3, 0.12, 0.3]} />
        <meshStandardMaterial color="#475569" metalness={0.5} roughness={0.5} />
      </mesh>
    </group>
  );
}

function CarBattery(props: { position: V3 }) {
  const label = useMemo(() => textTexture("АКБ 12 В", { color: "#f8fafc", background: "#1f2937", font: "bold 44px sans-serif", width: 256, height: 96 }), []);
  return (
    <group position={props.position}>
      <mesh position={[0, 0.24, 0]} castShadow>
        <boxGeometry args={[0.78, 0.48, 0.44]} />
        <meshStandardMaterial color="#1f2937" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[0.8, 0.05, 0.46]} />
        <meshStandardMaterial color="#374151" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.25, 0.222]}>
        <planeGeometry args={[0.5, 0.19]} />
        <meshStandardMaterial map={label} />
      </mesh>
      {[1, -1].map((s) => (
        <mesh key={s} position={[s * 0.28, 0.56, 0]}>
          <cylinderGeometry args={[0.045, 0.05, 0.08, 14]} />
          <meshStandardMaterial color={s > 0 ? "#dc2626" : "#111827"} metalness={0.4} roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

function SceneCar({ eps1, eps2, R1, R2, R3, I1, I2, I3, k }: { eps1: number; eps2: number; R1: number; R2: number; R3: number; I1: number; I2: number; I3: number; k: number }) {
  const fmt = (v: number) => Math.abs(v).toFixed(2).replace(".", ",");
  // source branches, listed from bus B to bus A; electrons move A → B when the source delivers current (I > 0)
  const altPath1: V3[] = [[XB, BUS_Y, Z1], [-0.86, 0.08, Z1]];
  const altPath2: V3[] = [[-0.44, 0.53, Z1], [0.34, 0.14, Z1]];
  const altPath3: V3[] = [[1.46, 0.14, Z1], [XA, BUS_Y, Z1]];
  const batPath1: V3[] = [[XB, BUS_Y, Z2], [-0.98, 0.56, Z2]];
  const batPath2: V3[] = [[-0.42, 0.56, Z2], [0.34, 0.14, Z2]];
  const batPath3: V3[] = [[1.46, 0.14, Z2], [XA, BUS_Y, Z2]];
  const lampPath1: V3[] = [[XB, BUS_Y, Z3], [-0.16, 0.06, Z3]];
  const lampPath2: V3[] = [[0.16, 0.06, Z3], [XA, BUS_Y, Z3]];
  const brightness = Math.min((I3 * I3 * R3) / 28.8, 1.5);
  return (
    <>
      <LabBench position={[0, -0.9, 0]} length={5.6} depth={3.8} height={0.9} />
      <BusBars />

      <Alternator position={[-0.7, 0, Z1]} />
      <SceneLabel position={[-0.7, 0.9, Z1]}>{`генератор: ε₁ = ${eps1} В`}</SceneLabel>
      <Resistor position={[0.9, 0.14, Z1]} ohms={R1} />
      <SceneLabel position={[0.9, 0.5, Z1]}>{`R₁ = ${R1} Ом`}</SceneLabel>
      {[altPath1, altPath2, altPath3].map((p, i) => (
        <group key={i}>
          <Wire points={p} color="#475569" />
          <CurrentFlow points={p} count={i === 1 ? 3 : 6} speed={-dot(I1) * k} />
        </group>
      ))}

      <CarBattery position={[-0.7, 0, Z2]} />
      <SceneLabel position={[-0.7, 1.0, Z2]}>{I2 < 0 ? `аккумулятор ${eps2} В заряжается: ${fmt(I2)} А` : `аккумулятор ${eps2} В отдаёт ${fmt(I2)} А`}</SceneLabel>
      <Resistor position={[0.9, 0.14, Z2]} ohms={R2} />
      <SceneLabel position={[0.9, 0.5, Z2 + 0.25]}>{`R₂ = ${R2} Ом`}</SceneLabel>
      {[batPath1, batPath2, batPath3].map((p, i) => (
        <group key={i}>
          <Wire points={p} color="#475569" />
          <CurrentFlow points={p} count={i === 1 ? 6 : 6} speed={-dot(I2) * k} />
        </group>
      ))}

      <BulbSocket position={[0, 0, Z3]} />
      <LightBulb position={[0, 0.12, Z3]} brightness={brightness} color="#fef3c7" />
      {/* chrome reflector of the headlight */}
      <mesh position={[0, 0.64, Z3 - 0.1]} rotation={[-Math.PI / 2, 0, 0]}>
        <sphereGeometry args={[0.42, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2.6]} />
        <meshStandardMaterial color="#e5e7eb" metalness={1} roughness={0.15} side={THREE.DoubleSide} />
      </mesh>
      <SceneLabel position={[0, 1.25, Z3]}>{`фара: I₃ = ${fmt(I3)} А`}</SceneLabel>
      {[lampPath1, lampPath2].map((p, i) => (
        <group key={i}>
          <Wire points={p} color="#475569" />
          <CurrentFlow points={p} count={9} speed={dot(I3) * k} />
        </group>
      ))}

      <BusFlows a1={dot(I1) * k} a2={dot(I2) * k} b1={dot(I1) * k} b2={dot(I2) * k} />
      <SceneLabel position={[XA - 0.5, 0.9, Z2 + 0.6]}>{`узел A: ${fmt(I1)} ${I2 >= 0 ? "+" : "−"} ${fmt(I2)} = ${fmt(I3)} А`}</SceneLabel>
    </>
  );
}

export function KirchhoffRulesSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, V0, R1, R2, eps1, eps2, R1b, R2b, R3b } = useControls("Правила Кирхгофа", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Узел цепи: ток делится на два": "abstract", "Автомобиль: генератор, аккумулятор, фара": "twobat" },
    },
    V0: { value: 12, min: 3, max: 24, step: 1, label: "V₀, В (ЭДС)", render: (get) => get("Правила Кирхгофа.scenario") === "abstract" },
    R1: { value: 4, min: 1, max: 15, step: 0.5, label: "R₁, Ом", render: (get) => get("Правила Кирхгофа.scenario") === "abstract" },
    R2: { value: 8, min: 1, max: 15, step: 0.5, label: "R₂, Ом", render: (get) => get("Правила Кирхгофа.scenario") === "abstract" },
    eps1: { value: 14, min: 3, max: 24, step: 1, label: "ε₁ генератора, В", render: (get) => get("Правила Кирхгофа.scenario") === "twobat" },
    eps2: { value: 12, min: 3, max: 24, step: 1, label: "ε₂ аккумулятора, В", render: (get) => get("Правила Кирхгофа.scenario") === "twobat" },
    R1b: { value: 1, min: 0.5, max: 10, step: 0.5, label: "R₁, Ом", render: (get) => get("Правила Кирхгофа.scenario") === "twobat" },
    R2b: { value: 1, min: 0.5, max: 10, step: 0.5, label: "R₂, Ом", render: (get) => get("Правила Кирхгофа.scenario") === "twobat" },
    R3b: { value: 10, min: 0.5, max: 15, step: 0.5, label: "R₃ (фара), Ом", render: (get) => get("Правила Кирхгофа.scenario") === "twobat" },
  });
  const twobat = scenario === "twobat";

  const I1 = V0 / R1;
  const I2 = V0 / R2;
  const Itotal = I1 + I2;
  const Req = 1 / (1 / R1 + 1 / R2);

  // Millman's theorem for two EMF branches + one resistive branch sharing nodes A,B:
  const vAB = (eps1 / R1b + eps2 / R2b) / (1 / R1b + 1 / R2b + 1 / R3b);
  const iB1 = (eps1 - vAB) / R1b;
  const iB2 = (eps2 - vAB) / R2b;
  const iB3 = vAB / R3b;

  const curve = useMemo(() => {
    const pts: { R2v: number; Itotal: number }[] = [];
    for (let i = 0; i <= 40; i++) {
      const r2 = 1 + (15 - 1) * (i / 40);
      pts.push({ R2v: Number(r2.toFixed(2)), Itotal: Number((V0 / R1 + V0 / r2).toFixed(3)) });
    }
    return pts;
  }, [V0, R1]);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
  }, [clock]);

  const k = clock.running ? clock.speed : 0;
  const fmt = (v: number) => Math.abs(v).toFixed(2).replace(".", ",");
  const caption = twobat ? (
    iB2 < 0 ? (
      <>
        Генератор (ε₁ = {eps1} В) питает фару ({fmt(iB3)} А) и ещё <b>подзаряжает аккумулятор</b> ({fmt(iB2)} А — ток через аккумулятор идёт «назад»). Узел A: сколько втекает, столько и вытекает:{" "}
        {fmt(iB1)} = {fmt(iB3)} + {fmt(iB2)} А.
      </>
    ) : (
      <>
        Нагрузка большая, и генератору <b>помогает аккумулятор</b>: оба отдают ток в фару. Узел A: {fmt(iB1)} + {fmt(iB2)} = {fmt(iB3)} А. Увеличьте R₃ (меньше нагрузки) — аккумулятор снова начнёт
        заряжаться.
      </>
    )
  ) : (
    <>
      Ток от источника ({fmt(Itotal)} А) приходит в <b>узел A</b> и делится: {fmt(I1)} А идёт через R₁ и {fmt(I2)} А через R₂. Сколько втекает в узел, столько и вытекает — это{" "}
      <b>первое правило Кирхгофа</b>. Через меньшее сопротивление идёт больший ток: напряжение на обеих ветвях одно и то же, {V0} В.
    </>
  );
  const legend: LegendItem[] = [
    { color: "#7dd3fc", label: "электроны (скорость ∝ току)", kind: "dot" },
    { color: "#c2773a", label: "медные шины = узлы", kind: "square" },
  ];

  return (
    <SimShell
      scene={
        <SceneCanvas key={scenario} camera={{ position: [0.4, 4.5, 4.6] as [number, number, number], fov: 50 }} orbitTarget={[0, 0.2, 0]} simplified={isMobile} maxDistance={16} minDistance={3} bloomThreshold={0.7} fogRange={[14, 40]}>
          {twobat ? (
            <SceneCar key={clock.resetNonce} eps1={eps1} eps2={eps2} R1={R1b} R2={R2b} R3={R3b} I1={iB1} I2={iB2} I3={iB3} k={k} />
          ) : (
            <SceneSplit key={clock.resetNonce} V0={V0} R1={R1} R2={R2} I1={I1} I2={I2} k={k} />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        twobat ? (
          <NumberReadouts
            items={[
              { label: "Напряжение узла V_AB", value: vAB.toFixed(2), unit: "В" },
              { label: "I₁ (генератор)", value: iB1.toFixed(3), unit: "А", color: "#f87171" },
              { label: "I₂ (аккумулятор; < 0 — заряжается)", value: iB2.toFixed(3), unit: "А", color: "#fbbf24" },
              { label: "I₃ (фара R₃)", value: iB3.toFixed(3), unit: "А", color: "#4ade80" },
              { label: "Проверка узла: I₁+I₂−I₃", value: (iB1 + iB2 - iB3).toExponential(1) },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "I₁ = V₀/R₁", value: I1.toFixed(3), unit: "А", color: "#f87171" },
              { label: "I₂ = V₀/R₂", value: I2.toFixed(3), unit: "А", color: "#fbbf24" },
              { label: "I полный = I₁+I₂ (I правило)", value: Itotal.toFixed(3), unit: "А" },
              { label: "R экв = 1/(1/R₁+1/R₂)", value: Req.toFixed(2), unit: "Ом" },
            ]}
          />
        )
      }
      graphs={
        twobat ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            Здесь простые формулы «последовательно/параллельно» не работают — в контуре два независимых
            источника ЭДС. Решение требует правил Кирхгофа (или, для этого частного случая с двумя узлами,
            теоремы Миллмана): V_AB=(ε₁/R₁+ε₂/R₂)/(1/R₁+1/R₂+1/R₃). Если ε₂&lt;V_AB, аккумулятор
            заряжается током от генератора — ток через него течёт в обратную сторону. Так и устроена
            бортовая сеть автомобиля.
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">I_полн(R₂) при фиксированных V₀,R₁</p>
            <LiveChart data={curve} xKey="R2v" xType="number" xLabel="R₂, Ом" series={[{ key: "Itotal", color: "#4ade80", label: "I_полн, А" }]} />
          </div>
        )
      }
      note={
        twobat ? (
          <>
            Первое правило Кирхгофа (закон узлов): I₁+I₂=I₃ — сумма токов к узлу A равна току, уходящему через
            R₃. Второе правило (закон контуров) для каждого независимого контура связывает ЭДС и падения
            напряжения на резисторах: именно из совместного решения этих уравнений и получается теорема
            Миллмана, использованная выше.
          </>
        ) : (
          <>
            Первое правило Кирхгофа (закон узлов): сумма токов, входящих в узел, равна сумме выходящих —
            I_полн=I₁+I₂. Второе правило (закон контуров): в каждой параллельной ветви падение напряжения
            одинаково и равно V₀=I₁R₁=I₂R₂. Голубые точки — электроны, их скорость пропорциональна току в
            каждом проводе: в общем проводе они бегут быстрее, чем в ветвях.
          </>
        )
      }
    />
  );
}
