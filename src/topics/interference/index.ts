import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const InterferenceSim = lazy(() => import("./sim").then((m) => ({ default: m.InterferenceSim })));

export const interferenceTopic: TopicModule = {
  meta: {
    slug: "interference",
    title: "Интерференция света",
    sectionId: "optics",
    summary: "Когерентность, опыт Юнга, интерференция в тонких плёнках",
  },
  Sim: InterferenceSim,
  notes,
  examples,
  problems,
  history,
};
