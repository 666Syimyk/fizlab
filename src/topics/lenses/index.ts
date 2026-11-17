import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const LensesSim = lazy(() => import("./sim").then((m) => ({ default: m.LensesSim })));

export const lensesTopic: TopicModule = {
  meta: {
    slug: "lenses",
    title: "Линзы. Оптические приборы",
    sectionId: "optics",
    summary: "Формула линзы, увеличение, построение изображений, оптическая сила",
  },
  Sim: LensesSim,
  notes,
  examples,
  problems,
  history,
};
