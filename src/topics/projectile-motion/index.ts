import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const ProjectileMotionSim = lazy(() => import("./sim").then((m) => ({ default: m.ProjectileMotionSim })));

export const projectileMotionTopic: TopicModule = {
  meta: {
    slug: "projectile-motion",
    title: "Движение под углом к горизонту (баллистика)",
    sectionId: "mechanics",
    summary: "Суперпозиция равномерного и равноускоренного движений, парабола, дальность полёта",
  },
  Sim: ProjectileMotionSim,
  notes,
  examples,
  problems,
  history,
};
