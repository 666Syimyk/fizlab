import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const ConductorsDielectricsSim = lazy(() => import("./sim").then((m) => ({ default: m.ConductorsDielectricsSim })));

export const conductorsDielectricsTopic: TopicModule = {
  meta: {
    slug: "conductors-dielectrics",
    title: "Проводники и диэлектрики в электрическом поле",
    sectionId: "electromagnetism",
    summary: "Электростатическое равновесие проводников, поляризация диэлектриков",
  },
  Sim: ConductorsDielectricsSim,
  notes,
  examples,
  problems,
  history,
};
