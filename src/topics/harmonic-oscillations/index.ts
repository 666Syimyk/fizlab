import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const HarmonicOscillationsSim = lazy(() => import("./sim").then((m) => ({ default: m.HarmonicOscillationsSim })));

export const harmonicOscillationsTopic: TopicModule = {
  meta: {
    slug: "harmonic-oscillations",
    title: "Гармонические колебания",
    sectionId: "mechanics",
    summary: "Уравнение гармонических колебаний, пружинный и математический маятники",
  },
  Sim: HarmonicOscillationsSim,
  notes,
  examples,
  problems,
  history,
};
