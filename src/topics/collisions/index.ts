import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const CollisionsSim = lazy(() => import("./sim").then((m) => ({ default: m.CollisionsSim })));

export const collisionsTopic: TopicModule = {
  meta: {
    slug: "collisions",
    title: "Столкновения: упругие и неупругие удары",
    sectionId: "mechanics",
    summary: "Абсолютно упругий и неупругий удар, коэффициент восстановления",
  },
  Sim: CollisionsSim,
  notes,
  examples,
  problems,
  history,
};
