import type { TopicModule } from "@/types/topic";
import { lazy } from "react";
import { notes } from "./notes";
import { examples } from "./examples";
import { problems } from "./problems";
import { history } from "./history";

const WaveParticleDualitySim = lazy(() => import("./sim").then((m) => ({ default: m.WaveParticleDualitySim })));

export const waveParticleDualityTopic: TopicModule = {
  meta: {
    slug: "wave-particle-duality",
    title: "Корпускулярно-волновой дуализм",
    sectionId: "quantum-physics",
    summary: "Волны де Бройля, дифракция электронов, принцип дополнительности",
  },
  Sim: WaveParticleDualitySim,
  notes,
  examples,
  problems,
  history,
};
