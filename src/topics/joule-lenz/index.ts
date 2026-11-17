import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const JouleLenzSim = lazy(() => import("./sim").then((m) => ({ default: m.JouleLenzSim })));

export const jouleLenzTopic: TopicModule = {
  meta: {
    slug: "joule-lenz",
    title: "Работа и мощность тока. Закон Джоуля–Ленца",
    sectionId: "electromagnetism",
    summary: "Работа и мощность тока, тепловое действие тока, КПД источника",
  },
  Sim: JouleLenzSim,
  notes,
  examples,
  problems,
  history,
};
