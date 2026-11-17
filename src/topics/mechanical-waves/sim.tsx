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
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { Ambulance } from "@/components/sim/props/vehicles";
import { Person } from "@/components/sim/props/Person";
import { Ground, Tree } from "@/components/sim/props/environment";
import { woodTexture } from "@/components/sim/props/textures";

const N = 140;
const X_MIN = -5;
const X_MAX = 5;
const X1 = -2.5;
const X2 = 2.5;
const ROPE_Y = 1.6;
const UP = new THREE.Vector3(0, 1, 0);

interface SamplePoint {
  t: number;
  y1: number;
  y2: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  y1: number;
  y2: number;
}

interface SceneContentProps {
  A: number;
  k: number;
  w: number;
  standing: boolean;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

/** travelling wave y = A·sin(kx − ωt); standing wave with its node at the post (x = X_MAX) */
function waveY(A: number, k: number, w: number, standing: boolean, x: number, t: number) {
  return standing ? 2 * A * Math.sin(k * (X_MAX - x)) * Math.cos(w * t) : A * Math.sin(k * x - w * t);
}

const dummy = new THREE.Object3D();

function SceneContent({ A, k, w, standing, running, speed, onSample, onLive }: SceneContentProps) {
  const rope = useRef<THREE.InstancedMesh>(null!);
  const slider = useRef<THREE.Group>(null!);
  const flag1 = useRef<THREE.Group>(null!);
  const flag2 = useRef<THREE.Group>(null!);
  const a = useRef(new THREE.Vector3());
  const b = useRef(new THREE.Vector3());

  const handleFrame = useCallback(
    (t: number) => {
      const mesh = rope.current;
      if (mesh) {
        for (let i = 0; i < N - 1; i++) {
          const x0 = X_MIN + ((X_MAX - X_MIN) * i) / (N - 1);
          const x1 = X_MIN + ((X_MAX - X_MIN) * (i + 1)) / (N - 1);
          a.current.set(x0, ROPE_Y + waveY(A, k, w, standing, x0, t), 0);
          b.current.set(x1, ROPE_Y + waveY(A, k, w, standing, x1, t), 0);
          const dir = b.current.clone().sub(a.current);
          const len = dir.length();
          dummy.position.copy(a.current).add(b.current).multiplyScalar(0.5);
          dummy.quaternion.setFromUnitVectors(UP, dir.normalize());
          dummy.scale.set(1, len * 1.05, 1);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
      }
      const yEnd = waveY(A, k, w, standing, X_MIN, t);
      if (slider.current) slider.current.position.y = ROPE_Y + yEnd;
      if (flag1.current) flag1.current.position.set(X1, ROPE_Y + waveY(A, k, w, standing, X1, t), 0);
      if (flag2.current) flag2.current.position.set(X2, ROPE_Y + waveY(A, k, w, standing, X2, t), 0);
    },
    [A, k, w, standing],
  );

  const nodes = useMemo(() => {
    if (!standing) return [];
    const lambda = (2 * Math.PI) / k;
    const list: number[] = [];
    for (let x = X_MAX; x >= X_MIN; x -= lambda / 2) list.push(x);
    return list;
  }, [k, standing]);

  const flag = (color: string) => (
    <>
      <mesh position={[0, 0.16, 0]}>
        <boxGeometry args={[0.03, 0.32, 0.03]} />
        <meshStandardMaterial color="#e5e7eb" />
      </mesh>
      <mesh position={[0.12, 0.26, 0]}>
        <boxGeometry args={[0.22, 0.13, 0.01]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} side={THREE.DoubleSide} />
      </mesh>
    </>
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={25}
        onSample={(t) => {
          const y1 = waveY(A, k, w, standing, X1, t);
          const y2 = waveY(A, k, w, standing, X2, t);
          onSample({ t, y1, y2 });
          onLive({ t, y1, y2 });
        }}
      />
      <Ground kind="parquet" from={-8} to={8} width={6} tile={3} tileZ={3} y={-0.01} />
      {/* vibrator: a motor-driven slider shakes the left end of the rope */}
      <group position={[X_MIN - 0.25, 0, 0]}>
        <mesh position={[0, 0.25, 0]} castShadow>
          <boxGeometry args={[0.5, 0.5, 0.5]} />
          <meshStandardMaterial color="#1d4ed8" metalness={0.4} roughness={0.4} />
        </mesh>
        <mesh position={[-0.12, ROPE_Y + 0.4, 0]} castShadow>
          <boxGeometry args={[0.08, 3.4, 0.08]} />
          <meshStandardMaterial color="#9ca3af" metalness={0.8} roughness={0.3} />
        </mesh>
        <group ref={slider} position={[0, ROPE_Y, 0]}>
          <mesh position={[0.1, 0, 0]}>
            <boxGeometry args={[0.24, 0.14, 0.2]} />
            <meshStandardMaterial color="#f97316" metalness={0.3} roughness={0.4} />
          </mesh>
        </group>
        <SceneLabel position={[0, 0.75, 0.4]}>вибратор (качает конец)</SceneLabel>
      </group>
      {standing && (
        <group position={[X_MAX + 0.1, 0, 0]}>
          <mesh position={[0, ROPE_Y / 2 + 0.3, 0]} castShadow>
            <boxGeometry args={[0.16, ROPE_Y + 0.6, 0.16]} />
            <meshStandardMaterial map={woodTexture("dark", 2)} roughness={0.8} />
          </mesh>
          <SceneLabel position={[0, ROPE_Y + 0.9, 0]}>шнур привязан к стойке</SceneLabel>
        </group>
      )}
      {!standing && <SceneLabel position={[X_MAX - 0.4, ROPE_Y + 1.5, 0]}>шнур длинный → волна бежит дальше</SceneLabel>}
      <instancedMesh ref={rope} args={[undefined, undefined, N - 1]} frustumCulled={false} castShadow>
        <cylinderGeometry args={[0.035, 0.035, 1, 8]} />
        <meshStandardMaterial color="#d6c08f" roughness={0.85} />
      </instancedMesh>
      {standing &&
        nodes.map((x, i) => (
          <group key={i} position={[x, ROPE_Y, 0]}>
            <mesh rotation={[0, Math.PI / 2, 0]}>
              <torusGeometry args={[0.08, 0.018, 8, 20]} />
              <meshStandardMaterial color="#f8fafc" emissive="#f8fafc" emissiveIntensity={0.5} />
            </mesh>
          </group>
        ))}
      <group ref={flag1} position={[X1, ROPE_Y, 0]}>
        {flag("#4ade80")}
        <SceneLabel position={[0, 0.55, 0]} tone="#4ade80">ленточка 1</SceneLabel>
      </group>
      <group ref={flag2} position={[X2, ROPE_Y, 0]}>
        {flag("#f87171")}
        <SceneLabel position={[0, 0.55, 0]} tone="#f87171">ленточка 2</SceneLabel>
      </group>
    </>
  );
}

/* ---------------- guitar ---------------- */

const GUITAR_L = 0.65;
const GUITAR_V = 143; // m/s, tuned so n=1 -> 110 Hz
const GUITAR_N = 160;
const BOARD_Z = 0.05;

function guitarFreq(n: number) {
  return (n * GUITAR_V) / (2 * GUITAR_L);
}

/** real fret positions: x_n = L·(1 − 2^(−n/12)) */
const FRETS = Array.from({ length: 14 }, (_, i) => GUITAR_L * (1 - Math.pow(2, -(i + 1) / 12)));

function guitarBodyShape() {
  const pts: THREE.Vector2[] = [];
  const lower = { x: 0.68, r: 0.19 };
  const upper = { x: 0.42, r: 0.145 };
  const waistX = 0.545;
  const lowerHalf = Math.acos((waistX - lower.x) / lower.r);
  for (let i = 0; i <= 40; i++) {
    // outer arc of the lower bout, from the waist over the far side back to the waist
    const a = lowerHalf - (i / 40) * (2 * lowerHalf);
    pts.push(new THREE.Vector2(lower.x + lower.r * Math.cos(a), lower.r * Math.sin(a)));
  }
  const upperHalf = Math.acos((waistX - upper.x) / upper.r);
  for (let i = 0; i <= 40; i++) {
    const a = -upperHalf + (i / 40) * (-(2 * Math.PI) + 2 * upperHalf);
    pts.push(new THREE.Vector2(upper.x + upper.r * Math.cos(a), upper.r * Math.sin(a)));
  }
  return new THREE.Shape(pts);
}

interface GuitarLive {
  t: number;
  y: number;
  f: number;
}

function SceneGuitar({ n, A, running, speed, onLive }: { n: number; A: number; running: boolean; speed: number; onLive: (v: GuitarLive) => void }) {
  const positions = useMemo(() => {
    const arr = new Float32Array(GUITAR_N * 3);
    for (let i = 0; i < GUITAR_N; i++) {
      arr[i * 3] = (GUITAR_L * i) / (GUITAR_N - 1);
      arr[i * 3 + 1] = -0.025;
      arr[i * 3 + 2] = BOARD_Z + 0.012;
    }
    return arr;
  }, []);
  const geomRef = useRef<THREE.BufferGeometry>(null!);
  const f = guitarFreq(n);
  const w = 2 * Math.PI * f;
  const k = (n * Math.PI) / GUITAR_L;
  // the eye sees a blur, not 110 vibrations per second: animate the shape slowly
  const wVisual = 2 * Math.PI * 1.2;

  const body = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(guitarBodyShape(), { depth: 0.1, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2, curveSegments: 24 });
    g.translate(0, 0, -0.06);
    return g;
  }, []);
  useEffect(() => () => body.dispose(), [body]);
  const wood = useMemo(() => {
    const t = woodTexture("light", 6).clone();
    t.repeat.set(4, 4);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true;
    return t;
  }, []);
  const dark = woodTexture("dark", 3);

  const handleFrame = useCallback(
    (t: number) => {
      const posAttr = geomRef.current?.attributes.position as THREE.BufferAttribute | undefined;
      if (posAttr) {
        for (let i = 0; i < GUITAR_N; i++) {
          const x = (GUITAR_L * i) / (GUITAR_N - 1);
          posAttr.setY(i, -0.025 + A * Math.sin(k * x) * Math.cos(wVisual * t));
        }
        posAttr.needsUpdate = true;
      }
    },
    [A, k, wVisual],
  );

  const nodes = Array.from({ length: n - 1 }, (_, j) => ((j + 1) * GUITAR_L) / n);

  return (
    <>
      <PhysicsTicker running={running} speed={speed} onFrame={handleFrame} sampleHz={20} onSample={(t) => onLive({ t, y: A * Math.sin(k * (GUITAR_L / 2)) * Math.cos(w * t), f })} />
      {/* body */}
      <mesh geometry={body} castShadow receiveShadow>
        <meshStandardMaterial attach="material-0" map={wood} roughness={0.5} />
        <meshStandardMaterial attach="material-1" color="#7c4a1e" roughness={0.5} />
      </mesh>
      <mesh position={[0.45, 0, BOARD_Z + 0.003]}>
        <circleGeometry args={[0.048, 32]} />
        <meshBasicMaterial color="#0a0604" />
      </mesh>
      <mesh position={[0.45, 0, BOARD_Z + 0.002]}>
        <ringGeometry args={[0.052, 0.062, 40]} />
        <meshStandardMaterial color="#3f2a14" />
      </mesh>
      {/* bridge and saddle */}
      <mesh position={[GUITAR_L + 0.012, 0, BOARD_Z + 0.008]}>
        <boxGeometry args={[0.03, 0.16, 0.012]} />
        <meshStandardMaterial map={dark} roughness={0.6} />
      </mesh>
      {/* neck, fretboard, frets, nut and headstock */}
      <mesh position={[0.17, 0, 0.02]} castShadow>
        <boxGeometry args={[0.38, 0.055, 0.04]} />
        <meshStandardMaterial map={dark} roughness={0.6} />
      </mesh>
      {FRETS.filter((x) => x < 0.36).map((x, i) => (
        <mesh key={i} position={[x, 0, BOARD_Z - 0.008]}>
          <boxGeometry args={[0.003, 0.056, 0.004]} />
          <meshStandardMaterial color="#e5e7eb" metalness={0.9} roughness={0.2} />
        </mesh>
      ))}
      {[3, 5, 7, 9, 12].map((fret) => (
        <mesh key={fret} position={[(FRETS[fret - 2] + FRETS[fret - 1]) / 2, 0, BOARD_Z - 0.008]}>
          <circleGeometry args={[0.005, 12]} />
          <meshBasicMaterial color="#f8fafc" />
        </mesh>
      ))}
      <mesh position={[-0.003, 0, BOARD_Z - 0.004]}>
        <boxGeometry args={[0.006, 0.056, 0.012]} />
        <meshStandardMaterial color="#f5f5f4" />
      </mesh>
      <mesh position={[-0.09, 0, 0.012]} rotation={[0, 0.25, 0]} castShadow>
        <boxGeometry args={[0.17, 0.08, 0.02]} />
        <meshStandardMaterial map={dark} roughness={0.6} />
      </mesh>
      {[-1, 1].map((s) =>
        [0, 1, 2].map((i) => (
          <mesh key={`${s}${i}`} position={[-0.04 - i * 0.045, s * 0.055, 0.02]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.008, 0.008, 0.04, 8]} />
            <meshStandardMaterial color="#d4d4d8" metalness={0.9} roughness={0.25} />
          </mesh>
        )),
      )}
      {/* five resting strings */}
      {[-0.015, -0.005, 0.005, 0.015, 0.025].map((y) => (
        <mesh key={y} position={[GUITAR_L / 2, y, BOARD_Z + 0.012]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.0008, 0.0008, GUITAR_L, 4]} />
          <meshStandardMaterial color="#e5e7eb" metalness={0.9} roughness={0.25} />
        </mesh>
      ))}
      {/* the vibrating sixth string */}
      <line>
        <bufferGeometry ref={geomRef}>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#fbbf24" />
      </line>
      {nodes.map((x) => (
        <mesh key={x} position={[x, -0.025, BOARD_Z + 0.014]}>
          <sphereGeometry args={[0.005, 10, 8]} />
          <meshStandardMaterial color="#f8fafc" emissive="#f8fafc" emissiveIntensity={1} toneMapped={false} />
        </mesh>
      ))}
      <SceneLabel position={[GUITAR_L / 2, 0.11, BOARD_Z]}>{`шестая струна: гармоника n = ${n}`}</SceneLabel>
      {n > 1 && <SceneLabel position={[nodes[0], -0.08, BOARD_Z]}>{`узел — флажолет над ${n === 2 ? 12 : n === 3 ? 7 : 5}-м ладом`}</SceneLabel>}
    </>
  );
}

/* ---------------- Doppler: ambulance passing a pedestrian ---------------- */

const V_SOUND = 343;
const SIREN_F = 700;
const DOPPLER_HALF = 20;
const DOPPLER_OFFSET_Z = 4;
const RINGS = 10;
const RING_DT = 0.012;
const SIREN_Y = 2.5;

interface DopplerLive {
  t: number;
  x: number;
  fObs: number;
  approaching: boolean;
}

function SceneDoppler({ vSource, running, speed, onLive, onFinished }: { vSource: number; running: boolean; speed: number; onLive: (v: DopplerLive) => void; onFinished: () => void }) {
  const sourceRef = useRef<THREE.Group>(null!);
  const rings = useRef<(THREE.LineLoop | null)[]>([]);
  const spin = useRef(0);
  const finishedRef = useRef(false);
  const circle = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, []);
  useEffect(() => () => circle.dispose(), [circle]);

  const fObsAt = useCallback(
    (x: number) => {
      const distance = Math.hypot(x, DOPPLER_OFFSET_Z) || 0.001;
      const vLos = (x * vSource) / distance;
      return (SIREN_F * V_SOUND) / (V_SOUND + vLos);
    },
    [vSource],
  );

  const handleFrame = useCallback(
    (t: number) => {
      const x = -DOPPLER_HALF + vSource * t;
      if (sourceRef.current) sourceRef.current.position.set(x, 0, 0);
      spin.current = (vSource * t) / 0.38;
      // wavefronts emitted at fixed moments: their centres stay where the siren was
      const k0 = Math.floor(t / RING_DT);
      rings.current.forEach((ring, i) => {
        if (!ring) return;
        const te = (k0 - i) * RING_DT;
        if (te < 0) {
          ring.visible = false;
          return;
        }
        const r = V_SOUND * (t - te);
        ring.visible = r < 34;
        ring.position.set(-DOPPLER_HALF + vSource * te, SIREN_Y, 0);
        ring.scale.setScalar(Math.max(0.01, r));
        (ring.material as THREE.LineBasicMaterial).opacity = 0.75 * (1 - r / 34);
      });
      if (!finishedRef.current && x > DOPPLER_HALF) {
        finishedRef.current = true;
        onFinished();
      }
    },
    [vSource, onFinished],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={(t) => {
          const x = -DOPPLER_HALF + vSource * t;
          onLive({ t, x, fObs: fObsAt(x), approaching: x < 0 });
        }}
      />
      <Ground kind="grass" from={-30} to={30} width={30} tile={6} tileZ={6} y={-0.012} />
      <Ground kind="road" from={-30} to={30} width={6} tile={8} y={0} />
      {[-14, -2, 9, 22].map((x, i) => (
        <Tree key={x} position={[x, 0, -7 - (i % 2) * 2]} height={5 + (i % 3)} seed={i + 2} conifer={i % 2 === 0} />
      ))}
      <Person position={[0, 0, DOPPLER_OFFSET_Z]} rotation={[0, Math.PI, 0]} shirt="#0ea5e9" pants="#1f2937" />
      <SceneLabel position={[0, 2.2, DOPPLER_OFFSET_Z]}>пешеход слышит сирену</SceneLabel>
      <group ref={sourceRef} position={[-DOPPLER_HALF, 0, 0]}>
        <Ambulance spinRef={spin} />
        <SceneLabel position={[0, 3.3, 0]}>{`скорая, сирена ${SIREN_F} Гц`}</SceneLabel>
      </group>
      {Array.from({ length: RINGS }, (_, i) => (
        <lineLoop
          key={i}
          ref={(l) => {
            rings.current[i] = l;
          }}
          geometry={circle}
          visible={false}
        >
          <lineBasicMaterial color="#fbbf24" transparent opacity={0.6} />
        </lineLoop>
      ))}
    </>
  );
}

/** Minimal Web Audio tone player, lazily created on the first user gesture (Play click). */
function useTonePlayer() {
  const ctxRef = useRef<AudioContext | null>(null);
  const oscRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);

  const ensure = useCallback(() => {
    if (!ctxRef.current) {
      const ctx = new AudioContext();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(ctx.destination);
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = 220;
      osc.connect(gain);
      osc.start();
      ctxRef.current = ctx;
      gainRef.current = gain;
      oscRef.current = osc;
    }
    if (ctxRef.current.state === "suspended") ctxRef.current.resume();
    return { ctx: ctxRef.current, osc: oscRef.current!, gain: gainRef.current! };
  }, []);

  const setFreq = useCallback((f: number) => {
    if (oscRef.current) oscRef.current.frequency.value = f;
  }, []);

  const setOn = useCallback(
    (on: boolean) => {
      const { ctx, gain } = ensure();
      gain.gain.linearRampToValueAtTime(on ? 0.12 : 0, ctx.currentTime + 0.08);
    },
    [ensure],
  );

  useEffect(
    () => () => {
      oscRef.current?.stop();
      ctxRef.current?.close();
    },
    [],
  );

  return { setFreq, setOn };
}

export function MechanicalWavesSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);
  const tone = useTonePlayer();

  const { scenario, A, lambda, f, standing, guitarN, vSource } = useControls("Механические волны", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Волна на шнуре": "abstract", "Гитарная струна (гармоники)": "guitar", "Эффект Доплера: скорая проезжает мимо": "doppler" },
    },
    A: { value: 0.6, min: 0.1, max: 1.2, step: 0.05, label: "A, м (амплитуда)", render: (get) => get("Механические волны.scenario") === "abstract" },
    lambda: { value: 3, min: 1, max: 6, step: 0.25, label: "λ, м (длина волны)", render: (get) => get("Механические волны.scenario") === "abstract" },
    f: { value: 0.5, min: 0.1, max: 2, step: 0.05, label: "f, Гц (частота)", render: (get) => get("Механические волны.scenario") === "abstract" },
    standing: { value: false, label: "стоячая волна", render: (get) => get("Механические волны.scenario") === "abstract" },
    guitarN: { value: 1, min: 1, max: 4, step: 1, label: "номер гармоники n", render: (get) => get("Механические волны.scenario") === "guitar" },
    vSource: { value: 15, min: 5, max: 30, step: 1, label: "v скорой, м/с", render: (get) => get("Механические волны.scenario") === "doppler" },
  });

  const guitar = scenario === "guitar";
  const doppler = scenario === "doppler";

  const k = (2 * Math.PI) / lambda;
  const w = 2 * Math.PI * f;
  const T = 1 / f;
  const v = lambda * f;

  const [live, setLive] = useState<LiveNumbers>({ t: 0, y1: 0, y2: 0 });
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, y1: 0, y2: 0 }]);
  const [guitarLive, setGuitarLive] = useState<GuitarLive>({ t: 0, y: 0, f: guitarFreq(1) });
  const [dopplerLive, setDopplerLive] = useState<DopplerLive>({ t: 0, x: -DOPPLER_HALF, fObs: SIREN_F, approaching: true });
  const [dopplerSeries, setDopplerSeries] = useState<{ t: number; fObs: number }[]>([{ t: 0, fObs: SIREN_F }]);

  const handleGuitarLive = useCallback(
    (n: GuitarLive) => {
      setGuitarLive(n);
      tone.setFreq(n.f);
    },
    [tone],
  );
  const handleDopplerLive = useCallback(
    (n: DopplerLive) => {
      setDopplerLive(n);
      setDopplerSeries((prev) => (prev.length > 500 ? prev : [...prev, { t: n.t, fObs: n.fObs }]));
      tone.setFreq(n.fObs);
    },
    [tone],
  );

  const handleToggleWithTone = useCallback(() => {
    const willRun = !clock.running;
    if (guitar || doppler) tone.setOn(willRun);
    clock.toggle();
  }, [clock, guitar, doppler, tone]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 500 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);

  const handleFinished = useCallback(() => {
    tone.setOn(false);
    clock.pause();
  }, [clock, tone]);

  const resetState = useCallback(() => {
    setLive({ t: 0, y1: 0, y2: 0 });
    setSeries([{ t: 0, y1: 0, y2: 0 }]);
    setGuitarLive({ t: 0, y: 0, f: guitarFreq(guitarN) });
    setDopplerLive({ t: 0, x: -DOPPLER_HALF, fObs: SIREN_F, approaching: true });
    setDopplerSeries([{ t: 0, fObs: SIREN_F }]);
  }, [guitarN]);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    if (guitar || doppler) tone.setOn(true);
    resetState();
  }, [clock, resetState, guitar, doppler, tone]);

  const stage = doppler
    ? { camera: { position: [0, 12, 22] as [number, number, number], fov: 55 }, target: [0, 1, 0] as [number, number, number], fog: [30, 80] as [number, number] }
    : guitar
      ? { camera: { position: [0.36, -0.05, 0.95] as [number, number, number], fov: 45 }, target: [0.36, 0, 0] as [number, number, number], fog: [10, 30] as [number, number] }
      : { camera: { position: [0, 3.2, 9.5] as [number, number, number], fov: 50 }, target: [0, 1.4, 0] as [number, number, number], fog: [14, 40] as [number, number] };

  let caption;
  let legend: LegendItem[];
  if (guitar) {
    caption = (
      <>
        Струна закреплена у порожка и у подставки — там узлы. Гармоника n = {guitarN} укладывает {guitarN} {guitarN === 1 ? "полуволну" : "полуволны"}: λ = 2L/n ={" "}
        {((2 * GUITAR_L) / guitarN).toFixed(2).replace(".", ",")} м, звучит {guitarLive.f.toFixed(0)} Гц. Струна дрожит {guitarLive.f.toFixed(0)} раз в секунду — на экране движение замедлено.
      </>
    );
    legend = [
      { color: "#fbbf24", label: "колеблющаяся струна", kind: "line" },
      { color: "#f8fafc", label: "узлы (струна неподвижна)", kind: "dot" },
    ];
  } else if (doppler) {
    caption = dopplerLive.approaching ? (
      <>
        <b>Скорая приближается:</b> каждый следующий гребень звуковой волны она испускает чуть ближе к пешеходу, поэтому впереди гребни сжаты — слышно{" "}
        <b>{dopplerLive.fObs.toFixed(0)} Гц</b> вместо {SIREN_F}. Тон выше.
      </>
    ) : (
      <>
        <b>Скорая удаляется:</b> позади неё гребни растянуты — до пешехода доходит <b>{dopplerLive.fObs.toFixed(0)} Гц</b>. Тон ниже: то самое «иии-ууу» при проезде мимо.
      </>
    );
    legend = [{ color: "#fbbf24", label: "гребни звуковой волны", kind: "line" }];
  } else {
    caption = standing ? (
      <>
        <b>Стоячая волна:</b> волна от вибратора отражается от стойки и складывается со встречной. Белые кольца — узлы, они не двигаются; расстояние между ними λ/2 ={" "}
        {(lambda / 2).toFixed(2).replace(".", ",")} м.
      </>
    ) : (
      <>
        <b>Бегущая волна:</b> гребни бегут вправо со скоростью v = λf = {v.toFixed(2).replace(".", ",")} м/с, а ленточки только поднимаются и опускаются — шнур никуда не едет,
        переносится лишь форма и энергия.
      </>
    );
    legend = [
      { color: "#4ade80", label: "ленточка 1", kind: "square" },
      { color: "#f87171", label: "ленточка 2", kind: "square" },
      ...(standing ? [{ color: "#f8fafc", label: "узлы", kind: "dot" as const }] : []),
    ];
  }

  return (
    <SimShell
      scene={
        <SceneCanvas key={scenario} camera={stage.camera} orbitTarget={stage.target} simplified={isMobile} maxDistance={45} minDistance={0.4} bloomThreshold={0.6} fogRange={stage.fog}>
          {guitar ? (
            <SceneGuitar key={clock.resetNonce} n={guitarN} A={0.015} running={clock.running} speed={clock.speed} onLive={handleGuitarLive} />
          ) : doppler ? (
            <SceneDoppler key={clock.resetNonce} vSource={vSource} running={clock.running} speed={clock.speed} onLive={handleDopplerLive} onFinished={handleFinished} />
          ) : (
            <SceneContent key={clock.resetNonce} A={A} k={k} w={w} standing={standing} running={clock.running} speed={clock.speed} onSample={handleSample} onLive={setLive} />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={handleToggleWithTone} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        guitar ? (
          <NumberReadouts
            items={[
              { label: "Время t", value: guitarLive.t.toFixed(2), unit: "с" },
              { label: "Номер гармоники n", value: String(guitarN), unit: "" },
              { label: "Частота f=nv/2L", value: guitarLive.f.toFixed(1), unit: "Гц", color: "#fbbf24" },
              { label: "Длина волны λ=2L/n", value: (2 * GUITAR_L / guitarN).toFixed(3), unit: "м" },
            ]}
          />
        ) : doppler ? (
          <NumberReadouts
            items={[
              { label: "Время t", value: dopplerLive.t.toFixed(2), unit: "с" },
              { label: "Частота источника", value: String(SIREN_F), unit: "Гц" },
              { label: "Наблюдаемая частота", value: dopplerLive.fObs.toFixed(0), unit: "Гц", color: dopplerLive.approaching ? "#4ade80" : "#f87171" },
              { label: "Статус", value: dopplerLive.approaching ? "приближается — выше тон" : "удаляется — ниже тон" },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "Время t", value: live.t.toFixed(2), unit: "с" },
              { label: "Скорость волны v=λf", value: v.toFixed(2), unit: "м/с" },
              { label: "Период T=1/f", value: T.toFixed(2), unit: "с" },
              { label: "Волновое число k", value: k.toFixed(2), unit: "1/м" },
              { label: "y ленточки 1", value: live.y1.toFixed(3), unit: "м", color: "#4ade80" },
              { label: "y ленточки 2", value: live.y2.toFixed(3), unit: "м", color: "#f87171" },
            ]}
          />
        )
      }
      graphs={
        guitar ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            Нажмите «Пуск» — включится реальный тон через Web Audio API. Меняйте номер гармоники n — частота
            меняется как f=n·v/(2L): вторая гармоника звучит на октаву выше первой.
          </div>
        ) : doppler ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">f_набл(t) — наблюдаемая частота сирены</p>
            <LiveChart data={dopplerSeries} xKey="t" xLabel="t, с" series={[{ key: "fObs", color: "#fbbf24", label: "f, Гц" }]} />
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">Колебания двух ленточек на шнуре y(t)</p>
            <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "y1", color: "#4ade80", label: "y₁, м" }, { key: "y2", color: "#f87171", label: "y₂, м" }]} />
          </div>
        )
      }
      note={
        guitar ? (
          <>
            Гитарная струна закреплена на обоих концах — это узлы. Гармоника n укладывает n полуволн на длине L:
            λ_n=2L/n, f_n=n·v/(2L)=n·f₁. Первая гармоника (n=1) — основной тон, остальные — обертоны, которые
            формируют тембр звука.
          </>
        ) : doppler ? (
          <>
            Эффект Доплера: f_набл=f_ист·v_звука/(v_звука+v_лс), где v_лс — скорость изменения расстояния
            «источник—наблюдатель» (проекция скорости источника на луч зрения). Когда скорая приближается,
            v_лс&lt;0 и частота выше; когда удаляется — v_лс&gt;0 и частота ниже. Резкий перепад тона в момент
            проезда мимо — и есть тот самый знакомый звук сирены.
          </>
        ) : standing ? (
          <>Стоячая волна y = 2A·sin(k(x₀ − x))·cos(ωt) — сумма прямой и отражённой от стойки волн. Белые кольца — узлы (не колеблются), расстояние между узлами λ/2.</>
        ) : (
          <>Бегущая волна y=A·sin(kx−ωt) переносит фазу колебаний со скоростью v=λf, каждая точка шнура колеблется с периодом T=1/f со сдвигом по фазе.</>
        )
      }
    />
  );
}
