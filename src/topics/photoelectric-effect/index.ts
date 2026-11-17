import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const PhotoelectricEffectSim = lazy(() => import("./sim").then((m) => ({ default: m.PhotoelectricEffectSim })));

export const photoelectricEffectTopic: TopicModule = {
  meta: {
    slug: "photoelectric-effect",
    title: "Фотоэффект",
    sectionId: "quantum-physics",
    summary: "Уравнение Эйнштейна, работа выхода, красная граница фотоэффекта",
  },
  Sim: PhotoelectricEffectSim,
  notes,
  examples,
  problems,
  history,
};
