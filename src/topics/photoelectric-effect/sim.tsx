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
import { Wire } from "@/components/sim/props/electric";
import { CurrentFlow, Meter } from "@/components/sim/props/circuit";
import { Ground, LabBench } from "@/components/sim/props/environment";
import { Sun } from "@/components/sim/props/space";
import { wavelengthToColor } from "@/components/sim/props/shared";
import { canvasTexture } from "@/components/sim/props/textures";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const H_EV = 4.1357e-15; // eV*s
const PERIOD = 3;
const N_PHOTONS = 8;

const METALS: Record<string, number> = { "Натрий (2.3 эВ)": 2.3, "Цинк (4.3 эВ)": 4.3, "Медь (4.7 эВ)": 4.7 };
const CELLS: Record<string, number> = { "Кремний (1.1 эВ)": 1.1, "CdTe (1.5 эВ)": 1.5, "GaAs (1.4 эВ)": 1.4 };

/** Colour of a photon of frequency f (PHz): its real colour if visible, dark red for IR, violet for UV. */
function photonColor(freqPHz: number) {
  const nm = 299.79 / freqPHz;
  if (nm > 750) return { hex: "#7f1d1d", band: "инфракрасный (невидимый)" };
  if (nm < 380) return { hex: "#a855f7", band: "ультрафиолет (невидимый)" };
  return { hex: wavelengthToColor(nm), band: "видимый свет" };
}

interface Particle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

interface SceneContentProps {
  freqPHz: number;
  W: number;
  intensity: number;
  running: boolean;
  speed: number;
  onLive: (n: { KE: number; ejects: boolean }) => void;
}

/* ---------- vacuum photocell: lamp → glass bulb with a metal cathode → microammeter ---------- */
const BULB: THREE.Vector3Tuple = [0.6, 1.25, 0];
const CATHODE_X = 1.25;
const ANODE_X = 0.45;
const LAMP_X = -2.6;

function SceneContent({ freqPHz, W, intensity, running, speed, onLive }: SceneContentProps) {
  const photonRefs = useRef<(THREE.Mesh | null)[]>([]);
  const electronRefs = useRef<(THREE.Mesh | null)[]>([]);
  const electrons = useRef<Particle[]>(Array.from({ length: N_PHOTONS }, () => ({ active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 })));
  const fired = useRef<boolean[]>(Array(N_PHOTONS).fill(false));
  const meter = useRef(0);
  const flow = useRef(0);
  const KE = H_EV * freqPHz * 1e15 - W;
  const ejects = KE > 0;
  const color = photonColor(freqPHz).hex;
  const offsets = useMemo(() => Array.from({ length: N_PHOTONS }, (_, i) => ({ y: Math.sin(i * 2.1) * 0.28, z: Math.cos(i * 1.7) * 0.32 })), []);

  const handleFrame = useCallback(
    (t: number, dt: number) => {
      const rate = Math.max(intensity, 0.1);
      const cycle = PERIOD / rate;
      for (let i = 0; i < N_PHOTONS; i++) {
        const frac = ((t + (i / N_PHOTONS) * cycle) % cycle) / cycle;
        const x = LAMP_X + 0.4 + frac * (CATHODE_X - LAMP_X - 0.45);
        const p = photonRefs.current[i];
        if (p) {
          p.visible = frac < 0.97;
          p.position.set(x, BULB[1] + offsets[i].y, offsets[i].z);
        }
        const e = electrons.current[i];
        if (frac > 0.96 && !fired.current[i]) {
          fired.current[i] = true;
          if (ejects) {
            // the photon gives all its energy to one electron: it flies out with KE = hf − W
            e.active = true;
            e.x = CATHODE_X - 0.05;
            e.y = BULB[1] + offsets[i].y;
            e.z = offsets[i].z;
            const v = 0.5 + Math.sqrt(KE) * 0.9;
            e.vx = -v;
            e.vy = (Math.random() - 0.5) * 0.4;
            e.vz = (Math.random() - 0.5) * 0.4;
          }
        }
        if (frac < 0.5) fired.current[i] = false;
        if (e.active) {
          e.vx -= 0.8 * dt; // the positive anode pulls the electrons
          e.x += e.vx * dt;
          e.y += e.vy * dt;
          e.z += e.vz * dt;
          if (e.x < ANODE_X) e.active = false;
        }
        const em = electronRefs.current[i];
        if (em) {
          em.visible = e.active;
          em.position.set(e.x, e.y, e.z);
        }
      }
      const current = ejects ? Math.min(intensity / 3, 1) : 0;
      meter.current = current * 0.9;
      flow.current = current * 2.2 * speed;
    },
    [intensity, ejects, KE, offsets, speed],
  );

  const wireA: THREE.Vector3Tuple[] = [[CATHODE_X, 0.45, 0], [1.4, 0.04, 0.6], [0.75, 0.04, 1.45], [0.45, 0.04, 1.56]];
  const wireB: THREE.Vector3Tuple[] = [[0.15, 0.04, 1.56], [-0.1, 0.04, 1.3], [ANODE_X, 0.04, 0.4], [ANODE_X, 0.45, 0]];

  return (
    <>
      <PhysicsTicker running={running} speed={speed} onFrame={handleFrame} sampleHz={5} onSample={() => onLive({ KE, ejects })} />
      <LabBench position={[-0.6, -0.9, 0.3]} length={6} depth={3} height={0.9} />

      {/* lamp with a colour filter */}
      <group position={[LAMP_X, BULB[1], 0]}>
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.32, 0.4, 0.7, 24]} />
          <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.4} />
        </mesh>
        <mesh position={[0.36, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
          <circleGeometry args={[0.3, 28]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
        <mesh position={[0, -(BULB[1] / 2) - 0.1, 0]}>
          <cylinderGeometry args={[0.05, 0.05, BULB[1] - 0.2, 10]} />
          <meshStandardMaterial color="#52525b" />
        </mesh>
        <SceneLabel position={[0, 0.65, 0]}>{`лампа: ${photonColor(freqPHz).band}`}</SceneLabel>
      </group>

      {/* glass vacuum bulb with a cathode plate and an anode rod */}
      <mesh position={BULB}>
        <sphereGeometry args={[0.95, 40, 28]} />
        <meshStandardMaterial color="#e0f2fe" transparent opacity={0.16} roughness={0.05} depthWrite={false} />
      </mesh>
      <mesh position={[BULB[0], 0.18, 0]}>
        <cylinderGeometry args={[0.35, 0.42, 0.36, 24]} />
        <meshStandardMaterial color="#1f2937" roughness={0.5} />
      </mesh>
      {/* curved cathode facing the anode */}
      <mesh position={[ANODE_X, BULB[1], 0]}>
        <cylinderGeometry args={[CATHODE_X - ANODE_X, CATHODE_X - ANODE_X, 0.9, 24, 1, true, Math.PI / 4, Math.PI / 2]} />
        <meshStandardMaterial color="#a1a1aa" metalness={0.85} roughness={0.25} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[ANODE_X, BULB[1], 0]}>
        <cylinderGeometry args={[0.025, 0.025, 1.0, 8]} />
        <meshStandardMaterial color="#d4d4d8" metalness={0.9} roughness={0.2} />
      </mesh>
      <SceneLabel position={[BULB[0], BULB[1] + 1.25, 0]}>фотоэлемент: в колбе вакуум</SceneLabel>
      <SceneLabel position={[CATHODE_X + 0.55, BULB[1] - 0.6, 0.4]}>катод (металл)</SceneLabel>
      <SceneLabel position={[ANODE_X - 0.25, BULB[1] - 0.65, 0.35]}>анод</SceneLabel>

      {Array.from({ length: N_PHOTONS }, (_, i) => (
        <mesh
          key={`p${i}`}
          ref={(el) => {
            photonRefs.current[i] = el;
          }}
        >
          <sphereGeometry args={[0.065, 12, 10]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
      ))}
      {Array.from({ length: N_PHOTONS }, (_, i) => (
        <mesh
          key={`e${i}`}
          ref={(el) => {
            electronRefs.current[i] = el;
          }}
          visible={false}
        >
          <sphereGeometry args={[0.055, 10, 8]} />
          <meshBasicMaterial color="#38bdf8" toneMapped={false} />
        </mesh>
      ))}

      <Meter position={[0.3, 0.23, 1.45]} letter="мкА" valueRef={meter} />
      <SceneLabel position={[0.3, 0.7, 1.45]}>микроамперметр</SceneLabel>
      <Wire points={wireA} color="#1f2937" radius={0.02} />
      <Wire points={wireB} color="#dc2626" radius={0.02} />
      <CurrentFlow points={wireB} count={6} speedRef={flow} radius={0.032} />
      <CurrentFlow points={wireA} count={6} speedRef={flow} radius={0.032} />
    </>
  );
}

/* ---------- solar panel driving a small fan ---------- */
function panelTexture() {
  return canvasTexture("solar-panel", 512, 340, (ctx, w, h) => {
    ctx.fillStyle = "#cbd5e1";
    ctx.fillRect(0, 0, w, h);
    const cols = 6;
    const rows = 4;
    const cw = (w - 20) / cols;
    const ch = (h - 20) / rows;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x = 10 + i * cw;
        const y = 10 + j * ch;
        const g = ctx.createLinearGradient(x, y, x + cw, y + ch);
        g.addColorStop(0, "#1e3a8a");
        g.addColorStop(1, "#172554");
        ctx.fillStyle = g;
        ctx.fillRect(x + 3, y + 3, cw - 6, ch - 6);
        ctx.strokeStyle = "rgba(203,213,225,0.55)";
        ctx.lineWidth = 1;
        for (let k = 1; k < 4; k++) {
          ctx.beginPath();
          ctx.moveTo(x + 3, y + (k * ch) / 4);
          ctx.lineTo(x + cw - 3, y + (k * ch) / 4);
          ctx.stroke();
        }
      }
    }
  });
}

const PANEL_POS: THREE.Vector3Tuple = [0, 1.0, 0];
const PANEL_TILT = -0.6;

function SceneSolar({ freqPHz, W, intensity, running, speed, onLive }: SceneContentProps) {
  const photonRefs = useRef<(THREE.Mesh | null)[]>([]);
  const fan = useRef<THREE.Group>(null!);
  const flow = useRef(0);
  const KE = H_EV * freqPHz * 1e15 - W;
  const ejects = KE > 0;
  const color = photonColor(freqPHz).hex;
  const tex = useMemo(() => panelTexture(), []);
  const sunPos = useMemo(() => new THREE.Vector3(-5, 6.5, -3), []);
  const targets = useMemo(() => Array.from({ length: N_PHOTONS }, (_, i) => new THREE.Vector3(PANEL_POS[0] + Math.sin(i * 2.3) * 0.9, PANEL_POS[1] + 0.05, Math.cos(i * 1.9) * 0.55)), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  const handleFrame = useCallback(
    (t: number, dt: number) => {
      const rate = Math.max(intensity, 0.1);
      const cycle = PERIOD / rate;
      for (let i = 0; i < N_PHOTONS; i++) {
        const frac = ((t + (i / N_PHOTONS) * cycle) % cycle) / cycle;
        const p = photonRefs.current[i];
        if (p) {
          tmp.copy(sunPos).lerp(targets[i], Math.min(frac * 1.05, 1));
          p.position.copy(tmp);
          p.visible = frac < 0.95;
        }
      }
      const current = ejects ? Math.min(intensity / 3, 1) : 0;
      if (fan.current) fan.current.rotation.x += current * 14 * dt;
      flow.current = current * 2.2 * speed;
    },
    [intensity, ejects, sunPos, targets, tmp, speed],
  );

  const wire: THREE.Vector3Tuple[] = [[0.9, 0.55, 0.3], [1.5, 0.04, 0.9], [2.4, 0.04, 0.9], [2.6, 0.5, 0.3]];
  const wire2: THREE.Vector3Tuple[] = [[2.6, 0.5, 0.15], [2.3, 0.04, 0.6], [1.4, 0.04, 0.6], [0.9, 0.55, 0.1]];
  return (
    <>
      <PhysicsTicker running={running} speed={speed} onFrame={handleFrame} sampleHz={5} onSample={() => onLive({ KE, ejects })} />
      <Ground kind="grass" from={-12} to={12} width={16} tile={4} tileZ={4} />
      <Sun position={sunPos.toArray()} radius={0.7} />

      {/* the panel on a frame, tilted toward the sun */}
      <group position={PANEL_POS} rotation={[0, 0, PANEL_TILT * -0.6]}>
        <group rotation={[PANEL_TILT, 0, 0]}>
          <mesh castShadow>
            <boxGeometry args={[2.4, 0.06, 1.6]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.6} roughness={0.4} />
          </mesh>
          <mesh position={[0, 0.032, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[2.36, 1.56]} />
            <meshStandardMaterial map={tex} metalness={0.4} roughness={0.25} />
          </mesh>
        </group>
      </group>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 1.0, 0.45, 0]}>
          <cylinderGeometry args={[0.04, 0.04, 0.9, 10]} />
          <meshStandardMaterial color="#64748b" metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
      <SceneLabel position={[0, 2.0, 0]}>солнечная панель (полупроводник)</SceneLabel>

      {Array.from({ length: N_PHOTONS }, (_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            photonRefs.current[i] = el;
          }}
        >
          <sphereGeometry args={[0.07, 12, 10]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
      ))}

      {/* a small fan run by the photocurrent */}
      <group position={[2.8, 0, 0.2]}>
        <mesh position={[0, 0.25, 0]}>
          <cylinderGeometry args={[0.18, 0.22, 0.5, 16]} />
          <meshStandardMaterial color="#e5e7eb" roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.62, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.1, 0.1, 0.25, 16]} />
          <meshStandardMaterial color="#334155" />
        </mesh>
        <group ref={fan} position={[-0.16, 0.62, 0]}>
          {[0, 1, 2].map((k) => (
            <mesh key={k} rotation={[(k * 2 * Math.PI) / 3, 0, 0]} position={[0, 0, 0]}>
              <boxGeometry args={[0.02, 0.5, 0.14]} />
              <meshStandardMaterial color="#38bdf8" />
            </mesh>
          ))}
        </group>
        <SceneLabel position={[0, 1.15, 0]}>{ejects ? "вентилятор крутится: есть ток" : "вентилятор стоит: тока нет"}</SceneLabel>
      </group>
      <Wire points={wire} color="#dc2626" radius={0.02} />
      <Wire points={wire2} color="#1f2937" radius={0.02} />
      <CurrentFlow points={wire2} count={7} speedRef={flow} radius={0.032} />
      <CurrentFlow points={wire} count={7} speedRef={flow} radius={0.032} />
    </>
  );
}

export function PhotoelectricEffectSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, metal, cell, freqPHz, intensity } = useControls("Фотоэффект", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Фотоэлемент: лампа и металл в колбе": "abstract", "Солнечная панель и вентилятор": "solar" },
    },
    metal: { value: "Цинк (4.3 эВ)", options: Object.keys(METALS), label: "Металл", render: (get) => get("Фотоэффект.scenario") === "abstract" },
    cell: { value: "Кремний (1.1 эВ)", options: Object.keys(CELLS), label: "Материал панели", render: (get) => get("Фотоэффект.scenario") === "solar" },
    freqPHz: { value: 1.2, min: 0.3, max: 2.5, step: 0.05, label: "f света, ПГц (10¹⁵ Гц)" },
    intensity: { value: 1, min: 0.3, max: 3, step: 0.1, label: "Интенсивность (частота фотонов)" },
  });
  const isSolar = scenario === "solar";
  const W = isSolar ? CELLS[cell] : METALS[metal];

  const curve = useMemo(() => {
    const pts: { f: number; KE: number }[] = [];
    for (let i = 0; i <= 40; i++) {
      const f = 0.2 + (2.5 - 0.2) * (i / 40);
      const KE = Math.max(H_EV * f * 1e15 - W, 0);
      pts.push({ f: Number(f.toFixed(2)), KE: Number(KE.toFixed(2)) });
    }
    return pts;
  }, [W]);

  const f0 = W / H_EV / 1e15;
  const Ephoton = H_EV * freqPHz * 1e15;
  const ejects = Ephoton > W;

  const [live, setLive] = useState({ KE: 0, ejects: false });

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
  }, [clock]);

  const fmt = (v: number, d = 2) => v.toFixed(d).replace(".", ",");
  const caption = isSolar ? (
    ejects ? (
      <>
        Каждый фотон ({fmt(Ephoton)} эВ) сильнее, чем нужно полупроводнику ({fmt(W)} эВ): он выбивает электрон, и по проводам идёт <b>ток</b> — вентилятор крутится. Ярче свет — больше фотонов —
        сильнее ток.
      </>
    ) : (
      <>
        Фотоны слишком «слабые» ({fmt(Ephoton)} эВ меньше {fmt(W)} эВ): ни один не выбивает электрон, <b>тока нет</b>, сколько бы света ни падало. Увеличьте частоту.
      </>
    )
  ) : ejects ? (
    <>
      Свет — это поток порций-фотонов. Каждый фотон отдаёт всю энергию hf = {fmt(Ephoton)} эВ одному электрону: {fmt(W)} эВ уходит на «вырывание» из металла (работа выхода), остаток — скорость: KE ={" "}
      {fmt(Ephoton - W)} эВ. Электроны летят к аноду, и <b>амперметр показывает ток</b>.
    </>
  ) : (
    <>
      Энергии фотона hf = {fmt(Ephoton)} эВ <b>не хватает</b>, чтобы вырвать электрон (нужно {fmt(W)} эВ). Даже очень яркий свет такой частоты ничего не выбьет — ток ноль. Это и доказало, что свет состоит
      из порций.
    </>
  );
  const legend: LegendItem[] = [
    { color: photonColor(freqPHz).hex, label: "фотоны света", kind: "dot" },
    { color: "#38bdf8", label: "электроны", kind: "dot" },
  ];

  return (
    <SimShell
      scene={
        <SceneCanvas
          key={scenario}
          camera={isSolar ? { position: [1.6, 3.4, 6.4] as [number, number, number], fov: 50 } : { position: [-0.2, 2.4, 5.4] as [number, number, number], fov: 50 }}
          orbitTarget={isSolar ? [0.6, 1.2, 0] : [-0.4, 1.0, 0.2]}
          simplified={isMobile}
          maxDistance={18}
          minDistance={3}
          bloomThreshold={0.7}
          fogRange={[16, 45]}
        >
          {isSolar ? (
            <SceneSolar key={clock.resetNonce} freqPHz={freqPHz} W={W} intensity={intensity} running={clock.running} speed={clock.speed} onLive={setLive} />
          ) : (
            <SceneContent key={clock.resetNonce} freqPHz={freqPHz} W={W} intensity={intensity} running={clock.running} speed={clock.speed} onLive={setLive} />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        isSolar ? (
          <NumberReadouts
            items={[
              { label: "Ширина запрещённой зоны E_g", value: W.toFixed(2), unit: "эВ" },
              { label: "Пороговая частота f₀=E_g/h", value: f0.toFixed(2), unit: "ПГц" },
              { label: "E фотона = hf", value: Ephoton.toFixed(2), unit: "эВ" },
              { label: "Фототок", value: live.ejects ? "есть" : "нет (f<f₀, фотон не пробивает зазор)", color: live.ejects ? "#4ade80" : "#f87171" },
              { label: "Избыточная энергия (в тепло)", value: live.KE.toFixed(2), unit: "эВ" },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "Работа выхода W", value: W.toFixed(2), unit: "эВ" },
              { label: "Пороговая частота f₀=W/h", value: f0.toFixed(2), unit: "ПГц" },
              { label: "E фотона = hf", value: Ephoton.toFixed(2), unit: "эВ" },
              { label: "KE_max = hf−W", value: live.KE.toFixed(2), unit: "эВ", color: live.ejects ? "#4ade80" : "#f87171" },
              { label: "Электроны вылетают?", value: live.ejects ? "да" : "нет (f<f₀)" },
            ]}
          />
        )
      }
      graphs={
        <div className="rounded-xl border border-border bg-surface-2/60 p-3">
          <p className="mb-1 px-1 text-xs font-medium text-muted-2">KE_max(f) — уравнение Эйнштейна для фотоэффекта</p>
          <LiveChart data={curve} xKey="f" xType="number" xLabel="f, ПГц" series={[{ key: "KE", color: "#4ade80", label: "KE_max, эВ" }]} />
        </div>
      }
      note={
        isSolar ? (
          <>
            В солнечной панели работает тот же квантовый принцип: фотон должен нести энергию не меньше
            ширины запрещённой зоны полупроводника E_g, чтобы выбить электрон в зону проводимости и создать
            ток. Именно поэтому спектральный состав света важен: инфракрасные фотоны низкой частоты
            (f&lt;f₀) вообще не создают тока, сколько бы их ни падало, а ультрафиолетовые с избытком энергии
            всё равно создают лишь один электрон — избыток энергии просто уходит в тепло.
          </>
        ) : (
          <>
            Уравнение Эйнштейна: KE_max=hf−W. Электрон вылетает только если частота света f выше пороговой
            f₀=W/h — интенсивность света влияет на ЧИСЛО вылетающих электронов (частоту фотонов на сцене), но
            не на их максимальную кинетическую энергию, что противоречит классической волновой теории и
            доказывает квантовую (фотонную) природу света. Цвет лампы — настоящий цвет света этой частоты.
          </>
        )
      }
    />
  );
}
