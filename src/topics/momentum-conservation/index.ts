import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const MomentumConservationSim = lazy(() => import("./sim").then((m) => ({ default: m.MomentumConservationSim })));

export const momentumConservationTopic: TopicModule = {
  meta: {
    slug: "momentum-conservation",
    title: "Импульс. Закон сохранения импульса. Реактивное движение",
    sectionId: "mechanics",
    summary: "Импульс тела и силы, сохранение импульса, уравнение реактивного движения",
  },
  Sim: MomentumConservationSim,
  notes,
  examples,
  problems,
  history,
};
