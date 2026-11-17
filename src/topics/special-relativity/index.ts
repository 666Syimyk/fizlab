import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const SpecialRelativitySim = lazy(() => import("./sim").then((m) => ({ default: m.SpecialRelativitySim })));

export const specialRelativityTopic: TopicModule = {
  meta: {
    slug: "special-relativity",
    title: "Основы специальной теории относительности",
    sectionId: "mechanics",
    summary: "Постулаты Эйнштейна, замедление времени, сокращение длины, E=mc²",
  },
  Sim: SpecialRelativitySim,
  notes,
  examples,
  problems,
  history,
};
