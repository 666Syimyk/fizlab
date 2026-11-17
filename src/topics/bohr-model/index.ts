import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const BohrModelSim = lazy(() => import("./sim").then((m) => ({ default: m.BohrModelSim })));

export const bohrModelTopic: TopicModule = {
  meta: {
    slug: "bohr-model",
    title: "Модель атома Бора",
    sectionId: "quantum-physics",
    summary: "Постулаты Бора, радиусы орбит, энергетические уровни, спектр водорода",
  },
  Sim: BohrModelSim,
  notes,
  examples,
  problems,
  history,
};
