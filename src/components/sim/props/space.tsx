import { forwardRef, useMemo, useRef } from "react";
import { useFrame, type ThreeElements } from "@react-three/fiber";
import * as THREE from "three";
import { canvasTexture, earthTexture, marsTexture, rockyTexture, sunTexture } from "./textures";

type GroupProps = Omit<ThreeElements["group"], "ref">;

export type PlanetKind = "earth" | "mars" | "mercury" | "moon";

function glowTexture() {
  return canvasTexture("radial-glow", 128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.25, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

/** Textured planet with optional atmosphere halo; spins slowly about its axis. */
export const Planet = forwardRef<THREE.Group, GroupProps & { kind: PlanetKind; radius?: number; spin?: number }>(function Planet({ kind, radius = 1, spin = 0.05, ...group }, ref) {
  const body = useRef<THREE.Mesh>(null!);
  const map = useMemo(() => (kind === "earth" ? earthTexture() : kind === "mars" ? marsTexture() : kind === "mercury" ? rockyTexture(31, [150, 140, 128]) : rockyTexture(47, [170, 170, 168])), [kind]);
  useFrame((_, dt) => {
    if (body.current) body.current.rotation.y += spin * dt;
  });
  return (
    <group ref={ref} {...group}>
      <mesh ref={body} rotation={[0.41, 0, 0]}>
        <sphereGeometry args={[radius, 64, 40]} />
        <meshStandardMaterial map={map} roughness={1} metalness={0} envMapIntensity={0.05} />
      </mesh>
      {(kind === "earth" || kind === "mars") && (
        <mesh scale={1.04}>
          <sphereGeometry args={[radius, 48, 32]} />
          <meshBasicMaterial color={kind === "earth" ? "#60a5fa" : "#fb923c"} transparent opacity={0.14} side={THREE.BackSide} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      )}
    </group>
  );
});

/** Glowing sun: unlit textured sphere plus a soft halo sprite. */
export const Sun = forwardRef<THREE.Group, GroupProps & { radius?: number }>(function Sun({ radius = 1, ...group }, ref) {
  const map = useMemo(() => sunTexture(), []);
  const glow = useMemo(() => glowTexture(), []);
  const body = useRef<THREE.Mesh>(null!);
  useFrame((_, dt) => {
    if (body.current) body.current.rotation.y += 0.04 * dt;
  });
  return (
    <group ref={ref} {...group}>
      <mesh ref={body}>
        <sphereGeometry args={[radius, 48, 32]} />
        <meshBasicMaterial map={map} toneMapped={false} />
      </mesh>
      <sprite scale={radius * 5}>
        <spriteMaterial map={glow} color="#fbbf24" transparent opacity={0.65} depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
    </group>
  );
});

const panel = <meshStandardMaterial color="#1e3a8a" emissive="#1d4ed8" emissiveIntensity={0.25} metalness={0.6} roughness={0.3} />;
const gold = <meshStandardMaterial color="#d4a017" metalness={0.9} roughness={0.35} />;
const white = <meshStandardMaterial color="#e5e7eb" metalness={0.3} roughness={0.5} />;

/** International Space Station silhouette: long truss with 8 solar wings and pressurised modules. Length ≈ 1 at scale 1. */
export const SpaceStation = forwardRef<THREE.Group, GroupProps>(function SpaceStation(group, ref) {
  return (
    <group ref={ref} {...group}>
      <mesh>
        <boxGeometry args={[1.0, 0.035, 0.035]} />
        {white}
      </mesh>
      {[-0.42, -0.3, 0.3, 0.42].map((x) =>
        [-1, 1].map((s) => (
          <mesh key={`${x}${s}`} position={[x, 0, s * 0.2]}>
            <boxGeometry args={[0.09, 0.006, 0.34]} />
            {panel}
          </mesh>
        )),
      )}
      <mesh position={[0, 0, 0.07]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.035, 0.035, 0.22, 12]} />
        {white}
      </mesh>
      <mesh position={[0.06, 0, 0.1]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.03, 0.03, 0.16, 12]} />
        {white}
      </mesh>
      <mesh position={[0, 0.06, 0.04]}>
        <boxGeometry args={[0.16, 0.004, 0.08]} />
        {white}
      </mesh>
    </group>
  );
});

/** Small satellite: gold-foil bus, two solar wings and a dish antenna. Size ≈ 1 at scale 1. */
export const Satellite = forwardRef<THREE.Group, GroupProps>(function Satellite(group, ref) {
  return (
    <group ref={ref} {...group}>
      <mesh>
        <boxGeometry args={[0.22, 0.22, 0.22]} />
        {gold}
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[0, 0, s * 0.32]}>
            <boxGeometry args={[0.02, 0.02, 0.18]} />
            {white}
          </mesh>
          <mesh position={[0, 0, s * 0.62]}>
            <boxGeometry args={[0.22, 0.008, 0.46]} />
            {panel}
          </mesh>
        </group>
      ))}
      <mesh position={[0.16, 0.1, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.1, 0.06, 18, 1, true]} />
        <meshStandardMaterial color="#f8fafc" metalness={0.3} roughness={0.4} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
});
