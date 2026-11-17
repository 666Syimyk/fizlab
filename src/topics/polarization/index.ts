import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const PolarizationSim = lazy(() => import("./sim").then((m) => ({ default: m.PolarizationSim })));

export const polarizationTopic: TopicModule = {
  meta: {
    slug: "polarization",
    title: "Поляризация света",
    sectionId: "optics",
    summary: "Закон Малюса, поляризация при отражении, угол Брюстера",
  },
  Sim: PolarizationSim,
  notes,
  examples,
  problems,
  history,
};
