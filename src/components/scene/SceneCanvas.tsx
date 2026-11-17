import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { cn } from "@/lib/utils";
import { ErrorBoundary } from "@/components/ErrorBoundary";

function SceneUnavailable() {
  return (
    <div role="status" className="flex h-full min-h-64 flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="font-semibold">3D-сцена недоступна</p>
      <p className="max-w-md text-sm text-muted">Для симуляции нужен WebGL 2. Попробуйте обновить страницу или открыть её в другом браузере. Конспект, примеры и задачи доступны в соседних вкладках.</p>
    </div>
  );
}

interface SceneCanvasProps {
  children: ReactNode;
  physics?: boolean;
  gravity?: [number, number, number];
  camera?: { position?: [number, number, number]; fov?: number };
  bloom?: boolean;
  contactShadows?: boolean;
  className?: string;
  /** reduces post-processing/shadow cost on small screens */
  simplified?: boolean;
  fog?: boolean;
  /** [near, far] fog distances — large outdoor scenes need them pushed out or everything far away turns black */
  fogRange?: [number, number];
  orbitTarget?: [number, number, number];
  minDistance?: number;
  maxDistance?: number;
  /** brightness above which surfaces glow; real-object scenes use a higher value so only lamps/sparks bloom */
  bloomThreshold?: number;
}

export function SceneCanvas({
  children,
  physics = false,
  gravity = [0, -9.81, 0],
  camera,
  bloom = true,
  contactShadows = true,
  className,
  simplified = false,
  fog = true,
  fogRange = [14, 34],
  orbitTarget,
  minDistance = 2,
  maxDistance = 22,
  bloomThreshold = 0.45,
}: SceneCanvasProps) {
  const [webglReady, setWebglReady] = useState<boolean | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const handleContextLost = useCallback(() => setWebglReady(false), []);
  useEffect(() => {
    // Capture from the host before Canvas mounts: an early context loss can occur
    // before effects inside the asynchronous Three renderer have subscribed.
    const host = container.current;
    host?.addEventListener("webglcontextlost", handleContextLost, true);
    // Canvas configures its renderer asynchronously; test support before mounting it
    // so a denied context cannot leave an unhandled promise and an empty scene.
    const probe = document.createElement("canvas");
    try {
      const context = probe.getContext("webgl2");
      setWebglReady(Boolean(context));
      context?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      setWebglReady(false);
    }
    return () => host?.removeEventListener("webglcontextlost", handleContextLost, true);
  }, [handleContextLost]);
  const content = physics ? <Physics gravity={gravity}>{children}</Physics> : children;
  const useBloom = bloom && !simplified;
  const useShadows = !simplified;
  const useContactShadows = contactShadows && !simplified;

  return (
    <div
      ref={container}
      className={cn(
        "relative h-full min-h-0 w-full overflow-hidden rounded-2xl border border-border bg-surface",
        className,
      )}
    >
      {webglReady === false ? <SceneUnavailable /> : webglReady === null ? (
        <div role="status" className="flex h-full items-center justify-center text-sm text-muted">Загрузка 3D-сцены…</div>
      ) : <ErrorBoundary fallback={<SceneUnavailable />}>
      <Canvas
        fallback={<SceneUnavailable />}
        shadows={useShadows ? "percentage" : false}
        dpr={simplified ? 1 : [1, 2]}
        camera={{ position: camera?.position ?? [4, 3, 6], fov: camera?.fov ?? 45 }}
      >
        <color attach="background" args={["#0a0a0c"]} />
        {fog && <fog attach="fog" args={["#0a0a0c", fogRange[0], fogRange[1]]} />}
        <ambientLight intensity={0.25} />
        {/* sky/ground fill so real-looking objects read clearly against the dark background */}
        <hemisphereLight args={["#dbe4ff", "#2a2118", 0.75]} />
        <directionalLight
          position={[5, 8, 5]}
          intensity={1.4}
          castShadow={useShadows}
          shadow-mapSize={useShadows ? [2048, 2048] : undefined}
        />
        <pointLight position={[-6, 4, -4]} intensity={0.4} color="#7c6cf5" />

        <Suspense fallback={null}>
          {/* soft studio reflections so metal, glass and paint look real (rendered once, no files) */}
          <Environment resolution={64} frames={1} environmentIntensity={0.6}>
            <Lightformer form="rect" intensity={2.2} position={[0, 6, -6]} scale={[14, 5, 1]} />
            <Lightformer form="rect" intensity={1.2} position={[-7, 3, 2]} rotation-y={Math.PI / 2} scale={[8, 3, 1]} />
            <Lightformer form="rect" intensity={0.8} position={[7, 2, 3]} rotation-y={-Math.PI / 2} scale={[8, 2, 1]} />
            <Lightformer form="ring" color="#c7d2fe" intensity={1.5} position={[3, 5, 6]} scale={3} />
          </Environment>
          {content}
          {useContactShadows && (
            <ContactShadows
              position={[0, -0.001, 0]}
              opacity={0.55}
              scale={20}
              blur={2.2}
              far={12}
            />
          )}
        </Suspense>

        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          minDistance={minDistance}
          maxDistance={maxDistance}
          target={orbitTarget}
          maxPolarAngle={Math.PI / 2 - 0.02}
        />

        {useBloom && (
          <EffectComposer multisampling={0}>
            <Bloom
              mipmapBlur
              luminanceThreshold={bloomThreshold}
              luminanceSmoothing={0.9}
              intensity={0.65}
            />
            <Vignette eskil={false} offset={0.15} darkness={0.65} />
          </EffectComposer>
        )}
      </Canvas>
      </ErrorBoundary>}
    </div>
  );
}
