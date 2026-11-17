import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const MaxwellEquationsSim = lazy(() => import("./sim").then((m) => ({ default: m.MaxwellEquationsSim })));

export const maxwellEquationsTopic: TopicModule = {
  meta: {
    slug: "maxwell-equations",
    title: "Уравнения Максвелла. Электромагнитные волны",
    sectionId: "electromagnetism",
    summary: "Четыре уравнения Максвелла, ток смещения, электромагнитные волны",
  },
  Sim: MaxwellEquationsSim,
  notes,
  examples,
  problems,
  history,
};
