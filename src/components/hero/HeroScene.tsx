import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Float, Sparkles, Stars } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";

interface HeroSceneProps {
  reducedMotion: boolean;
  mobile: boolean;
}

const ORBIT_COLORS = ["#7c6cf5", "#5eead4", "#f0abfc", "#fbbf24"];

function OrbitPath({ radius }: { radius: number }) {
  return (
    <mesh rotation-x={Math.PI / 2}>
      <ringGeometry args={[radius - 0.012, radius + 0.012, 96]} />
      <meshBasicMaterial
        color="#7c6cf5"
        transparent
        opacity={0.18}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

function Planet({
  radius,
  speed,
  size,
  color,
  offset,
  paused,
}: {
  radius: number;
  speed: number;
  size: number;
  color: string;
  offset: number;
  paused: boolean;
}) {
  const ref = useRef<THREE.Group>(null);
  const angle = useRef(offset);

  useFrame((_, delta) => {
    if (!ref.current) return;
    if (!paused) angle.current += delta * speed;
    ref.current.position.x = Math.cos(angle.current) * radius;
    ref.current.position.z = Math.sin(angle.current) * radius;
  });

  return (
    <group ref={ref}>
      <mesh>
        <sphereGeometry args={[size, 24, 24]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={1.1}
          roughness={0.3}
          metalness={0.4}
        />
      </mesh>
    </group>
  );
}

function OrbitSystem({ paused, mobile }: { paused: boolean; mobile: boolean }) {
  const orbits = useMemo(() => {
    const count = mobile ? 3 : 5;
    return Array.from({ length: count }, (_, i) => ({
      radius: 1.8 + i * 0.9,
      speed: 0.22 - i * 0.03,
      size: 0.09 + (i % 2) * 0.05,
      color: ORBIT_COLORS[i % ORBIT_COLORS.length],
      offset: (i / count) * Math.PI * 2,
    }));
  }, [mobile]);

  return (
    <group rotation-x={0.35}>
      <mesh>
        <sphereGeometry args={[0.32, 32, 32]} />
        <meshStandardMaterial
          color="#f4f4f5"
          emissive="#7c6cf5"
          emissiveIntensity={1.6}
          roughness={0.2}
        />
      </mesh>
      {orbits.map((orbit, i) => (
        <group key={i}>
          <OrbitPath radius={orbit.radius} />
          <Planet {...orbit} paused={paused} />
        </group>
      ))}
    </group>
  );
}

function Pendulum({ paused }: { paused: boolean }) {
  const pivot = useRef<THREE.Group>(null);
  const t = useRef(0);

  useFrame((_, delta) => {
    if (!pivot.current) return;
    if (!paused) t.current += delta;
    pivot.current.rotation.z = Math.sin(t.current * 1.1) * 0.5;
  });

  return (
    <group position={[-3.4, 2.4, -1.5]}>
      <group ref={pivot}>
        <mesh position={[0, -1.1, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 2.2, 8]} />
          <meshStandardMaterial color="#71717a" />
        </mesh>
        <mesh position={[0, -2.2, 0]}>
          <sphereGeometry args={[0.22, 32, 32]} />
          <meshStandardMaterial
            color="#5eead4"
            emissive="#5eead4"
            emissiveIntensity={1.2}
            roughness={0.25}
            metalness={0.4}
          />
        </mesh>
      </group>
    </group>
  );
}

function CameraRig({ enabled }: { enabled: boolean }) {
  const { camera, pointer } = useThree();
  const base = useMemo(() => camera.position.clone(), [camera]);

  useFrame(() => {
    if (!enabled) return;
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, base.x + pointer.x * 1.1, 0.04);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, base.y + pointer.y * 0.6, 0.04);
    camera.lookAt(0, 0.4, 0);
  });

  return null;
}

export function HeroScene({ reducedMotion, mobile }: HeroSceneProps) {
  return (
    <>
      <color attach="background" args={["#0a0a0c"]} />
      <fog attach="fog" args={["#0a0a0c", 8, 22]} />
      <ambientLight intensity={0.4} />
      <directionalLight position={[4, 6, 4]} intensity={1} />
      <pointLight position={[-4, 2, -2]} intensity={0.6} color="#7c6cf5" />

      <CameraRig enabled={!reducedMotion} />

      <Float speed={reducedMotion ? 0 : 1.2} floatIntensity={0.6} rotationIntensity={0.15}>
        <OrbitSystem paused={reducedMotion} mobile={mobile} />
      </Float>

      <Pendulum paused={reducedMotion} />

      <Sparkles
        key={mobile ? "mobile" : "desktop"}
        count={mobile ? 60 : 160}
        scale={[9, 5, 6]}
        size={2}
        speed={reducedMotion ? 0 : 0.3}
        color="#a5b4fc"
        opacity={0.6}
      />

      {!mobile && (
        <Stars radius={60} depth={25} count={2200} factor={3.5} fade speed={reducedMotion ? 0 : 0.6} />
      )}

      {!mobile && (
        <EffectComposer multisampling={0}>
          <Bloom
            mipmapBlur
            luminanceThreshold={0.15}
            luminanceSmoothing={0.9}
            intensity={0.8}
          />
        </EffectComposer>
      )}
    </>
  );
}
