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
import { Ground } from "@/components/sim/props/environment";
import { wavelengthToColor } from "@/components/sim/props/shared";
import { badgeTexture, canvasTexture } from "@/components/sim/props/textures";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const ELEMENTS = [
  { name: "Неон (вывески)", lambdaNm: 640, hex: "#fb7040", use: "неоновые вывески" },
  { name: "Натрий (уличные фонари)", lambdaNm: 589, hex: "#ffcf3d", use: "старые жёлтые уличные фонари" },
  { name: "Водород (Hα)", lambdaNm: 656, hex: "#ff4d4d", use: "туманности, спектр Солнца" },
  { name: "Стронций (фейерверк, красный)", lambdaNm: 641, hex: "#ff3b5c", use: "красные фейерверки" },
  { name: "Медь (фейерверк, сине-зелёный)", lambdaNm: 505, hex: "#3ddc97", use: "сине-зелёные фейерверки" },
  { name: "Барий (фейерверк, зелёный)", lambdaNm: 524, hex: "#5ee06a", use: "зелёные фейерверки" },
];

const CYCLE_T = 6;
const ORBIT_SPEED = 1.4;

function rVis(n: number) {
  return 0.35 + 0.1 * n * n;
}
function En(n: number) {
  return -13.6 / (n * n);
}

/** Colour of a photon of wavelength λ (nm); invisible bands get a conventional colour. */
function photonLook(nm: number) {
  if (nm < 380) return { hex: "#a855f7", band: "ультрафиолет (невидим)" };
  if (nm > 750) return { hex: "#7f1d1d", band: "инфракрасный (невидим)" };
  return { hex: wavelengthToColor(nm), band: "видимый свет" };
}

/** Dark spectrum strip 380–750 nm with bright emission lines. */
function lineSpectrum(lines: { nm: number; strong?: boolean }[], key: string) {
  return canvasTexture(`spectrum-${key}`, 512, 48, (ctx, w, h) => {
    ctx.fillStyle = "#050507";
    ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x++) {
      const nm = 380 + (370 * x) / (w - 1);
      ctx.fillStyle = wavelengthToColor(nm);
      ctx.globalAlpha = 0.12;
      ctx.fillRect(x, 0, 1, h);
    }
    ctx.globalAlpha = 1;
    for (const l of lines) {
      if (l.nm < 380 || l.nm > 750) continue;
      const x = ((l.nm - 380) / 370) * (w - 1);
      ctx.fillStyle = wavelengthToColor(l.nm);
      ctx.fillRect(x - (l.strong ? 3 : 2), 0, l.strong ? 6 : 4, h);
    }
  });
}

interface LiveNumbers {
  t: number;
  n: number;
  phase: string;
}

interface SceneContentProps {
  nI: number;
  nF: number;
  running: boolean;
  speed: number;
  onLive: (n: LiveNumbers) => void;
}

const LADDER_X = 4.6;
const LADDER_Y0 = 0.2;
const LADDER_H = 3.2;
const levelY = (n: number) => LADDER_Y0 + LADDER_H * (1 + En(n) / 13.6);

function phaseAt(t: number, nI: number, nF: number) {
  const frac = (t % CYCLE_T) / CYCLE_T;
  if (frac < 0.45) return { n: nI, phase: "orbit-i", frac };
  if (frac < 0.5) return { n: nF, phase: "emit", frac };
  if (frac < 0.95) return { n: nF, phase: "orbit-f", frac };
  return { n: nI, phase: "absorb", frac };
}

/* ---------- the hydrogen atom (magnified), its energy ladder, a discharge tube and a spectroscope ---------- */
function SceneContent({ nI, nF, running, speed, onLive }: SceneContentProps) {
  const electronRef = useRef<THREE.Mesh>(null!);
  const photonOutRef = useRef<THREE.Group>(null!);
  const photonInRef = useRef<THREE.Group>(null!);
  const ladderDot = useRef<THREE.Mesh>(null!);
  const angleRef = useRef(0);
  const lambda = 1240 / (En(nI) - En(nF));
  const look = photonLook(lambda);
  const pTex = useMemo(() => badgeTexture("+", "#dc2626"), []);
  const balmer = useMemo(() => [3, 4, 5, 6].map((n) => ({ nm: 1240 / (En(n) - En(2)), strong: n === nI && nF === 2 })), [nI, nF]);
  const spectrum = useMemo(() => lineSpectrum(balmer, `h-${nI}-${nF}`), [balmer, nI, nF]);

  const handleFrame = useCallback(
    (t: number, dt: number) => {
      const { n, frac } = phaseAt(t, nI, nF);
      angleRef.current += ORBIT_SPEED * dt * (6 / (n * n) + 0.3);
      const r = rVis(n);
      if (electronRef.current) electronRef.current.position.set(r * Math.cos(angleRef.current), 1.6, r * Math.sin(angleRef.current));
      if (ladderDot.current) ladderDot.current.position.y = levelY(n);

      if (photonOutRef.current) {
        const active = frac >= 0.45 && frac < 0.7;
        photonOutRef.current.visible = active;
        if (active) {
          const pf = (frac - 0.45) / 0.25;
          const rr = rVis(nF) + pf * 3.2;
          photonOutRef.current.position.set(rr * Math.cos(angleRef.current), 1.6, rr * Math.sin(angleRef.current));
        }
      }
      if (photonInRef.current) {
        const active = frac >= 0.78 && frac < 1;
        photonInRef.current.visible = active;
        if (active) {
          const pf = (frac - 0.78) / 0.22;
          const rr = rVis(nI) + (1 - pf) * 3.2;
          photonInRef.current.position.set(rr * Math.cos(-angleRef.current), 1.6, rr * Math.sin(-angleRef.current));
        }
      }
    },
    [nI, nF],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={12}
        onSample={(t) => {
          const { n, phase } = phaseAt(t, nI, nF);
          onLive({ t, n, phase });
        }}
      />

      {/* nucleus (a proton) and the allowed orbits */}
      <mesh position={[0, 1.6, 0]}>
        <sphereGeometry args={[0.16, 20, 20]} />
        <meshStandardMaterial color="#dc2626" emissive="#dc2626" emissiveIntensity={0.6} />
      </mesh>
      <sprite position={[0, 1.6, 0]} scale={0.2} renderOrder={2}>
        <spriteMaterial map={pTex} depthTest={false} transparent />
      </sprite>
      {[1, 2, 3, 4, 5, 6].map((n) => (
        <mesh key={n} position={[0, 1.6, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[rVis(n) - 0.008, rVis(n) + 0.008, 96]} />
          <meshBasicMaterial color={n === nI || n === nF ? "#5eead4" : "#52525b"} transparent opacity={n === nI || n === nF ? 0.8 : 0.35} side={THREE.DoubleSide} />
        </mesh>
      ))}
      <SceneLabel position={[0, 2.25, 0]}>атом водорода (увеличен в миллиарды раз)</SceneLabel>
      <mesh ref={electronRef}>
        <sphereGeometry args={[0.09, 16, 16]} />
        <meshBasicMaterial color="#38bdf8" toneMapped={false} />
      </mesh>
      <group ref={photonOutRef} visible={false}>
        <mesh>
          <sphereGeometry args={[0.1, 14, 12]} />
          <meshBasicMaterial color={look.hex} toneMapped={false} />
        </mesh>
        <SceneLabel position={[0, 0.3, 0]}>{`фотон ${lambda.toFixed(0)} нм`}</SceneLabel>
      </group>
      <group ref={photonInRef} visible={false}>
        <mesh>
          <sphereGeometry args={[0.1, 14, 12]} />
          <meshBasicMaterial color={look.hex} toneMapped={false} transparent opacity={0.8} />
        </mesh>
        <SceneLabel position={[0, 0.3, 0]}>поглощается такой же фотон</SceneLabel>
      </group>

      {/* energy ladder: higher step = higher energy */}
      <group>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <group key={n} position={[LADDER_X, levelY(n), 0]}>
            <mesh>
              <boxGeometry args={[1.0, 0.025, 0.025]} />
              <meshBasicMaterial color={n === nI || n === nF ? "#5eead4" : "#71717a"} />
            </mesh>
            {n <= 4 && <SceneLabel position={[0.85, 0, 0]}>{`n=${n}: ${En(n).toFixed(2).replace(".", ",")} эВ`}</SceneLabel>}
          </group>
        ))}
        <mesh position={[LADDER_X - 0.15, (levelY(nI) + levelY(nF)) / 2, 0]}>
          <boxGeometry args={[0.04, Math.abs(levelY(nI) - levelY(nF)), 0.04]} />
          <meshBasicMaterial color={look.hex} toneMapped={false} />
        </mesh>
        <mesh position={[LADDER_X - 0.15, levelY(nF) + 0.07, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.08, 0.16, 12]} />
          <meshBasicMaterial color={look.hex} toneMapped={false} />
        </mesh>
        <mesh ref={ladderDot} position={[LADDER_X + 0.25, levelY(nI), 0]}>
          <sphereGeometry args={[0.07, 12, 10]} />
          <meshBasicMaterial color="#38bdf8" toneMapped={false} />
        </mesh>
        <SceneLabel position={[LADDER_X, LADDER_Y0 + LADDER_H + 0.45, 0]}>лестница уровней энергии</SceneLabel>
      </group>

      {/* hydrogen discharge tube and a spectroscope with its lines */}
      <group position={[-3.1, 0, 0.4]}>
        <mesh position={[0, 1.4, 0]}>
          <cylinderGeometry args={[0.07, 0.07, 1.6, 16]} />
          <meshStandardMaterial color="#f9a8d4" emissive="#f472b6" emissiveIntensity={1.6} transparent opacity={0.85} toneMapped={false} />
        </mesh>
        {[0.55, 2.25].map((y) => (
          <mesh key={y} position={[0, y, 0]}>
            <cylinderGeometry args={[0.12, 0.12, 0.18, 16]} />
            <meshStandardMaterial color="#71717a" metalness={0.7} roughness={0.35} />
          </mesh>
        ))}
        <pointLight position={[0.3, 1.4, 0.3]} color="#f472b6" intensity={2} distance={3} />
        <SceneLabel position={[0, 2.65, 0]}>трубка с водородом светится</SceneLabel>
      </group>
      <group position={[-1.3, 0.45, 2.0]}>
        <mesh>
          <boxGeometry args={[2.3, 0.42, 0.06]} />
          <meshStandardMaterial color="#1f2937" />
        </mesh>
        <mesh position={[0, 0, 0.032]}>
          <planeGeometry args={[2.15, 0.28]} />
          <meshBasicMaterial map={spectrum} toneMapped={false} />
        </mesh>
        <SceneLabel position={[0, 0.42, 0]}>спектроскоп: линии водорода</SceneLabel>
      </group>
      <Ground kind="tiles" from={-6} to={6} width={8} tile={2} tileZ={2} y={-0.01} />
    </>
  );
}

/* ---------- where the "fingerprint" colours are seen in life ---------- */
function signTexture(hex: string) {
  return canvasTexture(`neon-sign-${hex}`, 512, 160, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.font = "bold 110px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = hex;
    ctx.shadowBlur = 30;
    ctx.strokeStyle = hex;
    ctx.lineWidth = 10;
    ctx.strokeText("КАФЕ", w / 2, h / 2 + 6);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#fff7ed";
    ctx.lineWidth = 3;
    ctx.strokeText("КАФЕ", w / 2, h / 2 + 6);
  });
}

function Fireworks({ hex, running, speed }: { hex: string; running: boolean; speed: number }) {
  const N = 90;
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const dirs = useMemo(
    () =>
      Array.from({ length: N }, (_, i) => {
        const u = (i + 0.5) / N;
        const th = Math.acos(1 - 2 * u);
        const ph = i * 2.39996;
        return new THREE.Vector3(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
      }),
    [],
  );
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const handleFrame = useCallback(
    (t: number) => {
      const m = mesh.current;
      if (!m) return;
      const u = (t % 3) / 3;
      const r = 2.4 * (1 - Math.exp(-u * 4));
      const fall = u * u * 1.2;
      dirs.forEach((d, i) => {
        dummy.position.set(d.x * r, 4.2 + d.y * r - fall, d.z * r);
        dummy.scale.setScalar(u < 0.85 ? 1 - u * 0.6 : (1 - u) * 3);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
      });
      m.instanceMatrix.needsUpdate = true;
    },
    [dirs, dummy],
  );
  return (
    <>
      <PhysicsTicker running={running} speed={speed} onFrame={handleFrame} />
      <instancedMesh ref={mesh} args={[undefined, undefined, N]} frustumCulled={false}>
        <sphereGeometry args={[0.06, 8, 6]} />
        <meshBasicMaterial color={hex} toneMapped={false} />
      </instancedMesh>
      <pointLight position={[0, 4.2, 0]} color={hex} intensity={6} distance={12} />
    </>
  );
}

function SceneSpectra({ elIdx, running, speed }: { elIdx: number; running: boolean; speed: number }) {
  const el = ELEMENTS[elIdx];
  const spectrum = useMemo(() => lineSpectrum([{ nm: el.lambdaNm, strong: true }], `el-${elIdx}`), [el.lambdaNm, elIdx]);
  const sign = useMemo(() => signTexture(el.hex), [el.hex]);
  const kind = elIdx === 0 ? "neon" : elIdx === 1 ? "lamp" : elIdx === 2 ? "tube" : "fireworks";

  return (
    <>
      <Ground kind={kind === "lamp" ? "asphalt" : "concrete"} from={-8} to={8} width={10} tile={3} tileZ={3} />
      {kind === "neon" && (
        <group position={[0, 2.2, -1.2]}>
          <mesh>
            <boxGeometry args={[4.6, 2.4, 0.1]} />
            <meshStandardMaterial color="#3f3f46" roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.1, 0.06]}>
            <planeGeometry args={[4.0, 1.25]} />
            <meshBasicMaterial map={sign} transparent toneMapped={false} />
          </mesh>
          <pointLight position={[0, 0.1, 0.8]} color={el.hex} intensity={5} distance={6} />
          <SceneLabel position={[0, 1.55, 0]}>неоновая вывеска</SceneLabel>
        </group>
      )}
      {kind === "lamp" && (
        <group position={[0, 0, -0.6]}>
          <mesh position={[0, 2.2, 0]}>
            <cylinderGeometry args={[0.07, 0.1, 4.4, 12]} />
            <meshStandardMaterial color="#3f3f46" metalness={0.6} roughness={0.4} />
          </mesh>
          <mesh position={[0.6, 4.3, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.05, 0.05, 1.2, 10]} />
            <meshStandardMaterial color="#3f3f46" metalness={0.6} roughness={0.4} />
          </mesh>
          <mesh position={[1.2, 4.15, 0]}>
            <cylinderGeometry args={[0.15, 0.35, 0.25, 20]} />
            <meshStandardMaterial color="#27272a" />
          </mesh>
          <mesh position={[1.2, 4.0, 0]}>
            <sphereGeometry args={[0.18, 16, 12]} />
            <meshBasicMaterial color={el.hex} toneMapped={false} />
          </mesh>
          <spotLight position={[1.2, 3.95, 0]} angle={0.7} penumbra={0.6} color={el.hex} intensity={60} distance={9} />
          <SceneLabel position={[1.2, 4.75, 0]}>натриевый фонарь</SceneLabel>
        </group>
      )}
      {kind === "tube" && (
        <group position={[0, 0, 0]}>
          <mesh position={[0, 1.5, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.3, 0.3, 2.4, 24, 1, true]} />
            <meshStandardMaterial color={el.hex} emissive={el.hex} emissiveIntensity={1.4} transparent opacity={0.55} side={THREE.DoubleSide} toneMapped={false} />
          </mesh>
          {[-1.25, 1.25].map((x) => (
            <mesh key={x} position={[x, 1.5, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.35, 0.35, 0.15, 24]} />
              <meshStandardMaterial color="#71717a" metalness={0.6} />
            </mesh>
          ))}
          <pointLight position={[0, 1.5, 0.8]} color={el.hex} intensity={4} distance={5} />
          <SceneLabel position={[0, 2.2, 0]}>газоразрядная трубка с водородом</SceneLabel>
        </group>
      )}
      {kind === "fireworks" && <Fireworks hex={el.hex} running={running} speed={speed} />}

      <group position={[0, 0.5, 2.1]}>
        <mesh>
          <boxGeometry args={[3.0, 0.44, 0.06]} />
          <meshStandardMaterial color="#1f2937" />
        </mesh>
        <mesh position={[0, 0, 0.032]}>
          <planeGeometry args={[2.85, 0.3]} />
          <meshBasicMaterial map={spectrum} toneMapped={false} />
        </mesh>
        <SceneLabel position={[0, 0.45, 0]}>{`спектроскоп: яркая линия ${el.lambdaNm} нм`}</SceneLabel>
      </group>
    </>
  );
}

export function BohrModelSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, nI, nF, element } = useControls("Модель Бора", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Атом водорода и его спектр": "abstract", "Спектры-отпечатки (вывески, фейерверки)": "spectra" },
    },
    nI: { value: 3, min: 2, max: 6, step: 1, label: "n начальный", render: (get) => get("Модель Бора.scenario") === "abstract" },
    nF: { value: 2, min: 1, max: 5, step: 1, label: "n конечный", render: (get) => get("Модель Бора.scenario") === "abstract" },
    element: {
      value: 0,
      label: "Элемент",
      options: Object.fromEntries(ELEMENTS.map((e, i) => [e.name, i])),
      render: (get) => get("Модель Бора.scenario") === "spectra",
    },
  });
  const isSpectra = scenario === "spectra";
  const el = ELEMENTS[element];
  const nInit = Math.max(nI, nF + 1);

  const Ei = En(nInit);
  const Ef = En(nF);
  const dE = Ei - Ef;
  const lambdaNm = 1240 / Math.abs(dE);
  const look = photonLook(lambdaNm);

  const [live, setLive] = useState<LiveNumbers>({ t: 0, n: nInit, phase: "orbit-i" });

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
  }, [clock]);

  const curve = Array.from({ length: 6 }, (_, i) => ({ n: i + 1, E: Number(En(i + 1).toFixed(2)) }));
  const fmt = (v: number, d = 2) => v.toFixed(d).replace(".", ",");
  const caption = isSpectra ? (
    <>
      У каждого элемента свои «ступеньки» энергии, поэтому он светится <b>своими цветами</b>: {el.name.split(" (")[0].toLowerCase()} — линия {el.lambdaNm} нм. Это {el.use}. По таким линиям-отпечаткам
      узнают состав звёзд и фейерверков.
    </>
  ) : (
    <>
      Электрон в атоме может жить только на <b>разрешённых орбитах</b> (ступеньках энергии). Перескакивая с n = {nInit} на n = {nF}, он отдаёт разницу энергий ΔE = {fmt(dE)} эВ одним фотоном с λ ={" "}
      {lambdaNm.toFixed(0)} нм — {look.band}. Поэтому трубка с водородом даёт не сплошную радугу, а отдельные <b>яркие линии</b>.
    </>
  );
  const legend: LegendItem[] = isSpectra
    ? []
    : [
        { color: "#38bdf8", label: "электрон", kind: "dot" },
        { color: look.hex, label: "фотон перехода", kind: "dot" },
        { color: "#5eead4", label: "орбиты перехода", kind: "line" },
      ];

  return (
    <SimShell
      scene={
        <SceneCanvas
          key={`${scenario}-${isSpectra ? element : 0}`}
          camera={isSpectra ? { position: [0, 2.8, 7.4] as [number, number, number], fov: 50 } : { position: [0.9, 4.8, 8.8] as [number, number, number], fov: 50 }}
          orbitTarget={isSpectra ? [0, 2.0, 0] : [0.7, 1.5, 0]}
          simplified={isMobile}
          maxDistance={18}
          minDistance={3}
          bloomThreshold={0.65}
          fogRange={[16, 45]}
        >
          {isSpectra ? (
            <SceneSpectra key={clock.resetNonce} elIdx={element} running={clock.running} speed={clock.speed} />
          ) : (
            <SceneContent key={clock.resetNonce} nI={nInit} nF={nF} running={clock.running} speed={clock.speed} onLive={setLive} />
          )}
        </SceneCanvas>
      }
      legend={legend.length ? legend : undefined}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        isSpectra ? (
          <NumberReadouts
            items={[
              { label: "Элемент", value: el.name },
              { label: "Характерная длина волны λ", value: el.lambdaNm.toFixed(0), unit: "нм", color: el.hex },
              { label: "E фотона = 1240/λ", value: (1240 / el.lambdaNm).toFixed(2), unit: "эВ" },
              { label: "Где встречается", value: el.use },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "Текущий уровень n", value: live.n.toString() },
              { label: "Eₙ = −13.6/n² эВ (нач.)", value: Ei.toFixed(3), unit: "эВ" },
              { label: "Eₙ (кон.)", value: Ef.toFixed(3), unit: "эВ" },
              { label: "ΔE = E_нач−E_кон", value: dE.toFixed(3), unit: "эВ" },
              { label: "λ = 1240/ΔE (фотон)", value: lambdaNm.toFixed(1), unit: "нм" },
            ]}
          />
        )
      }
      graphs={
        isSpectra ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            Каждый химический элемент имеет свой уникальный набор разрешённых энергетических уровней —
            «отпечаток пальца». Когда газ возбуждается (разряд в неоновой трубке, тепло пламени фейерверка),
            электроны переходят на более высокие уровни и, возвращаясь обратно, испускают фотоны строго
            определённых длин волн E=1240/λ (эВ, нм). Поэтому неоновая вывеска светится красно-оранжевым,
            а натриевая лампа — характерным жёлтым: это не выбор дизайнера, а физика энергетических уровней
            конкретного атома.
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">Энергетические уровни Eₙ = −13.6/n² эВ</p>
            <LiveChart data={curve} xKey="n" xType="number" xLabel="n" series={[{ key: "E", color: "#5eead4", label: "E, эВ" }]} />
          </div>
        )
      }
      note={
        isSpectra ? (
          <>
            Простая формула Бора Eₙ=−13.6/n² точна только для водородоподобных атомов (один электрон).
            У многоэлектронных атомов (неон, натрий, стронций...) уровни энергии сложнее, но принцип тот
            же: свет испускается на дискретных длинах волн, соответствующих разности энергий между
            уровнями — отсюда и характерный цвет каждого элемента в спектроскопии, вывесках и пиротехнике.
          </>
        ) : (
          <>
            Электрон вращается по разрешённым орбитам радиуса rₙ∝n². При переходе n_нач→n_кон (n_нач&gt;n_кон)
            испускается фотон с энергией ΔE=E_нач−E_кон и длиной волны λ=hc/ΔE — для перехода 3→2 получается
            λ≈656 нм, красная линия Hα в спектре водорода. Переходы на n=1 дают ультрафиолет (серия Лаймана),
            на n=2 — видимые линии (серия Бальмера). Обратный переход показывает поглощение той же энергии.
          </>
        )
      }
    />
  );
}
