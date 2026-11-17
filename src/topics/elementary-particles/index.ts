import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const ElementaryParticlesSim = lazy(() => import("./sim").then((m) => ({ default: m.ElementaryParticlesSim })));

export const elementaryParticlesTopic: TopicModule = {
  meta: {
    slug: "elementary-particles",
    title: "Элементарные частицы. Стандартная модель",
    sectionId: "nuclear-physics",
    summary: "Кварки, лептоны, фундаментальные взаимодействия, бозон Хиггса",
  },
  Sim: ElementaryParticlesSim,
  notes,
  examples,
  problems,
  history,
};
