import { useCallback, useMemo, useRef, useState } from "react";
import { useControls } from "leva";
import * as THREE from "three";
import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { PhysicsTicker } from "@/components/sim/PhysicsTicker";
import { TransportControls } from "@/components/sim/TransportControls";
import { SimShell } from "@/components/sim/SimShell";
import { NumberReadouts } from "@/components/sim/NumberReadouts";
import { Histogram } from "@/components/sim/Histogram";
import { SceneLabel } from "@/components/sim/SceneLabel";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { canvasTexture } from "@/components/sim/props/textures";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const SUBSHELLS: { name: string; cap: number }[] = [
  { name: "1s", cap: 2 },
  { name: "2s", cap: 2 },
  { name: "2p", cap: 6 },
  { name: "3s", cap: 2 },
  { name: "3p", cap: 6 },
  { name: "4s", cap: 2 },
  { name: "3d", cap: 10 },
  { name: "4p", cap: 6 },
  { name: "5s", cap: 2 },
  { name: "4d", cap: 10 },
  { name: "5p", cap: 6 },
];

const ELEMENTS: [number, string][] = [
  [1, "H"], [2, "He"], [3, "Li"], [4, "Be"], [5, "B"], [6, "C"], [7, "N"], [8, "O"], [9, "F"], [10, "Ne"],
  [11, "Na"], [12, "Mg"], [13, "Al"], [14, "Si"], [15, "P"], [16, "S"], [17, "Cl"], [18, "Ar"], [19, "K"], [20, "Ca"],
  [26, "Fe"], [29, "Cu"], [30, "Zn"], [36, "Kr"],
];

// [Z, symbol, group(1-18), period(1-4)] for the mini periodic table (Z=1..36)
const PERIODIC_TABLE: [number, string, number, number][] = [
  [1, "H", 1, 1], [2, "He", 18, 1],
  [3, "Li", 1, 2], [4, "Be", 2, 2], [5, "B", 13, 2], [6, "C", 14, 2], [7, "N", 15, 2], [8, "O", 16, 2], [9, "F", 17, 2], [10, "Ne", 18, 2],
  [11, "Na", 1, 3], [12, "Mg", 2, 3], [13, "Al", 13, 3], [14, "Si", 14, 3], [15, "P", 15, 3], [16, "S", 16, 3], [17, "Cl", 17, 3], [18, "Ar", 18, 3],
  [19, "K", 1, 4], [20, "Ca", 2, 4], [21, "Sc", 3, 4], [22, "Ti", 4, 4], [23, "V", 5, 4], [24, "Cr", 6, 4], [25, "Mn", 7, 4], [26, "Fe", 8, 4],
  [27, "Co", 9, 4], [28, "Ni", 10, 4], [29, "Cu", 11, 4], [30, "Zn", 12, 4], [31, "Ga", 13, 4], [32, "Ge", 14, 4], [33, "As", 15, 4], [34, "Se", 16, 4],
  [35, "Br", 17, 4], [36, "Kr", 18, 4],
];

const NAMES = [
  "Водород", "Гелий", "Литий", "Бериллий", "Бор", "Углерод", "Азот", "Кислород", "Фтор", "Неон", "Натрий", "Магний", "Алюминий", "Кремний", "Фосфор", "Сера", "Хлор", "Аргон",
  "Калий", "Кальций", "Скандий", "Титан", "Ванадий", "Хром", "Марганец", "Железо", "Кобальт", "Никель", "Медь", "Цинк", "Галлий", "Германий", "Мышьяк", "Селен", "Бром", "Криптон",
];

const FILL_RATE = 1.4; // electrons per second

function configAt(count: number) {
  const parts: string[] = [];
  let remaining = count;
  for (const s of SUBSHELLS) {
    if (remaining <= 0) break;
    const n = Math.min(s.cap, remaining);
    parts.push(`${s.name}${superscript(n)}`);
    remaining -= n;
  }
  return parts.join(" ");
}
function superscript(n: number) {
  const map: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
  return String(n).split("").map((d) => map[d]).join("");
}

/* ---------- the "hotel" layout: floor = subshell, room = orbital, ≤ 2 guests with opposite spins ---------- */
const FLOOR_H = 0.44;
const ROOM_W = 0.42;
const HOTEL_X = -2.4;

interface Slot {
  x: number;
  y: number;
  up: boolean;
}

/** Electron number → its room and spin, filling floors by energy (Aufbau) and rooms one by one before pairing (Hund). */
const SLOTS: Slot[] = (() => {
  const out: Slot[] = [];
  SUBSHELLS.forEach((s, floor) => {
    const rooms = s.cap / 2;
    for (let k = 0; k < s.cap; k++) {
      const room = k % rooms;
      const up = k < rooms;
      out.push({ x: HOTEL_X + room * ROOM_W + (up ? -0.07 : 0.07), y: 0.25 + floor * FLOOR_H, up });
    }
  });
  return out;
})();

/** shell n of the k-th electron (for the planetary picture) */
const SHELL_OF: number[] = SUBSHELLS.flatMap((s) => Array.from({ length: s.cap }, () => Number(s.name[0])));

function elementCard(Z: number) {
  const sym = PERIODIC_TABLE.find(([z]) => z === Z)?.[1] ?? "?";
  return canvasTexture(`element-card-${Z}`, 256, 256, (ctx, w, h) => {
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 40px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(String(Z), 20, 52);
    ctx.font = "bold 110px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(sym, w / 2, 160);
    ctx.font = "26px sans-serif";
    ctx.fillText(NAMES[Z - 1] ?? "", w / 2, 222);
  });
}

interface SceneContentProps {
  Z: number;
  running: boolean;
  speed: number;
  onLive: (n: { count: number; config: string }) => void;
}

function SceneContent({ Z, running, speed, onLive }: SceneContentProps) {
  const upRef = useRef<THREE.InstancedMesh>(null!);
  const downRef = useRef<THREE.InstancedMesh>(null!);
  const atomE = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const card = useMemo(() => elementCard(Z), [Z]);
  const MAX_E = 36;

  const handleFrame = useCallback(
    (t: number) => {
      const count = Math.min(Math.floor(t * FILL_RATE), Z);
      const up = upRef.current;
      const down = downRef.current;
      for (let i = 0; i < MAX_E; i++) {
        const s = SLOTS[i];
        const shown = i < count && s;
        for (const [mesh, wantUp] of [
          [up, true],
          [down, false],
        ] as const) {
          if (!mesh) continue;
          if (shown && s.up === wantUp) {
            dummy.position.set(s.x, s.y, 0.12);
            dummy.rotation.set(0, 0, wantUp ? 0 : Math.PI);
            dummy.scale.setScalar(1);
          } else {
            dummy.position.set(0, -999, 0);
            dummy.scale.setScalar(0.0001);
          }
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
      }
      if (up) up.instanceMatrix.needsUpdate = true;
      if (down) down.instanceMatrix.needsUpdate = true;

      // planetary picture: electrons spread over the shells n = 1..4
      const e = atomE.current;
      if (e) {
        const perShell = [0, 0, 0, 0, 0];
        for (let i = 0; i < count; i++) perShell[SHELL_OF[i]]++;
        const seen = [0, 0, 0, 0, 0];
        for (let i = 0; i < MAX_E; i++) {
          if (i < count) {
            const n = SHELL_OF[i];
            const k = seen[n]++;
            const a = (k / perShell[n]) * Math.PI * 2 + t * (0.9 / n);
            const r = 0.3 + n * 0.32;
            dummy.position.set(3.3 + Math.cos(a) * r, 2.2 + Math.sin(a) * r, 0);
            dummy.rotation.set(0, 0, 0);
            dummy.scale.setScalar(0.055);
          } else {
            dummy.position.set(0, -999, 0);
            dummy.scale.setScalar(0.0001);
          }
          dummy.updateMatrix();
          e.setMatrixAt(i, dummy.matrix);
        }
        e.instanceMatrix.needsUpdate = true;
      }
    },
    [Z, dummy],
  );

  const arrowGeo = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-0.012, -0.12);
    shape.lineTo(0.012, -0.12);
    shape.lineTo(0.012, 0.04);
    shape.lineTo(0.045, 0.04);
    shape.lineTo(0, 0.12);
    shape.lineTo(-0.045, 0.04);
    shape.lineTo(-0.012, 0.04);
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }, []);

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={10}
        onSample={(t) => {
          const count = Math.min(Math.floor(t * FILL_RATE), Z);
          onLive({ count, config: configAt(count) });
        }}
      />

      {/* the "hotel": floors in order of energy, rooms = orbitals */}
      {SUBSHELLS.map((s, floor) => {
        const rooms = s.cap / 2;
        const y = 0.25 + floor * FLOOR_H;
        return (
          <group key={s.name}>
            {Array.from({ length: rooms }, (_, r) => (
              <mesh key={r} position={[HOTEL_X + r * ROOM_W, y, 0]}>
                <boxGeometry args={[ROOM_W - 0.05, FLOOR_H - 0.08, 0.1]} />
                <meshStandardMaterial color="#1e293b" roughness={0.6} />
              </mesh>
            ))}
            <mesh position={[HOTEL_X + ((rooms - 1) * ROOM_W) / 2, y - FLOOR_H / 2 + 0.02, 0]}>
              <boxGeometry args={[rooms * ROOM_W + 0.06, 0.03, 0.2]} />
              <meshStandardMaterial color="#64748b" />
            </mesh>
            <SceneLabel position={[HOTEL_X - 0.5, y, 0]}>{s.name}</SceneLabel>
          </group>
        );
      })}
      <SceneLabel position={[HOTEL_X + 1.6, 0.25 + SUBSHELLS.length * FLOOR_H + 0.05, 0]}>«гостиница» для электронов: выше этаж — больше энергия</SceneLabel>
      <instancedMesh ref={upRef} args={[arrowGeo, undefined, MAX_E]} frustumCulled={false}>
        <meshBasicMaterial color="#f87171" toneMapped={false} side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh ref={downRef} args={[arrowGeo, undefined, MAX_E]} frustumCulled={false}>
        <meshBasicMaterial color="#60a5fa" toneMapped={false} side={THREE.DoubleSide} />
      </instancedMesh>

      {/* planetary sketch of the atom and the periodic-table card */}
      <mesh position={[3.3, 2.2, 0]}>
        <sphereGeometry args={[0.18, 16, 12]} />
        <meshStandardMaterial color="#dc2626" emissive="#dc2626" emissiveIntensity={0.5} />
      </mesh>
      {[1, 2, 3, 4].map((n) => (
        <mesh key={n} position={[3.3, 2.2, -0.01]}>
          <ringGeometry args={[0.3 + n * 0.32 - 0.006, 0.3 + n * 0.32 + 0.006, 80]} />
          <meshBasicMaterial color="#475569" />
        </mesh>
      ))}
      <instancedMesh ref={atomE} args={[undefined, undefined, MAX_E]} frustumCulled={false}>
        <sphereGeometry args={[1, 10, 8]} />
        <meshBasicMaterial color="#38bdf8" toneMapped={false} />
      </instancedMesh>
      <SceneLabel position={[3.3, 0.55, 0]}>оболочки K, L, M, N</SceneLabel>
      <mesh position={[3.3, 4.55, 0]}>
        <planeGeometry args={[1.1, 1.1]} />
        <meshBasicMaterial map={card} toneMapped={false} />
      </mesh>
    </>
  );
}

export function MultielectronAtomsSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { Z } = useControls("Многоэлектронные атомы", {
    Z: { value: 8, min: 1, max: 36, step: 1, label: "Z (число электронов)" },
  });

  const symbol = ELEMENTS.find(([z]) => z === Z)?.[1] ?? PERIODIC_TABLE.find(([z]) => z === Z)?.[1] ?? "?";
  const [live, setLive] = useState({ count: 0, config: "" });

  const occupancy = useMemo(() => {
    let remaining = live.count;
    return SUBSHELLS.map((s) => {
      const n = Math.max(0, Math.min(s.cap, remaining));
      remaining -= n;
      return { name: s.name, n, cap: s.cap };
    });
  }, [live.count]);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
  }, [clock]);

  const done = live.count >= Z;
  const caption = done ? (
    <>
      Все {Z} электронов {NAMES[Z - 1]?.toLowerCase() ?? ""} расселены: <b>{configAt(Z)}</b>. Электроны на верхнем занятом «этаже» — внешние, они и решают, с кем атом будет образовывать связи. Поэтому
      химия элемента зависит от его места в таблице Менделеева.
    </>
  ) : (
    <>
      Электроны заселяются <b>снизу вверх</b> — сначала на самые выгодные (низкие по энергии) «этажи». В каждом «номере»-орбитали не больше двух, и спины у них противоположны (↑↓) — это принцип Паули.
      На этаже p или d сначала занимают по одному в каждый номер, потом подселяются вторые (правило Хунда).
    </>
  );
  const legend: LegendItem[] = [
    { color: "#f87171", label: "спин вверх ↑", kind: "square" },
    { color: "#60a5fa", label: "спин вниз ↓", kind: "square" },
  ];

  return (
    <SimShell
      scene={
        <SceneCanvas
          camera={{ position: [0.6, 2.8, 8.4] as [number, number, number], fov: 50 }}
          orbitTarget={[0.4, 2.5, 0]}
          simplified={isMobile}
          maxDistance={18}
          minDistance={3}
          bloomThreshold={0.8}
          fogRange={[18, 45]}
        >
          <SceneContent key={`${clock.resetNonce}-${Z}`} Z={Z} running={clock.running} speed={clock.speed} onLive={setLive} />
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        <NumberReadouts
          items={[
            { label: "Элемент", value: `${symbol} (Z=${Z})` },
            { label: "Электронов размещено", value: `${live.count} / ${Z}` },
            { label: "Электронная конфигурация", value: live.config || "—" },
          ]}
        />
      }
      graphs={
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">Мини-таблица Менделеева — подсвечена клетка текущего элемента</p>
            <div className="grid gap-0.5" style={{ gridTemplateColumns: "repeat(18, minmax(0, 1fr))" }}>
              {PERIODIC_TABLE.map(([z, sym, group, period]) => (
                <div
                  key={z}
                  className={`flex aspect-square items-center justify-center rounded text-[9px] font-medium transition-colors ${
                    z === Z ? "bg-accent text-accent-foreground scale-110" : "bg-surface-3 text-muted-2"
                  }`}
                  style={{ gridColumn: group, gridRow: period }}
                  title={`${sym} (Z=${z})`}
                >
                  {sym}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">Заполнение подоболочек (текущее / максимум)</p>
            <Histogram data={occupancy} xKey="name" barKey="n" barColor="#38bdf8" xLabel="подоболочка" yLabel="электронов" />
          </div>
          <div className="rounded-xl border border-border bg-surface-2/60 p-3 text-xs text-muted-2">
            <p className="mb-2 font-medium">Порядок заполнения (принцип Ауфбау)</p>
            <p className="leading-relaxed mb-2">1s → 2s → 2p → 3s → 3p → 4s → 3d → 4p → 5s → 4d → 5p → ...</p>
            <p className="leading-relaxed">
              Принцип Паули запрещает двум электронам иметь одинаковый набор квантовых чисел — на каждой
              орбитали максимум 2 электрона (с противоположными спинами), поэтому подоболочка p вмещает 6
              электронов (3 орбитали), d — 10 (5 орбиталей).
            </p>
          </div>
        </div>
      }
      note={
        <>
          Электроны заполняют подоболочки в порядке возрастания энергии — снизу вверх на сцене. Обратите
          внимание: 4s заполняется РАНЬШЕ 3d, хотя её главное квантовое число больше — заряд ядра и
          экранирование меняют порядок энергетических уровней по сравнению с простой моделью Бора. Есть и
          исключения из простого правила: например, у хрома и меди один 4s-электрон «переезжает» на 3d.
        </>
      }
    />
  );
}
