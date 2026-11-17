import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useControls } from "leva";
import * as THREE from "three";
import { Stars } from "@react-three/drei";
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
import { brickTexture, canvasTexture } from "@/components/sim/props/textures";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const STARS = [
  { name: "Бетельгейзе", T: 3500, radius: 0.9, x: -2.6 },
  { name: "Солнце", T: 5778, radius: 0.55, x: 0 },
  { name: "Сириус А", T: 9940, radius: 0.4, x: 2.6 },
];

const H_PLANCK = 6.626e-34;
const C_LIGHT = 3e8;
const K_BOLTZ = 1.381e-23;
const SIGMA_SB = 5.67e-8;
const WIEN_B = 2.898e-3;
const PERIOD = 12;

/** Colour of a glowing black body (approximation of the Planck locus, after T. Helland). */
function blackbodyColor(T: number): THREE.Color {
  const t = Math.max(T, 600) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const c = (v: number) => THREE.MathUtils.clamp(v, 0, 255) / 255;
  return new THREE.Color().setRGB(c(r), c(g), c(b), THREE.SRGBColorSpace);
}

function planckI(lambdaM: number, T: number) {
  const x = (H_PLANCK * C_LIGHT) / (lambdaM * K_BOLTZ * T);
  const denom = Math.exp(Math.min(x, 700)) - 1;
  return (2 * H_PLANCK * C_LIGHT * C_LIGHT) / Math.pow(lambdaM, 5) / (denom || 1e-300);
}

function tAt(t: number, tMin: number, tMax: number) {
  const frac = (t % PERIOD) / PERIOD;
  return tMin + (tMax - tMin) * (0.5 - 0.5 * Math.cos(2 * Math.PI * frac));
}

interface CurvePoint {
  lambda: number;
  I: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  T: number;
  lambdaMax: number;
  power: number;
}

interface SceneContentProps {
  tMin: number;
  tMax: number;
  running: boolean;
  speed: number;
  onSample: (n: LiveNumbers, curve: CurvePoint[]) => void;
}

/** The visible part of the spectrum, each colour as bright as the Planck curve allows at temperature T. */
function drawVisibleSpectrum(ctx: CanvasRenderingContext2D, w: number, h: number, T: number) {
  let max = 0;
  const vals: number[] = [];
  for (let x = 0; x < w; x++) {
    const nm = 380 + (370 * x) / (w - 1);
    const v = planckI(nm * 1e-9, T);
    vals.push(v);
    max = Math.max(max, v);
  }
  ctx.fillStyle = "#0b0b10";
  ctx.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x++) {
    const nm = 380 + (370 * x) / (w - 1);
    const c = new THREE.Color(wavelengthToColor(nm));
    const k = vals[x] / max;
    ctx.fillStyle = `rgb(${Math.round(c.r * 255 * k)},${Math.round(c.g * 255 * k)},${Math.round(c.b * 255 * k)})`;
    ctx.fillRect(x, 0, 1, h);
  }
}

/* ---------- "black body" = a furnace with a small hole ---------- */
function SceneContent({ tMin, tMax, running, speed, onSample }: SceneContentProps) {
  const holeMat = useRef<THREE.MeshBasicMaterial>(null!);
  const glowMat = useRef<THREE.MeshBasicMaterial>(null!);
  const light = useRef<THREE.PointLight>(null!);
  const brick = useMemo(() => {
    const t = brickTexture().clone();
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2, 1.6);
    t.needsUpdate = true;
    return t;
  }, []);
  useEffect(() => () => brick.dispose(), [brick]);
  const spectrum = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 16;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { c, tex };
  }, []);
  useEffect(() => () => spectrum.tex.dispose(), [spectrum]);
  const lastT = useRef(-1);

  const handleFrame = useCallback(
    (t: number) => {
      const T = tAt(t, tMin, tMax);
      const col = blackbodyColor(T);
      // brightness grows as T⁴ (Stefan–Boltzmann), squashed so that the eye can follow it
      const k = Math.min(Math.pow(T / 6000, 2), 2.2);
      if (holeMat.current) holeMat.current.color.copy(col).multiplyScalar(0.6 + k);
      if (glowMat.current) {
        glowMat.current.color.copy(col);
        glowMat.current.opacity = Math.min(0.15 + 0.3 * k, 0.75);
      }
      if (light.current) {
        light.current.color.copy(col);
        light.current.intensity = 2 + 8 * k;
      }
      if (Math.abs(T - lastT.current) > 40) {
        lastT.current = T;
        const ctx = spectrum.c.getContext("2d");
        if (ctx) {
          drawVisibleSpectrum(ctx, spectrum.c.width, spectrum.c.height, T);
          spectrum.tex.needsUpdate = true;
        }
      }
    },
    [tMin, tMax, spectrum],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={10}
        onSample={(t) => {
          const T = tAt(t, tMin, tMax);
          const lambdaMax = WIEN_B / T;
          const power = SIGMA_SB * Math.pow(T, 4);
          const curve: CurvePoint[] = [];
          for (let i = 0; i <= 60; i++) {
            const lambdaNm = 100 + (3000 - 100) * (i / 60);
            const I = planckI(lambdaNm * 1e-9, T);
            curve.push({ lambda: Number(lambdaNm.toFixed(0)), I: Number((I / 1e12).toExponential(3)) });
          }
          onSample({ t, T, lambdaMax: lambdaMax * 1e9, power }, curve);
        }}
      />

      <Ground kind="concrete" from={-6} to={6} width={8} tile={3} tileZ={3} />
      {/* brick furnace: the light coming out of a small hole is the ideal "black body" radiation */}
      <group position={[-0.9, 0, 0]}>
        <mesh position={[0, 0.9, 0]} castShadow receiveShadow>
          <boxGeometry args={[2.0, 1.8, 1.6]} />
          <meshStandardMaterial map={brick} roughness={0.9} />
        </mesh>
        <mesh position={[0, 2.05, -0.3]} castShadow>
          <boxGeometry args={[0.45, 0.5, 0.45]} />
          <meshStandardMaterial map={brick} roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.95, 0.801]}>
          <circleGeometry args={[0.22, 40]} />
          <meshBasicMaterial ref={holeMat} color="#ff3300" toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.95, 0.805]}>
          <ringGeometry args={[0.22, 0.6, 48]} />
          <meshBasicMaterial ref={glowMat} color="#ff3300" transparent opacity={0.3} toneMapped={false} depthWrite={false} />
        </mesh>
        <pointLight ref={light} position={[0, 0.95, 1.3]} intensity={3} distance={7} />
        <SceneLabel position={[0, 2.55, 0]}>печь с маленьким отверстием = «чёрное тело»</SceneLabel>
      </group>

      {/* spectroscope screen showing the visible part of the spectrum */}
      <group position={[1.75, 1.15, 0.3]} rotation={[0, -0.35, 0]}>
        <mesh>
          <boxGeometry args={[1.7, 0.6, 0.06]} />
          <meshStandardMaterial color="#1f2937" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.02, 0.031]}>
          <planeGeometry args={[1.55, 0.36]} />
          <meshBasicMaterial map={spectrum.tex} toneMapped={false} />
        </mesh>
        <mesh position={[0, -0.75, -0.05]}>
          <cylinderGeometry args={[0.04, 0.04, 0.95, 10]} />
          <meshStandardMaterial color="#52525b" />
        </mesh>
        <SceneLabel position={[0, 0.55, 0]}>спектроскоп: какие цвета ярче</SceneLabel>
        <SceneLabel position={[-0.75, -0.42, 0.05]}>фиолетовый</SceneLabel>
        <SceneLabel position={[0.75, -0.42, 0.05]}>красный</SceneLabel>
      </group>
    </>
  );
}

/* ---------- stars of different colours ---------- */
function glowTexture() {
  return canvasTexture("star-glow", 128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(0.35, "rgba(255,255,255,0.35)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

function SceneStars() {
  const glow = useMemo(() => glowTexture(), []);
  return (
    <>
      <Stars radius={60} depth={30} count={2000} factor={3} fade speed={0.4} />
      {STARS.map((s) => {
        const col = blackbodyColor(s.T);
        return (
          <group key={s.name} position={[s.x, 0.3, 0]}>
            <mesh>
              <sphereGeometry args={[s.radius, 40, 40]} />
              <meshBasicMaterial color={col.clone().multiplyScalar(1.6)} toneMapped={false} />
            </mesh>
            <sprite scale={s.radius * 4.2}>
              <spriteMaterial map={glow} color={col} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
            </sprite>
            <SceneLabel position={[0, s.radius + 0.55, 0]}>{`${s.name}, ${s.T} К`}</SceneLabel>
          </group>
        );
      })}
    </>
  );
}

export function BlackbodyRadiationSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, tMin, tMax } = useControls("Излучение чёрного тела", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Раскалённая печь (спектр Планка)": "abstract", "Цвета звёзд": "stars" },
    },
    tMin: { value: 2000, min: 1000, max: 4000, step: 100, label: "T мин, К", render: (get) => get("Излучение чёрного тела.scenario") === "abstract" },
    tMax: { value: 9000, min: 5000, max: 12000, step: 100, label: "T макс, К", render: (get) => get("Излучение чёрного тела.scenario") === "abstract" },
  });
  const isStars = scenario === "stars";

  const [live, setLive] = useState<LiveNumbers>({ t: 0, T: tMin, lambdaMax: (WIEN_B / tMin) * 1e9, power: SIGMA_SB * Math.pow(tMin, 4) });
  const [curve, setCurve] = useState<CurvePoint[]>([]);

  const handleSample = useCallback((n: LiveNumbers, c: CurvePoint[]) => {
    setLive(n);
    setCurve(c);
  }, []);

  const resetState = useCallback(() => {
    setLive({ t: 0, T: tMin, lambdaMax: (WIEN_B / tMin) * 1e9, power: SIGMA_SB * Math.pow(tMin, 4) });
  }, [tMin]);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    resetState();
  }, [clock, resetState]);

  const where = live.lambdaMax > 750 ? "в инфракрасной области (её глаз не видит)" : live.lambdaMax < 380 ? "в ультрафиолете" : "в видимой области";
  const caption = isStars ? (
    <>
      Звёзды светятся почти как «чёрные тела», поэтому их <b>цвет — это термометр</b>: красноватая Бетельгейзе холоднее (≈3500 К), жёлто-белое Солнце — 5778 К, голубоватый Сириус — почти 10 000 К. Чем
      горячее, тем голубее.
    </>
  ) : (
    <>
      Нагреваем печь до {live.T.toFixed(0)} К. Отверстие светится {live.T < 3500 ? "красно-оранжевым" : live.T < 6500 ? "жёлто-белым" : "голубовато-белым"}: максимум излучения λ = b/T ={" "}
      {live.lambdaMax.toFixed(0)} нм — {where}. Горячее — значит <b>ярче (∝ T⁴) и голубее</b>, как спираль лампы, металл в кузнице и звёзды.
    </>
  );
  const legend: LegendItem[] = isStars
    ? []
    : [
        { color: "#f97316", label: "холоднее — краснее", kind: "dot" },
        { color: "#bfdbfe", label: "горячее — голубее", kind: "dot" },
      ];

  return (
    <SimShell
      scene={
        <SceneCanvas
          key={scenario}
          camera={isStars ? { position: [0, 1, 6.5] as [number, number, number], fov: 50 } : { position: [0.9, 2.0, 6.1] as [number, number, number], fov: 50 }}
          orbitTarget={isStars ? [0, 0.3, 0] : [0.35, 1.0, 0]}
          simplified={isMobile}
          maxDistance={18}
          minDistance={2.5}
          bloomThreshold={0.7}
          fogRange={isStars ? [40, 90] : [14, 40]}
        >
          {isStars ? <SceneStars key={clock.resetNonce} /> : <SceneContent key={clock.resetNonce} tMin={tMin} tMax={tMax} running={clock.running} speed={clock.speed} onSample={handleSample} />}
        </SceneCanvas>
      }
      legend={legend.length ? legend : undefined}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        isStars ? (
          <NumberReadouts
            items={STARS.map((s) => ({
              label: `${s.name}: λ_max = b/T`,
              value: ((WIEN_B / s.T) * 1e9).toFixed(0),
              unit: "нм",
            }))}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "T(t)", value: live.T.toFixed(0), unit: "К" },
              { label: "λ_max = b/T (закон Вина)", value: live.lambdaMax.toFixed(0), unit: "нм" },
              { label: "P/A = σT⁴ (закон Стефана-Больцмана)", value: (live.power / 1e6).toFixed(2), unit: "МВт/м²" },
            ]}
          />
        )
      }
      graphs={
        isStars ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            Цвет звезды напрямую говорит о температуре её поверхности — звёзды излучают почти как чёрное
            тело. Бетельгейзе (красный сверхгигант, ≈3500К) излучает максимум в инфракрасной/красной
            области; Солнце (≈5778К) — максимум в жёлто-зелёной; Сириус А (≈9940К) — в
            ультрафиолетово-синей, поэтому выглядит бело-голубым. Так астрономы определяют температуру
            звёзд, даже не имея возможности до них долететь — просто по цвету и спектру.
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">Спектр Планка I(λ) при текущей T</p>
            <LiveChart data={curve} xKey="lambda" xType="number" xLabel="λ, нм" series={[{ key: "I", color: "#fbbf24", label: "I, отн.ед." }]} />
          </div>
        )
      }
      note={
        isStars ? (
          <>
            Закон смещения Вина λ_max·T=b позволяет по измеренному спектру звезды сразу получить её
            температуру поверхности — без единого зонда. Размеры звёзд на сцене условные (на самом деле
            Бетельгейзе в сотни раз больше Солнца, а Сириус А — лишь в 1,7 раза).
          </>
        ) : (
          <>
            «Абсолютно чёрное тело» — это не чёрная краска, а, например, печь с маленьким отверстием: свет,
            попавший внутрь, уже не выходит, а свечение отверстия зависит только от температуры. Формула
            Планка I(λ,T)=(2hc²/λ⁵)/(e^(hc/λkT)−1) точно описывает этот спектр. С ростом T максимум смещается
            в коротковолновую область (закон Вина λ_max·T=b), а мощность растёт как T⁴ (закон
            Стефана–Больцмана). Таких горячих печей не бывает — так светятся звёзды.
          </>
        )
      }
    />
  );
}
