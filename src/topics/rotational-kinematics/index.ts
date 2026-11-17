import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const RotationalKinematicsSim = lazy(() => import("./sim").then((m) => ({ default: m.RotationalKinematicsSim })));

export const rotationalKinematicsTopic: TopicModule = {
  meta: {
    slug: "rotational-kinematics",
    title: "Кинематика вращательного движения",
    sectionId: "mechanics",
    summary: "Угловая скорость, угловое ускорение, связь линейных и угловых величин",
  },
  Sim: RotationalKinematicsSim,
  notes,
  examples,
  problems,
  history,
};
