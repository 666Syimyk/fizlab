import { useEffect, useMemo } from "react";
import type { ThreeElements } from "@react-three/fiber";
import * as THREE from "three";
import { asphaltTexture, concreteTexture, grassTexture, iceTexture, parquetTexture, roadTexture, seededRandom, snowTexture, textTexture, tileTexture, trackTexture, woodTexture } from "./textures";

type GroupProps = Omit<ThreeElements["group"], "ref">;

const SURFACES = {
  road: roadTexture,
  track: trackTexture,
  grass: grassTexture,
  ice: iceTexture,
  parquet: parquetTexture,
  snow: snowTexture,
  tiles: tileTexture,
  asphalt: asphaltTexture,
  concrete: concreteTexture,
  wood: () => woodTexture("light", 6),
} as const;

export type SurfaceKind = keyof typeof SURFACES;

interface GroundProps {
  kind: SurfaceKind;
  /** x-range covered by the strip */
  from: number;
  to: number;
  /** strip width along z */
  width: number;
  /** metres of ground per texture tile along x */
  tile?: number;
  /** tile length across z (defaults to the full width = one tile) */
  tileZ?: number;
  y?: number;
  z?: number;
}

/** Textured ground strip along x (road, running track, ice rink, lawn, parquet...). */
export function Ground({ kind, from, to, width, tile = 4, tileZ, y = 0, z = 0 }: GroundProps) {
  const length = to - from;
  const texture = useMemo(() => {
    const t = SURFACES[kind]().clone();
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(length / tile, tileZ ? width / tileZ : 1);
    t.needsUpdate = true;
    return t;
  }, [kind, length, tile, tileZ, width]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh position={[(from + to) / 2, y, z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[length, width]} />
      <meshStandardMaterial map={texture} roughness={kind === "ice" ? 0.15 : 0.9} metalness={kind === "ice" ? 0.1 : 0} />
    </mesh>
  );
}

/** Simple deciduous/conifer tree, base on y = 0. */
export function Tree({ height = 5, conifer = false, seed = 1, ...group }: GroupProps & { height?: number; conifer?: boolean; seed?: number }) {
  const rand = useMemo(() => seededRandom(seed * 97 + 13), [seed]);
  const hue = useMemo(() => `hsl(${110 + rand() * 30}, ${38 + rand() * 18}%, ${24 + rand() * 10}%)`, [rand]);
  const trunkH = height * (conifer ? 0.3 : 0.42);
  return (
    <group {...group}>
      <mesh position={[0, trunkH / 2, 0]} castShadow>
        <cylinderGeometry args={[height * 0.035, height * 0.05, trunkH, 8]} />
        <meshStandardMaterial color="#5b3a22" roughness={0.9} />
      </mesh>
      {conifer ? (
        <>
          <mesh position={[0, trunkH + height * 0.22, 0]} castShadow>
            <coneGeometry args={[height * 0.24, height * 0.45, 10]} />
            <meshStandardMaterial color={hue} roughness={0.85} />
          </mesh>
          <mesh position={[0, trunkH + height * 0.48, 0]} castShadow>
            <coneGeometry args={[height * 0.17, height * 0.35, 10]} />
            <meshStandardMaterial color={hue} roughness={0.85} />
          </mesh>
        </>
      ) : (
        <>
          <mesh position={[0, trunkH + height * 0.25, 0]} castShadow>
            <icosahedronGeometry args={[height * 0.3, 1]} />
            <meshStandardMaterial color={hue} roughness={0.85} flatShading />
          </mesh>
          <mesh position={[height * 0.12, trunkH + height * 0.4, height * 0.05]} castShadow>
            <icosahedronGeometry args={[height * 0.2, 1]} />
            <meshStandardMaterial color={hue} roughness={0.85} flatShading />
          </mesh>
        </>
      )}
    </group>
  );
}

/** Roadside distance post with a sign ("20 м"), base on y = 0, sign facing +z. */
export function DistancePost({ text, height = 1.2, color = "#f4f4f5", ...group }: GroupProps & { text: string; height?: number; color?: string }) {
  const tex = useMemo(() => textTexture(text, { color: "#111827", background: "#fde047", font: "bold 60px sans-serif", width: 192, height: 96 }), [text]);
  return (
    <group {...group}>
      <mesh position={[0, height / 2, 0]} castShadow>
        <boxGeometry args={[0.1, height, 0.1]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      <mesh position={[0, height * 0.82, 0]}>
        <boxGeometry args={[0.105, height * 0.12, 0.105]} />
        <meshStandardMaterial color="#111827" roughness={0.6} />
      </mesh>
      <mesh position={[0, height + 0.22, 0.056]}>
        <planeGeometry args={[0.8, 0.4]} />
        <meshStandardMaterial map={tex} roughness={0.6} />
      </mesh>
    </group>
  );
}

/** Laboratory bench: wooden top whose upper surface is at y = height. */
export function LabBench({ length = 3, depth = 1.2, height = 0.9, ...group }: GroupProps & { length?: number; depth?: number; height?: number }) {
  const wood = woodTexture("medium", 5);
  return (
    <group {...group}>
      <mesh position={[0, height - 0.04, 0]} castShadow receiveShadow>
        <boxGeometry args={[length, 0.08, depth]} />
        <meshStandardMaterial map={wood} roughness={0.7} />
      </mesh>
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`${sx}${sz}`} position={[sx * (length / 2 - 0.1), (height - 0.08) / 2, sz * (depth / 2 - 0.1)]} castShadow>
            <boxGeometry args={[0.07, height - 0.08, 0.07]} />
            <meshStandardMaterial color="#3f3f46" metalness={0.6} roughness={0.5} />
          </mesh>
        )),
      )}
    </group>
  );
}

/** Retort stand (штатив): base plate, vertical rod and a horizontal arm ending at (armLength, height). */
export function RetortStand({ height = 2, armLength = 0.6, ...group }: GroupProps & { height?: number; armLength?: number }) {
  return (
    <group {...group}>
      <mesh position={[0, 0.02, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.5, 0.04, 0.35]} />
        <meshStandardMaterial color="#27272a" metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[-0.15, height / 2, 0]} castShadow>
        <cylinderGeometry args={[0.02, 0.02, height, 10]} />
        <meshStandardMaterial color="#a1a1aa" metalness={0.9} roughness={0.25} />
      </mesh>
      <mesh position={[-0.15 + armLength / 2, height - 0.03, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.016, 0.016, armLength, 10]} />
        <meshStandardMaterial color="#a1a1aa" metalness={0.9} roughness={0.25} />
      </mesh>
      <mesh position={[-0.15, height - 0.03, 0]}>
        <boxGeometry args={[0.06, 0.06, 0.06]} />
        <meshStandardMaterial color="#3f3f46" metalness={0.6} roughness={0.4} />
      </mesh>
    </group>
  );
}
