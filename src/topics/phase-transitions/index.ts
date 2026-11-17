import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const PhaseTransitionsSim = lazy(() => import("./sim").then((m) => ({ default: m.PhaseTransitionsSim })));

export const phaseTransitionsTopic: TopicModule = {
  meta: {
    slug: "phase-transitions",
    title: "Фазовые переходы",
    sectionId: "thermodynamics",
    summary: "Плавление, испарение, влажность воздуха, диаграмма состояния",
  },
  Sim: PhaseTransitionsSim,
  notes,
  examples,
  problems,
  history,
};
