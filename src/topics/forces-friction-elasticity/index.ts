import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const ForcesFrictionElasticitySim = lazy(() => import("./sim").then((m) => ({ default: m.ForcesFrictionElasticitySim })));

export const forcesFrictionElasticityTopic: TopicModule = {
  meta: {
    slug: "forces-friction-elasticity",
    title: "Силы в механике: трение, упругость, вес и невесомость",
    sectionId: "mechanics",
    summary: "Закон Гука, сухое трение, вес и невесомость в ускоренных системах",
  },
  Sim: ForcesFrictionElasticitySim,
  notes,
  examples,
  problems,
  history,
};
