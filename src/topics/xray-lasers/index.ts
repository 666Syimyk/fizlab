import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const XrayLasersSim = lazy(() => import("./sim").then((m) => ({ default: m.XrayLasersSim })));

export const xrayLasersTopic: TopicModule = {
  meta: {
    slug: "xray-lasers",
    title: "Рентгеновское излучение. Лазеры",
    sectionId: "quantum-physics",
    summary: "Тормозное и характеристическое излучение, вынужденное излучение, лазер",
  },
  Sim: XrayLasersSim,
  notes,
  examples,
  problems,
  history,
};
