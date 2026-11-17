import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const DispersionSim = lazy(() => import("./sim").then((m) => ({ default: m.DispersionSim })));

export const dispersionTopic: TopicModule = {
  meta: {
    slug: "dispersion",
    title: "Дисперсия и поглощение света",
    sectionId: "optics",
    summary: "Зависимость n(λ), радуга, закон Бугера–Ламберта–Бера",
  },
  Sim: DispersionSim,
  notes,
  examples,
  problems,
  history,
};
