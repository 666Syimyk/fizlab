import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const IsoprocessesSim = lazy(() => import("./sim").then((m) => ({ default: m.IsoprocessesSim })));

export const isoprocessesTopic: TopicModule = {
  meta: {
    slug: "isoprocesses",
    title: "Изопроцессы",
    sectionId: "thermodynamics",
    summary: "Изотермический, изобарный, изохорный и адиабатный процессы",
  },
  Sim: IsoprocessesSim,
  notes,
  examples,
  problems,
  history,
};
