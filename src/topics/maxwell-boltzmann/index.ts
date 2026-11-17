import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const MaxwellBoltzmannSim = lazy(() => import("./sim").then((m) => ({ default: m.MaxwellBoltzmannSim })));

export const maxwellBoltzmannTopic: TopicModule = {
  meta: {
    slug: "maxwell-boltzmann",
    title: "Распределения Максвелла и Больцмана",
    sectionId: "thermodynamics",
    summary: "Распределение молекул по скоростям, барометрическая формула",
  },
  Sim: MaxwellBoltzmannSim,
  notes,
  examples,
  problems,
  history,
};
