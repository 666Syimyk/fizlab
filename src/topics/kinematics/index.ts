import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const KinematicsSim = lazy(() => import("./sim").then((m) => ({ default: m.KinematicsSim })));

export const kinematicsTopic: TopicModule = {
  meta: {
    slug: "kinematics",
    title: "Кинематика материальной точки",
    sectionId: "mechanics",
    summary: "Перемещение, скорость, ускорение и равноускоренное движение",
  },
  Sim: KinematicsSim,
  notes,
  examples,
  problems,
  history,
};
