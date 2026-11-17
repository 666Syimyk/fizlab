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
import { canvasTexture } from "@/components/sim/props/textures";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const RUBY_PERIOD = 9;
const PUMP_END = 0.42;
const FLASH_LEN = 0.06;

const N_ATOMS = 16;
const X_MIN = -3.2;
const X_MAX = 3.2;
const SWEEP_PERIOD = 6;
const MAX_PHOTONS = 16;
const TUBE_Y = 0.9;

interface SamplePoint {
  x: number;
  photons: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  photonCount: number;
  excitedRemaining: number;
}

/** Mirrors at both ends of a laser resonator; the right one lets part of the light out. */
function Mirrors({ y }: { y: number }) {
  return (
    <>
      {[X_MIN - 0.35, X_MAX + 0.35].map((x, i) => (
        <group key={x} position={[x, y, 0]}>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.42, 0.42, 0.06, 32]} />
            <meshStandardMaterial color={i === 0 ? "#e5e7eb" : "#bae6fd"} metalness={i === 0 ? 1 : 0.6} roughness={0.08} transparent={i === 1} opacity={i === 1 ? 0.7 : 1} />
          </mesh>
          <mesh position={[0, -(y - 0.05) / 2, 0]}>
            <boxGeometry args={[0.1, y - 0.1, 0.25]} />
            <meshStandardMaterial color="#334155" />
          </mesh>
        </group>
      ))}
      <SceneLabel position={[X_MIN - 0.35, y + 0.65, 0]}>зеркало</SceneLabel>
      <SceneLabel position={[X_MAX + 0.35, y + 0.65, 0]}>полупрозрачное зеркало</SceneLabel>
    </>
  );
}

interface SceneContentProps {
  pumpFraction: number;
  seed: number;
  running: boolean;
  speed: number;
  onSample: (n: LiveNumbers) => void;
}

/* ---------- a gas laser tube: stimulated emission avalanche ---------- */
function SceneContent({ pumpFraction, seed, running, speed, onSample }: SceneContentProps) {
  const atomRefs = useRef<(THREE.Mesh | null)[]>([]);
  const photonInstRef = useRef<THREE.InstancedMesh>(null!);
  const beamMat = useRef<THREE.MeshBasicMaterial>(null!);
  const dotMat = useRef<THREE.MeshBasicMaterial>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const atoms = useMemo(() => {
    let s = seed * 9301 + 49297;
    const rand = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    return Array.from({ length: N_ATOMS }, (_, i) => ({
      x: X_MIN + ((X_MAX - X_MIN) * (i + 0.5)) / N_ATOMS,
      excited: rand() < pumpFraction,
    }));
  }, [pumpFraction, seed]);

  const excitedStateRef = useRef<boolean[]>(atoms.map((a) => a.excited));

  const handleFrame = useCallback(
    (t: number) => {
      const frac = (t % SWEEP_PERIOD) / SWEEP_PERIOD;
      const frontX = X_MIN + (X_MAX - X_MIN) * frac;
      if (frac < 0.02) excitedStateRef.current = atoms.map((a) => a.excited);

      let photonCount = 1;
      atoms.forEach((a, i) => {
        if (a.x < frontX && excitedStateRef.current[i]) excitedStateRef.current[i] = false;
      });
      atoms.forEach((a) => {
        if (a.x < frontX && a.excited) photonCount++;
      });

      atomRefs.current.forEach((mesh, i) => {
        if (!mesh) return;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        const stillExcited = excitedStateRef.current[i];
        mat.color.set(stillExcited ? "#f87171" : "#52525b");
        mat.emissive.set(stillExcited ? "#f87171" : "#000000");
        mat.emissiveIntensity = stillExcited ? 0.7 : 0;
      });

      const mesh = photonInstRef.current;
      if (mesh) {
        for (let i = 0; i < MAX_PHOTONS; i++) {
          if (i < photonCount) {
            const spread = (i - photonCount / 2) * 0.035;
            dummy.position.set(frontX, TUBE_Y + spread, 0);
            dummy.scale.setScalar(0.05);
          } else {
            dummy.position.set(0, -999, 0);
            dummy.scale.setScalar(0.0001);
          }
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
      }
      // the light that leaks through the output mirror: the stronger the avalanche, the brighter the beam
      const out = frac > 0.92 ? Math.min(photonCount / MAX_PHOTONS, 1) : 0.08;
      if (beamMat.current) beamMat.current.opacity = 0.1 + out * 0.85;
      if (dotMat.current) dotMat.current.opacity = 0.15 + out * 0.85;
    },
    [atoms, dummy],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={(t) => {
          const frac = (t % SWEEP_PERIOD) / SWEEP_PERIOD;
          const frontX = X_MIN + (X_MAX - X_MIN) * frac;
          let photonCount = 1;
          let excitedRemaining = 0;
          atoms.forEach((a, i) => {
            if (a.x < frontX && a.excited) photonCount++;
            if (excitedStateRef.current[i]) excitedRemaining++;
          });
          onSample({ t, photonCount, excitedRemaining });
        }}
      />
      <LabBench position={[0.8, -0.9, 0]} length={9.6} depth={2.2} height={0.9} />
      {/* glass discharge tube of a gas laser */}
      <mesh position={[0, TUBE_Y, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.35, 0.35, X_MAX - X_MIN + 0.3, 32, 1, true]} />
        <meshStandardMaterial color="#fecdd3" transparent opacity={0.16} roughness={0.05} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <Mirrors y={TUBE_Y} />
      <SceneLabel position={[0, TUBE_Y + 0.75, 0]}>трубка лазера: возбуждённые атомы газа</SceneLabel>

      {atoms.map((a, i) => (
        <mesh
          key={i}
          position={[a.x, TUBE_Y - 0.18, 0]}
          ref={(el) => {
            atomRefs.current[i] = el;
          }}
        >
          <sphereGeometry args={[0.1, 14, 12]} />
          <meshStandardMaterial color={a.excited ? "#f87171" : "#52525b"} emissive={a.excited ? "#f87171" : "#000000"} emissiveIntensity={a.excited ? 0.7 : 0} />
        </mesh>
      ))}
      <instancedMesh ref={photonInstRef} args={[undefined, undefined, MAX_PHOTONS]} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial color="#fde047" toneMapped={false} />
      </instancedMesh>

      {/* output beam and the spot on a wall */}
      <mesh position={[(X_MAX + 0.4 + 5.2) / 2, TUBE_Y, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.03, 0.03, 5.2 - X_MAX - 0.4, 8]} />
        <meshBasicMaterial ref={beamMat} color="#ef4444" transparent opacity={0.2} toneMapped={false} />
      </mesh>
      <mesh position={[5.25, TUBE_Y, 0]}>
        <boxGeometry args={[0.05, 2.2, 1.6]} />
        <meshStandardMaterial color="#e5e7eb" roughness={0.9} />
      </mesh>
      <mesh position={[5.22, TUBE_Y, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <circleGeometry args={[0.1, 20]} />
        <meshBasicMaterial ref={dotMat} color="#ef4444" transparent opacity={0.2} toneMapped={false} />
      </mesh>
    </>
  );
}

/* ---------- Maiman's ruby laser: a ruby rod inside a helical flash lamp ---------- */
interface RubyLive {
  t: number;
  n0: number;
  n1: number;
  n2: number;
  photons: number;
  phase: string;
}

function SceneRuby({ pumpFraction, seed, running, speed, onLive }: { pumpFraction: number; seed: number; running: boolean; speed: number; onLive: (n: RubyLive) => void }) {
  const atomRefs = useRef<(THREE.Mesh | null)[]>([]);
  const photonInstRef = useRef<THREE.InstancedMesh>(null!);
  const lampMat = useRef<THREE.MeshStandardMaterial>(null!);
  const pulseMat = useRef<THREE.MeshBasicMaterial>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  // the energy-level diagram is drawn on a board above the device
  const E0_Y = 2.0;
  const E1_Y = 2.9;
  const E2_Y = 3.6;
  const lamp = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 400; i++) {
      const a = (i / 400) * Math.PI * 2 * 9;
      pts.push(new THREE.Vector3(-2.6 + (i / 400) * 5.2, TUBE_Y + Math.sin(a) * 0.5, Math.cos(a) * 0.5));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 600, 0.06, 8, false);
  }, []);
  useEffect(() => () => lamp.dispose(), [lamp]);

  const atoms = useMemo(() => {
    let s = seed * 9301 + 49297;
    const rand = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    return Array.from({ length: N_ATOMS }, (_, i) => ({
      x: X_MIN + ((X_MAX - X_MIN) * (i + 0.5)) / N_ATOMS,
      pumped: rand() < pumpFraction,
      pumpAt: rand() * PUMP_END * 0.75,
    }));
  }, [pumpFraction, seed]);

  const atLevel1Ref = useRef<boolean[]>(atoms.map(() => false));

  const handleFrame = useCallback(
    (t: number) => {
      const frac = (t % RUBY_PERIOD) / RUBY_PERIOD;
      if (frac < 0.01) atLevel1Ref.current = atoms.map(() => false);
      const avalancheFrac = Math.max(0, (frac - PUMP_END) / (1 - PUMP_END));
      const frontX = X_MIN + (X_MAX - X_MIN) * avalancheFrac;

      let photonCount = frac > PUMP_END ? 1 : 0;
      atoms.forEach((a, i) => {
        if (frac >= a.pumpAt && frac < PUMP_END) atLevel1Ref.current[i] = true;
        if (frac >= PUMP_END && a.x < frontX && atLevel1Ref.current[i]) atLevel1Ref.current[i] = false;
      });
      if (frac >= PUMP_END) {
        atoms.forEach((a) => {
          if (a.x < frontX && a.pumped && a.pumpAt < PUMP_END) photonCount++;
        });
      }

      atomRefs.current.forEach((mesh, i) => {
        if (!mesh) return;
        const a = atoms[i];
        const mat = mesh.material as THREE.MeshStandardMaterial;
        const inFlash = frac >= a.pumpAt && frac < a.pumpAt + FLASH_LEN && a.pumped;
        const atE1 = atLevel1Ref.current[i];
        mesh.position.y = inFlash ? E2_Y : atE1 ? E1_Y : E0_Y;
        const color = inFlash ? "#4ade80" : atE1 ? "#f87171" : "#52525b";
        mat.color.set(color);
        mat.emissive.set(inFlash || atE1 ? color : "#000000");
        mat.emissiveIntensity = inFlash ? 1 : atE1 ? 0.7 : 0;
      });

      const mesh = photonInstRef.current;
      if (mesh) {
        for (let i = 0; i < MAX_PHOTONS; i++) {
          if (i < photonCount && frac >= PUMP_END) {
            const spread = (i - photonCount / 2) * 0.04;
            dummy.position.set(frontX, E1_Y + spread, 0.05);
            dummy.scale.setScalar(0.055);
          } else {
            dummy.position.set(0, -999, 0);
            dummy.scale.setScalar(0.0001);
          }
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
      }
      // the flash lamp flares during pumping, the red pulse leaves at the end of the avalanche
      if (lampMat.current) lampMat.current.emissiveIntensity = frac < PUMP_END ? 1.2 + 1.5 * Math.sin(frac * 60) ** 2 : 0.1;
      if (pulseMat.current) pulseMat.current.opacity = frac > 0.9 ? 0.95 : 0.05;
    },
    [atoms, dummy],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={15}
        onSample={(t) => {
          const frac = (t % RUBY_PERIOD) / RUBY_PERIOD;
          let n2 = 0;
          let n1 = 0;
          atoms.forEach((a, i) => {
            const inFlash = frac >= a.pumpAt && frac < a.pumpAt + FLASH_LEN && a.pumped;
            if (inFlash) n2++;
            else if (atLevel1Ref.current[i]) n1++;
          });
          const n0 = N_ATOMS - n1 - n2;
          const avalancheFrac = Math.max(0, (frac - PUMP_END) / (1 - PUMP_END));
          const frontX = X_MIN + (X_MAX - X_MIN) * avalancheFrac;
          let photons = frac > PUMP_END ? 1 : 0;
          if (frac >= PUMP_END) atoms.forEach((a) => { if (a.x < frontX && a.pumped && a.pumpAt < PUMP_END) photons++; });
          const phase = frac < PUMP_END ? "накачка" : frac < PUMP_END + 0.05 ? "инверсия достигнута" : "лавина";
          onLive({ t, n0, n1, n2, photons, phase });
        }}
      />
      <LabBench position={[0.8, -0.9, 0]} length={9.6} depth={2.4} height={0.9} />
      {/* ruby rod, the spiral flash lamp around it and the mirrors */}
      <mesh position={[0, TUBE_Y, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.2, 0.2, 5.6, 28]} />
        <meshStandardMaterial color="#e11d48" transparent opacity={0.75} roughness={0.15} emissive="#9f1239" emissiveIntensity={0.3} />
      </mesh>
      <mesh geometry={lamp}>
        <meshStandardMaterial ref={lampMat} color="#f8fafc" emissive="#e0f2fe" emissiveIntensity={0.1} transparent opacity={0.8} toneMapped={false} />
      </mesh>
      <Mirrors y={TUBE_Y} />
      <SceneLabel position={[0, TUBE_Y - 0.85, 0.6]}>рубиновый стержень в спиральной лампе-вспышке</SceneLabel>
      <mesh position={[(X_MAX + 0.4 + 5.2) / 2, TUBE_Y, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.06, 0.06, 5.2 - X_MAX - 0.4, 10]} />
        <meshBasicMaterial ref={pulseMat} color="#f43f5e" transparent opacity={0.05} toneMapped={false} />
      </mesh>

      {/* energy-level board */}
      <mesh position={[0, 2.8, -0.2]}>
        <boxGeometry args={[7.4, 2.2, 0.05]} />
        <meshStandardMaterial color="#0f172a" roughness={0.8} />
      </mesh>
      {[E0_Y, E1_Y, E2_Y].map((y) => (
        <mesh key={y} position={[0, y - 0.18, -0.15]}>
          <boxGeometry args={[X_MAX - X_MIN + 0.4, 0.015, 0.01]} />
          <meshBasicMaterial color="#64748b" />
        </mesh>
      ))}
      <SceneLabel position={[X_MIN - 0.3, E0_Y, 0]}>E₀ основной</SceneLabel>
      <SceneLabel position={[X_MIN - 0.3, E1_Y, 0]}>E₁ «долгий»</SceneLabel>
      <SceneLabel position={[X_MIN - 0.3, E2_Y, 0]}>E₂ накачка</SceneLabel>
      {atoms.map((a, i) => (
        <mesh
          key={i}
          position={[a.x, E0_Y, 0]}
          ref={(el) => {
            atomRefs.current[i] = el;
          }}
        >
          <sphereGeometry args={[0.12, 14, 12]} />
          <meshStandardMaterial color="#52525b" />
        </mesh>
      ))}
      <instancedMesh ref={photonInstRef} args={[undefined, undefined, MAX_PHOTONS]} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial color="#f43f5e" toneMapped={false} />
      </instancedMesh>
    </>
  );
}

/* ---------- an X-ray picture of a hand ---------- */
function xrayFilm() {
  return canvasTexture("xray-hand", 256, 320, (ctx, w, h) => {
    ctx.fillStyle = "#020617";
    ctx.fillRect(0, 0, w, h);
    // soft tissue
    ctx.fillStyle = "rgba(148,163,184,0.45)";
    ctx.beginPath();
    ctx.roundRect(70, 150, 120, 150, 30);
    ctx.fill();
    for (let f = 0; f < 4; f++) {
      ctx.beginPath();
      ctx.roundRect(72 + f * 30, 40 + (f === 0 || f === 3 ? 25 : 0), 24, 130, 12);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(205, 195, 18, 55, -0.6, 0, Math.PI * 2);
    ctx.fill();
    // bones absorb X-rays: they stay white on the film
    ctx.fillStyle = "#f8fafc";
    for (let f = 0; f < 4; f++) {
      const x = 80 + f * 30;
      const top = 50 + (f === 0 || f === 3 ? 25 : 0);
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.roundRect(x, top + k * 38, 9, 32, 4);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.roundRect(x, 170, 9, 70, 4);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.roundRect(196, 160, 9, 60, 4);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(95, 248, 70, 40, 10);
    ctx.fill();
  });
}

function SceneXray({ kV, running, speed }: { kV: number; running: boolean; speed: number }) {
  const rays = useRef<THREE.InstancedMesh>(null!);
  const electrons = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const film = useMemo(() => xrayFilm(), []);
  const N = 40;
  const NE = 8;
  // higher voltage → harder (more penetrating) X-rays → the soft tissue looks darker, bones stand out
  const brightness = THREE.MathUtils.clamp((kV - 15) / 100, 0.15, 1);
  const dirs = useMemo(() => Array.from({ length: N }, (_, i) => ({ y: Math.sin(i * 2.3) * 0.75, z: Math.cos(i * 1.7) * 0.55, phase: i / N })), []);

  const handleFrame = useCallback(
    (t: number) => {
      const r = rays.current;
      if (r) {
        dirs.forEach((d, i) => {
          const u = (t * 0.9 + d.phase) % 1;
          dummy.position.set(-1.2 + u * 3.4, 2.4 - u * (2.4 - (1.35 + d.y)), d.z * u);
          dummy.scale.setScalar(0.035);
          dummy.updateMatrix();
          r.setMatrixAt(i, dummy.matrix);
        });
        r.instanceMatrix.needsUpdate = true;
      }
      const e = electrons.current;
      if (e) {
        for (let i = 0; i < NE; i++) {
          const u = (t * (0.6 + kV / 150) + i / NE) % 1;
          dummy.position.set(-2.55 + u * 1.2, 2.4, 0);
          dummy.scale.setScalar(0.03);
          dummy.updateMatrix();
          e.setMatrixAt(i, dummy.matrix);
        }
        e.instanceMatrix.needsUpdate = true;
      }
    },
    [dirs, dummy, kV],
  );

  return (
    <>
      <PhysicsTicker running={running} speed={speed} onFrame={handleFrame} />
      <LabBench position={[0.4, -0.9, 0]} length={7} depth={2.6} height={0.9} />
      {/* X-ray tube: hot cathode → electrons → tungsten anode → X-rays */}
      <group>
        <mesh position={[-1.9, 2.4, 0]} rotation={[0, 0, Math.PI / 2]}>
          <capsuleGeometry args={[0.35, 1.6, 8, 24]} />
          <meshStandardMaterial color="#e0f2fe" transparent opacity={0.18} roughness={0.05} depthWrite={false} />
        </mesh>
        <mesh position={[-2.7, 2.4, 0]}>
          <torusGeometry args={[0.08, 0.02, 8, 16]} />
          <meshBasicMaterial color="#fb923c" toneMapped={false} />
        </mesh>
        <mesh position={[-1.2, 2.4, 0]} rotation={[0, 0, 0.6]}>
          <boxGeometry args={[0.12, 0.4, 0.4]} />
          <meshStandardMaterial color="#9ca3af" metalness={0.9} roughness={0.25} />
        </mesh>
        <mesh position={[-1.9, 1.45, 0]}>
          <boxGeometry args={[1.8, 0.2, 0.6]} />
          <meshStandardMaterial color="#334155" />
        </mesh>
        <mesh position={[-1.9, 0.7, 0]}>
          <cylinderGeometry args={[0.08, 0.08, 1.4, 10]} />
          <meshStandardMaterial color="#334155" />
        </mesh>
        <SceneLabel position={[-1.9, 3.05, 0]}>{`рентгеновская трубка, U = ${kV} кВ`}</SceneLabel>
        <SceneLabel position={[-2.7, 2.0, 0.4]}>катод</SceneLabel>
        <SceneLabel position={[-1.15, 2.0, 0.45]}>анод</SceneLabel>
      </group>
      <instancedMesh ref={electrons} args={[undefined, undefined, NE]} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial color="#38bdf8" toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={rays} args={[undefined, undefined, N]} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial color="#c4b5fd" toneMapped={false} transparent opacity={0.8} />
      </instancedMesh>

      {/* a hand on the table, the detector under it shows the picture */}
      <group position={[0.6, 1.25, 0]}>
        <mesh>
          <boxGeometry args={[0.9, 0.12, 0.7]} />
          <meshStandardMaterial color="#e8b48a" roughness={0.7} />
        </mesh>
        {[-0.27, -0.09, 0.09, 0.27].map((z, i) => (
          <mesh key={z} position={[0.62, 0, z]} rotation={[0, 0, Math.PI / 2]}>
            <capsuleGeometry args={[0.06, i === 0 || i === 3 ? 0.3 : 0.42, 6, 12]} />
            <meshStandardMaterial color="#e8b48a" roughness={0.7} />
          </mesh>
        ))}
        <mesh position={[0.15, 0, 0.45]} rotation={[0.6, 0, Math.PI / 2]}>
          <capsuleGeometry args={[0.065, 0.3, 6, 12]} />
          <meshStandardMaterial color="#e8b48a" roughness={0.7} />
        </mesh>
        <SceneLabel position={[0.3, 0.45, 0]}>рука</SceneLabel>
      </group>
      <mesh position={[0.75, 0.51, 0]} castShadow>
        <boxGeometry args={[2.1, 1.02, 1.7]} />
        <meshStandardMaterial color="#1f2937" roughness={0.6} />
      </mesh>
      <SceneLabel position={[1.9, 0.6, 0.9]}>детектор (вместо плёнки)</SceneLabel>
      <group position={[0.75, 1.03, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[2.0, 1.6]} />
          <meshBasicMaterial map={film} toneMapped={false} color={new THREE.Color().setScalar(0.35 + 0.65 * brightness)} />
        </mesh>
      </group>
      <group position={[2.9, 1.4, -0.4]} rotation={[0, -0.5, 0]}>
        <mesh>
          <boxGeometry args={[1.3, 1.6, 0.06]} />
          <meshStandardMaterial color="#111827" />
        </mesh>
        <mesh position={[0, 0, 0.032]}>
          <planeGeometry args={[1.1, 1.4]} />
          <meshBasicMaterial map={film} toneMapped={false} />
        </mesh>
        <SceneLabel position={[0, 1.05, 0]}>снимок: кости задерживают лучи</SceneLabel>
      </group>
    </>
  );
}

export function XrayLasersSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, pumpFraction, kV } = useControls("Лазер: вынужденное излучение", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Лазерная трубка: лавина фотонов": "abstract", "Рубиновый лазер (3 уровня)": "ruby", "Рентгеновский снимок руки": "xray" },
    },
    pumpFraction: { value: 0.6, min: 0.1, max: 0.95, step: 0.05, label: "Доля накачанных атомов", render: (get) => get("Лазер: вынужденное излучение.scenario") !== "xray" },
    kV: { value: 60, min: 20, max: 150, step: 5, label: "Напряжение трубки U, кВ", render: (get) => get("Лазер: вынужденное излучение.scenario") === "xray" },
  });
  const isRuby = scenario === "ruby";
  const isXray = scenario === "xray";

  const [seed, setSeed] = useState(1);
  const [live, setLive] = useState<LiveNumbers>({ t: 0, photonCount: 1, excitedRemaining: 0 });
  const [series, setSeries] = useState<SamplePoint[]>([{ x: X_MIN, photons: 1 }]);
  const [rubyLive, setRubyLive] = useState<RubyLive>({ t: 0, n0: N_ATOMS, n1: 0, n2: 0, photons: 0, phase: "накачка" });

  const handleSample = useCallback((n: LiveNumbers) => {
    setLive(n);
    const frac = (n.t % SWEEP_PERIOD) / SWEEP_PERIOD;
    const x = X_MIN + (X_MAX - X_MIN) * frac;
    setSeries((prev) => {
      if (frac < 0.03) return [{ x: Number(x.toFixed(2)), photons: n.photonCount }];
      return prev.length > 300 ? prev : [...prev, { x: Number(x.toFixed(2)), photons: n.photonCount }];
    });
  }, []);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    setSeed((s) => s + 1);
  }, [clock]);

  const nExcitedInit = Math.round(pumpFraction * N_ATOMS);
  const lambdaMinPm = (1.2398 / kV) * 1000;
  const caption = isXray ? (
    <>
      Электроны из горячего катода разгоняются напряжением {kV} кВ и врезаются в вольфрамовый анод — их энергия превращается в <b>рентгеновские лучи</b> (самая короткая волна λ = 1,24/U = {lambdaMinPm.toFixed(0)}{" "}
      пм). Лучи легко проходят через мягкие ткани, а кости их задерживают — поэтому на снимке кости белые.
    </>
  ) : isRuby ? (
    rubyLive.phase === "накачка" ? (
      <>
        Лампа-вспышка «накачивает» ионы хрома в рубине: они подскакивают на уровень E₂ (зелёные) и тут же сползают на «долгий» уровень E₁ (красные), где задерживаются. Скоро возбуждённых станет
        больше, чем невозбуждённых, — <b>инверсия</b>.
      </>
    ) : (
      <>
        Один фотон 694 нм вызывает у возбуждённого атома испускание <b>точно такого же</b> фотона — лавина растёт и вылетает из полупрозрачного зеркала мощным красным импульсом. Так в 1960 году
        заработал первый лазер.
      </>
    )
  ) : (
    <>
      Фотон пролетает мимо возбуждённого атома (красного) и «заставляет» его выпустить копию себя — того же цвета и направления. Фотонов становится 2, 4, 8… — <b>лавина</b>. Зеркала гоняют свет
      туда-обратно, а через полупрозрачное зеркало выходит узкий яркий луч. Сейчас фотонов: {live.photonCount}.
    </>
  );
  const legend: LegendItem[] = isXray
    ? [
        { color: "#38bdf8", label: "электроны", kind: "dot" },
        { color: "#c4b5fd", label: "рентгеновские лучи", kind: "dot" },
      ]
    : [
        { color: "#f87171", label: "возбуждённый атом", kind: "dot" },
        { color: "#52525b", label: "невозбуждённый", kind: "dot" },
        { color: isRuby ? "#f43f5e" : "#fde047", label: "фотоны", kind: "dot" },
      ];

  return (
    <SimShell
      scene={
        <SceneCanvas
          key={scenario}
          camera={isXray ? { position: [1.6, 3.4, 5.6] as [number, number, number], fov: 50 } : isRuby ? { position: [0.8, 3.0, 8.4] as [number, number, number], fov: 50 } : { position: [0.8, 2.4, 7.6] as [number, number, number], fov: 50 }}
          orbitTarget={isXray ? [0.2, 1.6, 0] : isRuby ? [0.8, 1.8, 0] : [0.8, 0.9, 0]}
          simplified={isMobile}
          maxDistance={18}
          minDistance={3}
          bloomThreshold={0.7}
          fogRange={[16, 45]}
        >
          {isXray ? (
            <SceneXray key={clock.resetNonce} kV={kV} running={clock.running} speed={clock.speed} />
          ) : isRuby ? (
            <SceneRuby key={clock.resetNonce} pumpFraction={pumpFraction} seed={seed} running={clock.running} speed={clock.speed} onLive={setRubyLive} />
          ) : (
            <SceneContent key={clock.resetNonce} pumpFraction={pumpFraction} seed={seed} running={clock.running} speed={clock.speed} onSample={handleSample} />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        isXray ? (
          <NumberReadouts
            items={[
              { label: "Напряжение трубки U", value: kV.toFixed(0), unit: "кВ" },
              { label: "Макс. энергия фотона eU", value: kV.toFixed(0), unit: "кэВ" },
              { label: "λ_min = hc/(eU) = 1,24/U", value: lambdaMinPm.toFixed(1), unit: "пм", color: "#c4b5fd" },
            ]}
          />
        ) : isRuby ? (
          <NumberReadouts
            items={[
              { label: "Фаза", value: rubyLive.phase },
              { label: "N₀ (основное сост.)", value: rubyLive.n0.toString() },
              { label: "N₁ (метастабильное)", value: rubyLive.n1.toString(), color: "#f87171" },
              { label: "N₂ (полоса накачки)", value: rubyLive.n2.toString(), color: "#4ade80" },
              { label: "Фотонов 694нм сейчас", value: rubyLive.photons.toString(), color: "#f43f5e" },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "Атомов в накачанном состоянии (старт)", value: nExcitedInit.toString(), unit: `/ ${N_ATOMS}` },
              { label: "Фотонов сейчас", value: live.photonCount.toString(), color: "#fbbf24" },
              { label: "Осталось возбуждённых атомов", value: live.excitedRemaining.toString() },
            ]}
          />
        )
      }
      graphs={
        isXray ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            Рентгеновское излучение возникает при резком торможении быстрых электронов в веществе анода
            (тормозное излучение) — его спектр обрывается на минимальной длине волны λ_min=hc/(eU) (закон
            Дуэйна–Ханта): вся энергия электрона переходит в один фотон. Чем выше напряжение, тем «жёстче»
            лучи и тем легче они проходят сквозь тело; сильнее всего их поглощают тяжёлые атомы (кальций
            в костях, свинец в защитном фартуке).
          </div>
        ) : isRuby ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            Настоящий рубиновый лазер (первый в истории, 1960 год) работает по трёхуровневой схеме: лампа
            накачки забрасывает электроны хрома в кристалле рубина на короткоживущую полосу накачки E₂
            (зелёная вспышка), откуда они почти мгновенно и безызлучательно (в тепло) соскальзывают на
            долгоживущий метастабильный уровень E₁. Атомы там накапливаются, пока не образуется инверсия
            населённостей (N₁&gt;N₀) — а затем один спонтанно испущенный фотон 694нм запускает лавину
            вынужденного излучения E₁→E₀, дающую когерентный красный лазерный импульс.
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">Число фотонов вдоль резонатора — лавинное усиление</p>
            <LiveChart data={series} xKey="x" xType="number" xLabel="x, усл.ед." series={[{ key: "photons", color: "#fbbf24", label: "фотонов" }]} />
          </div>
        )
      }
      note={
        isXray ? (
          <>
            Рентгеновские снимки, компьютерная томография, досмотр багажа в аэропорту и анализ кристаллов —
            всё это использует проникающую способность коротких электромагнитных волн. Доза при одном снимке
            руки очень мала (около 0,001 мЗв — меньше, чем за день естественного фона).
          </>
        ) : isRuby ? (
          <>
            Почему нужны именно три уровня, а не два: если бы стимулированное излучение шло сразу обратно
            на тот же уровень, с которого накачивали, инверсию населённостей создать было бы невозможно
            (закон термодинамики уравнял бы населённости). Промежуточный быстрый безызлучательный переход
            E₂→E₁ и «застревание» на метастабильном E₁ — ключевой трюк, который делает лазер возможным.
          </>
        ) : (
          <>
            Инверсия населённостей (много атомов в возбуждённом состоянии, красные) — необходимое условие
            лазера. Одиночный фотон, проходя мимо возбуждённого атома, стимулирует его на испускание точно
            такого же (когерентного) фотона — атом переходит в основное состояние. Число фотонов лавинообразно
            растёт — это и есть LASER (Light Amplification by Stimulated Emission of Radiation).
          </>
        )
      }
    />
  );
}
