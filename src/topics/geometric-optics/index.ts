import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const GeometricOpticsSim = lazy(() => import("./sim").then((m) => ({ default: m.GeometricOpticsSim })));

export const geometricOpticsTopic: TopicModule = {
  meta: {
    slug: "geometric-optics",
    title: "Геометрическая оптика",
    sectionId: "optics",
    summary: "Отражение, преломление, полное внутреннее отражение, тонкая линза",
  },
  Sim: GeometricOpticsSim,
  notes,
  examples,
  problems,
  history,
};
