import { useCallback, useMemo } from "react";
import { useControls } from "leva";
import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { TransportControls } from "@/components/sim/TransportControls";
import { SimShell } from "@/components/sim/SimShell";
import { NumberReadouts } from "@/components/sim/NumberReadouts";
import { LiveChart } from "@/components/sim/LiveChart";
import { SceneLabel } from "@/components/sim/SceneLabel";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { LightBulb, Wire } from "@/components/sim/props/electric";
import { BulbSocket, CurrentFlow, Meter, PowerSupply, Rheostat } from "@/components/sim/props/circuit";
import { PSU_MINUS, PSU_PLUS, RHEO_LEFT, RHEO_RIGHT } from "@/components/sim/props/circuitLayout";
import { LabBench } from "@/components/sim/props/environment";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

type V3 = [number, number, number];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

const R_MAX = 20;
/** full scale of the ammeter, А */
const AMMETER_MAX = 5;
/** on-screen drift speed of the "electrons" per ampere (capped so a short circuit stays readable) */
const dotSpeed = (I: number) => Math.min(0.9 * I, 5);

/* ---------- scenario 1: power supply → rheostat → ammeter ---------- */
const PSU_POS: V3 = [-2.2, 0, -0.5];
const RHEO_POS: V3 = [1.8, 0, 0];
const AMM_POS: V3 = [-0.3, 0.23, 0.9];
const P_PLUS = add(PSU_POS, PSU_PLUS);
const P_MINUS = add(PSU_POS, PSU_MINUS);
const R_LEFT = add(RHEO_POS, RHEO_LEFT);
const R_RIGHT = add(RHEO_POS, RHEO_RIGHT);
const A_RED: V3 = [AMM_POS[0] + 0.15, 0.04, AMM_POS[2] + 0.11];
const A_BLACK: V3 = [AMM_POS[0] - 0.15, 0.04, AMM_POS[2] + 0.11];
// paths are listed in the direction the electrons move (from "−" through the circuit to "+")
const E_PATH_1: V3[] = [P_MINUS, [P_MINUS[0], 0.04, A_BLACK[2]], A_BLACK];
const E_PATH_2: V3[] = [A_RED, [R_LEFT[0], 0.04, A_RED[2]], R_LEFT];
const E_PATH_3: V3[] = [R_RIGHT, [2.95, R_RIGHT[1], 0], [2.95, 0.04, -0.95], [P_PLUS[0], 0.04, -0.95], P_PLUS];

function SceneRheostat({ V, R, I, P, flowSpeed }: { V: number; R: number; I: number; P: number; flowSpeed: number }) {
  const meter = useMemo(() => ({ current: I / AMMETER_MAX }), [I]);
  return (
    <>
      <LabBench position={[0, -0.9, 0]} length={7.2} depth={3.2} height={0.9} />
      <PowerSupply position={PSU_POS} volts={V} />
      <SceneLabel position={[PSU_POS[0], 0.95, PSU_POS[2]]}>источник напряжения</SceneLabel>

      <Rheostat position={RHEO_POS} fraction={R / R_MAX} heat={Math.min(Math.sqrt(P) / 9, 1.5)} />
      <SceneLabel position={[RHEO_POS[0], 1.15, 0]}>{`реостат: R = ${R.toFixed(1).replace(".", ",")} Ом`}</SceneLabel>

      <Meter position={AMM_POS} letter="A" valueRef={meter} />
      <SceneLabel position={[AMM_POS[0], 0.68, AMM_POS[2]]}>{I > AMMETER_MAX ? "амперметр: зашкаливает!" : "амперметр"}</SceneLabel>

      <Wire points={E_PATH_1} color="#1f2937" />
      <Wire points={E_PATH_2} color="#1f2937" />
      <Wire points={E_PATH_3} color="#dc2626" />
      <CurrentFlow points={E_PATH_1} count={16} speed={flowSpeed} />
      <CurrentFlow points={E_PATH_2} count={10} speed={flowSpeed} />
      <CurrentFlow points={E_PATH_3} count={30} speed={flowSpeed} />
    </>
  );
}

/* ---------- scenario 2: two bulbs in series / in parallel ---------- */
const PSU2: V3 = [0, 0, -1.1];
const Q_PLUS = add(PSU2, PSU_PLUS);
const Q_MINUS = add(PSU2, PSU_MINUS);
const BULB1: V3 = [-1.2, 0, 0.7];
const BULB2: V3 = [1.2, 0, 0.7];
const L1: V3 = [BULB1[0] - 0.16, 0.06, BULB1[2]];
const R1c: V3 = [BULB1[0] + 0.16, 0.06, BULB1[2]];
const L2: V3 = [BULB2[0] - 0.16, 0.06, BULB2[2]];
const R2c: V3 = [BULB2[0] + 0.16, 0.06, BULB2[2]];
// series: − → bulb 1 → bulb 2 → +
const S1: V3[] = [Q_MINUS, [Q_MINUS[0], 0.04, -0.35], [-1.75, 0.04, -0.35], [-1.75, 0.04, BULB1[2]], L1];
const S2: V3[] = [R1c, L2];
const S3: V3[] = [R2c, [1.75, 0.04, BULB2[2]], [1.75, 0.04, -0.35], [Q_PLUS[0], 0.04, -0.35], Q_PLUS];
// parallel: a "−" trunk to junction J1, two branches, a "+" trunk from junction J2
const J1: V3 = [-1.9, 0.04, BULB1[2]];
const J2: V3 = [Q_PLUS[0], 0.04, -0.35];
const PT_MINUS: V3[] = [Q_MINUS, [Q_MINUS[0], 0.04, -0.6], [-1.9, 0.04, -0.6], J1];
const PB1_MINUS: V3[] = [J1, L1];
const PB2_MINUS: V3[] = [J1, [-1.9, 0.04, 1.2], [0.8, 0.04, 1.2], [0.8, 0.04, BULB2[2]], L2];
const PB1_PLUS: V3[] = [R1c, [-0.8, 0.04, BULB1[2]], [-0.8, 0.04, -0.35], J2];
const PB2_PLUS: V3[] = [R2c, [1.75, 0.04, BULB2[2]], [1.75, 0.04, -0.35], J2];
const PT_PLUS: V3[] = [J2, Q_PLUS];

/** bulbs are rated 12 V: at 12 V across a bulb it glows at full brightness */
const glow = (U: number) => (U / 12) ** 2;

function SceneBulbs({ V, R1, R2, series, running, speed }: { V: number; R1: number; R2: number; series: boolean; running: boolean; speed: number }) {
  const Rtotal = series ? R1 + R2 : (R1 * R2) / (R1 + R2);
  const Itotal = V / Rtotal;
  const I1 = series ? Itotal : V / R1;
  const I2 = series ? Itotal : V / R2;
  const U1 = I1 * R1;
  const U2 = I2 * R2;
  const k = running ? speed : 0;
  const fmt = (v: number) => v.toFixed(1).replace(".", ",");

  return (
    <>
      <LabBench position={[0, -0.9, 0]} length={5.4} depth={3.2} height={0.9} />
      <PowerSupply position={PSU2} volts={V} />
      <SceneLabel position={[PSU2[0], 0.95, PSU2[2]]}>источник напряжения</SceneLabel>

      {[
        { pos: BULB1, U: U1, I: I1, name: "лампа 1" },
        { pos: BULB2, U: U2, I: I2, name: "лампа 2" },
      ].map((b) => (
        <group key={b.name} position={b.pos}>
          <BulbSocket />
          <LightBulb position={[0, 0.12, 0]} brightness={Math.min(glow(b.U), 1.5)} />
          <SceneLabel position={[0, 1.2, 0]}>{`${b.name}: ${fmt(b.U)} В, ${fmt(b.U * b.I)} Вт`}</SceneLabel>
        </group>
      ))}

      {series ? (
        <>
          <Wire points={S1} color="#1f2937" />
          <Wire points={S2} color="#475569" />
          <Wire points={S3} color="#dc2626" />
          <CurrentFlow points={S1} count={20} speed={dotSpeed(Itotal) * k} />
          <CurrentFlow points={S2} count={10} speed={dotSpeed(Itotal) * k} />
          <CurrentFlow points={S3} count={20} speed={dotSpeed(Itotal) * k} />
        </>
      ) : (
        <>
          <Wire points={PT_MINUS} color="#1f2937" />
          <Wire points={PB1_MINUS} color="#1f2937" />
          <Wire points={PB2_MINUS} color="#1f2937" />
          <Wire points={PB1_PLUS} color="#dc2626" />
          <Wire points={PB2_PLUS} color="#dc2626" />
          <Wire points={PT_PLUS} color="#dc2626" />
          <CurrentFlow points={PT_MINUS} count={12} speed={dotSpeed(I1 + I2) * k} />
          <CurrentFlow points={PB1_MINUS} count={4} speed={dotSpeed(I1) * k} />
          <CurrentFlow points={PB2_MINUS} count={18} speed={dotSpeed(I2) * k} />
          <CurrentFlow points={PB1_PLUS} count={10} speed={dotSpeed(I1) * k} />
          <CurrentFlow points={PB2_PLUS} count={12} speed={dotSpeed(I2) * k} />
          <CurrentFlow points={PT_PLUS} count={3} speed={dotSpeed(I1 + I2) * k} />
        </>
      )}
    </>
  );
}

export function DcCircuitsOhmSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, V, R, R1, R2, topology } = useControls("Закон Ома для участка цепи", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Реостат и амперметр": "abstract", "Две лампочки: последовательно/параллельно": "bulbs" },
    },
    V: { value: 12, min: 1, max: 24, step: 1, label: "V, В (ЭДС батареи)" },
    R: { value: 6, min: 1, max: 20, step: 0.5, label: "R, Ом", render: (get) => get("Закон Ома для участка цепи.scenario") === "abstract" },
    topology: {
      value: "series",
      label: "Соединение",
      options: { "Последовательно": "series", "Параллельно": "parallel" },
      render: (get) => get("Закон Ома для участка цепи.scenario") === "bulbs",
    },
    R1: { value: 8, min: 2, max: 20, step: 1, label: "R лампы 1, Ом", render: (get) => get("Закон Ома для участка цепи.scenario") === "bulbs" },
    R2: { value: 8, min: 2, max: 20, step: 1, label: "R лампы 2, Ом", render: (get) => get("Закон Ома для участка цепи.scenario") === "bulbs" },
  });
  const bulbs = scenario === "bulbs";
  const series = topology === "series";

  const I = V / R;
  const P = I * I * R;

  const Rtotal = series ? R1 + R2 : (R1 * R2) / (R1 + R2);
  const Itotal = V / Rtotal;
  const I1 = series ? Itotal : V / R1;
  const I2 = series ? Itotal : V / R2;
  const P1 = I1 * I1 * R1;
  const P2 = I2 * I2 * R2;

  const curve = useMemo(() => {
    const pts: { R: number; I: number }[] = [];
    for (let i = 0; i <= 40; i++) {
      const rr = 1 + (20 - 1) * (i / 40);
      pts.push({ R: Number(rr.toFixed(2)), I: Number((V / rr).toFixed(3)) });
    }
    return pts;
  }, [V]);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
  }, [clock]);

  const fmt = (v: number, d = 1) => v.toFixed(d).replace(".", ",");
  const caption = bulbs ? (
    series ? (
      <>
        Лампы стоят <b>друг за другом</b>: один и тот же ток {fmt(Itotal, 2)} А идёт через обе, а напряжение {V} В делится между ними — поэтому каждая горит тускло. Выкрутите одну — погаснут обе: цепь
        разорвана.
      </>
    ) : (
      <>
        Каждая лампа подключена <b>прямо к источнику</b> и получает все {V} В — обе горят ярко и не зависят друг от друга. Общий ток складывается: {fmt(I1, 2)} + {fmt(I2, 2)} = {fmt(I1 + I2, 2)} А. Так
        соединены розетки и лампы в квартире.
      </>
    )
  ) : (
    <>
      Источник даёт {V} В. Ползунок реостата включает в цепь проволоку с сопротивлением <b>R = {fmt(R)} Ом</b>. Ток <b>I = V/R = {fmt(I, 2)} А</b> — его показывает амперметр, а скорость голубых
      «электронов» ему пропорциональна. Сдвиньте ползунок дальше (больше R) — ток упадёт. Проволока греется: P = I²R = {fmt(P)} Вт.
    </>
  );
  const legend: LegendItem[] = [
    { color: "#7dd3fc", label: "электроны (скорость ∝ току)", kind: "dot" },
    { color: "#dc2626", label: "провод к «+»", kind: "line" },
    { color: "#1f2937", label: "провод к «−»", kind: "line" },
  ];

  return (
    <SimShell
      scene={
        <SceneCanvas
          key={scenario}
          camera={bulbs ? { position: [0, 2.9, 4.5], fov: 50 } : { position: [0.2, 2.9, 5.5], fov: 50 }}
          orbitTarget={bulbs ? [0, 0.4, 0] : [0.2, 0.3, 0]}
          simplified={isMobile}
          maxDistance={18}
          minDistance={3}
          bloomThreshold={0.7}
          fogRange={[14, 40]}
        >
          {bulbs ? (
            <SceneBulbs key={clock.resetNonce} V={V} R1={R1} R2={R2} series={series} running={clock.running} speed={clock.speed} />
          ) : (
            <SceneRheostat key={clock.resetNonce} V={V} R={R} I={I} P={P} flowSpeed={clock.running ? dotSpeed(I) * clock.speed : 0} />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        bulbs ? (
          <NumberReadouts
            items={[
              { label: "Общий ток от батареи", value: (series ? Itotal : I1 + I2).toFixed(3), unit: "А" },
              { label: "Мощность лампы 1", value: P1.toFixed(2), unit: "Вт", color: "#facc15" },
              { label: "Мощность лампы 2", value: P2.toFixed(2), unit: "Вт", color: "#facc15" },
              { label: "Суммарная мощность", value: (P1 + P2).toFixed(2), unit: "Вт" },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "V (ЭДС)", value: V.toFixed(1), unit: "В" },
              { label: "R", value: R.toFixed(1), unit: "Ом" },
              { label: "I = V/R", value: I.toFixed(3), unit: "А", color: "#5eead4" },
              { label: "P = I²R", value: P.toFixed(2), unit: "Вт", color: "#f87171" },
            ]}
          />
        )
      }
      graphs={
        bulbs ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            При последовательном соединении обе лампы делят одно и то же напряжение батареи — каждая горит
            тусклее, чем в одиночку, а если одна перегорит, гаснут обе (цепь разрывается). При параллельном
            соединении каждая лампа получает полное напряжение батареи независимо от другой — обе горят ярко,
            как будто включены поодиночке, а перегорание одной не влияет на вторую.
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">I(R) при постоянном V — закон Ома</p>
            <LiveChart data={curve} xKey="R" xType="number" xLabel="R, Ом" series={[{ key: "I", color: "#5eead4", label: "I, А" }]} />
          </div>
        )
      }
      note={
        bulbs ? (
          <>
            Последовательно: R_общ=R₁+R₂, ток один и тот же через обе лампы, но напряжение и мощность на каждой
            меньше, чем при одиночном включении. Параллельно: 1/R_общ=1/R₁+1/R₂, каждая лампа получает полное
            напряжение батареи V, а общий ток от батареи — сумма токов через каждую лампу. Именно поэтому
            в квартирной проводке розетки соединены параллельно.
          </>
        ) : (
          <>
            Закон Ома для участка цепи: I=V/R. Голубые точки — электроны: они выходят из «−» источника и
            возвращаются в «+», их скорость на экране пропорциональна току I. Реостат — это длинная проволока на
            керамической трубке: ползунок меняет, какая её часть включена в цепь, то есть меняет R. Рабочая часть
            проволоки греется тем сильнее, чем больше мощность P=I²R.
          </>
        )
      }
    />
  );
}
