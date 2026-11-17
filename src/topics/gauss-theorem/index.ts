import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const GaussTheoremSim = lazy(() => import("./sim").then((m) => ({ default: m.GaussTheoremSim })));

export const gaussTheoremTopic: TopicModule = {
  meta: {
    slug: "gauss-theorem",
    title: "Теорема Гаусса и её применения",
    sectionId: "electromagnetism",
    summary: "Поток вектора E, теорема Гаусса, поле сферы и плоскости",
  },
  Sim: GaussTheoremSim,
  notes,
  examples,
  problems,
  history,
};
