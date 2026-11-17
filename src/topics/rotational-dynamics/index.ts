import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const RotationalDynamicsSim = lazy(() => import("./sim").then((m) => ({ default: m.RotationalDynamicsSim })));

export const rotationalDynamicsTopic: TopicModule = {
  meta: {
    slug: "rotational-dynamics",
    title: "Динамика вращательного движения",
    sectionId: "mechanics",
    summary: "Момент силы, момент инерции, момент импульса и его сохранение",
  },
  Sim: RotationalDynamicsSim,
  notes,
  examples,
  problems,
  history,
};
