import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const DiffractionSim = lazy(() => import("./sim").then((m) => ({ default: m.DiffractionSim })));

export const diffractionTopic: TopicModule = {
  meta: {
    slug: "diffraction",
    title: "Дифракция света",
    sectionId: "optics",
    summary: "Принцип Гюйгенса–Френеля, дифракционная решётка, разрешающая способность",
  },
  Sim: DiffractionSim,
  notes,
  examples,
  problems,
  history,
};
