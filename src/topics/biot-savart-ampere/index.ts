import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const BiotSavartAmpereSim = lazy(() => import("./sim").then((m) => ({ default: m.BiotSavartAmpereSim })));

export const biotSavartAmpereTopic: TopicModule = {
  meta: {
    slug: "biot-savart-ampere",
    title: "Магнитное поле: закон Био–Савара–Лапласа, сила Ампера",
    sectionId: "electromagnetism",
    summary: "Индукция магнитного поля, поле прямого тока и витка, сила Ампера",
  },
  Sim: BiotSavartAmpereSim,
  notes,
  examples,
  problems,
  history,
};
