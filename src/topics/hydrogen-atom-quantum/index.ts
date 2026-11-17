import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const HydrogenAtomQuantumSim = lazy(() => import("./sim").then((m) => ({ default: m.HydrogenAtomQuantumSim })));

export const hydrogenAtomQuantumTopic: TopicModule = {
  meta: {
    slug: "hydrogen-atom-quantum",
    title: "Атом водорода в квантовой механике",
    sectionId: "quantum-physics",
    summary: "Квантовые числа n, l, ml, ms, орбитали, спин электрона",
  },
  Sim: HydrogenAtomQuantumSim,
  notes,
  examples,
  problems,
  history,
};
