export interface SectionTopicRef {
  slug: string;
  title: string;
}

export interface Section {
  id: string;
  title: string;
  description: string;
  icon: string;
  topics: SectionTopicRef[];
}

export const sections: Section[] = [
  {
    id: "mechanics",
    title: "Механика",
    description: "Кинематика, динамика, законы сохранения и колебания",
    icon: "Orbit",
    topics: [
      { slug: "kinematics", title: "Кинематика материальной точки" },
      { slug: "projectile-motion", title: "Движение под углом к горизонту (баллистика)" },
      { slug: "rotational-kinematics", title: "Кинематика вращательного движения" },
      { slug: "newton-laws", title: "Законы Ньютона" },
      { slug: "forces-friction-elasticity", title: "Силы в механике: трение, упругость, вес и невесомость" },
      { slug: "momentum-conservation", title: "Импульс. Закон сохранения импульса. Реактивное движение" },
      { slug: "work-power-energy", title: "Работа, мощность, энергия. Закон сохранения энергии" },
      { slug: "collisions", title: "Столкновения: упругие и неупругие удары" },
      { slug: "rotational-dynamics", title: "Динамика вращательного движения" },
      { slug: "gravitation-kepler", title: "Гравитация: закон тяготения, законы Кеплера" },
      { slug: "harmonic-oscillations", title: "Гармонические колебания" },
      { slug: "damped-forced-oscillations", title: "Затухающие и вынужденные колебания. Резонанс" },
      { slug: "mechanical-waves", title: "Механические волны" },
      { slug: "fluid-mechanics", title: "Механика жидкостей" },
      { slug: "special-relativity", title: "Основы специальной теории относительности" },
    ],
  },
  {
    id: "thermodynamics",
    title: "Молекулярная физика и термодинамика",
    description: "МКТ, газовые законы, начала термодинамики",
    icon: "Thermometer",
    topics: [
      { slug: "ideal-gas-mkt", title: "Основы МКТ. Идеальный газ" },
      { slug: "isoprocesses", title: "Изопроцессы" },
      { slug: "maxwell-boltzmann", title: "Распределения Максвелла и Больцмана" },
      { slug: "transport-phenomena", title: "Явления переноса" },
      { slug: "first-law-thermo", title: "Первое начало термодинамики" },
      { slug: "heat-engines-carnot", title: "Тепловые машины. Цикл Карно" },
      { slug: "entropy-second-law", title: "Второе начало термодинамики. Энтропия" },
      { slug: "real-gases-vdw", title: "Реальные газы. Уравнение Ван-дер-Ваальса" },
      { slug: "phase-transitions", title: "Фазовые переходы" },
      { slug: "surface-tension", title: "Поверхностное натяжение и капиллярные явления" },
    ],
  },
  {
    id: "electromagnetism",
    title: "Электричество и магнетизм",
    description: "Электростатика, ток, магнитное поле, индукция",
    icon: "Zap",
    topics: [
      { slug: "coulomb-law", title: "Закон Кулона. Напряжённость поля" },
      { slug: "gauss-theorem", title: "Теорема Гаусса и её применения" },
      { slug: "potential", title: "Потенциал. Работа поля" },
      { slug: "conductors-dielectrics", title: "Проводники и диэлектрики в поле" },
      { slug: "capacitors", title: "Конденсаторы. Энергия поля" },
      { slug: "dc-circuits-ohm", title: "Постоянный ток: закон Ома, ЭДС" },
      { slug: "kirchhoff-rules", title: "Правила Кирхгофа" },
      { slug: "joule-lenz", title: "Работа и мощность тока. Закон Джоуля–Ленца" },
      { slug: "biot-savart-ampere", title: "Магнитное поле: закон Био–Савара–Лапласа, сила Ампера" },
      { slug: "lorentz-force", title: "Сила Лоренца" },
      { slug: "magnetic-materials", title: "Магнитные свойства вещества" },
      { slug: "electromagnetic-induction", title: "Электромагнитная индукция. Закон Фарадея" },
      { slug: "self-mutual-induction", title: "Само- и взаимоиндукция" },
      { slug: "ac-circuits", title: "Переменный ток: RLC-цепи, резонанс" },
      { slug: "maxwell-equations", title: "Уравнения Максвелла. Электромагнитные волны" },
    ],
  },
  {
    id: "optics",
    title: "Оптика",
    description: "Геометрическая и волновая оптика",
    icon: "Sun",
    topics: [
      { slug: "geometric-optics", title: "Геометрическая оптика" },
      { slug: "lenses", title: "Линзы. Оптические приборы" },
      { slug: "interference", title: "Интерференция света" },
      { slug: "diffraction", title: "Дифракция света" },
      { slug: "polarization", title: "Поляризация света" },
      { slug: "dispersion", title: "Дисперсия и поглощение света" },
      { slug: "blackbody-radiation", title: "Тепловое излучение" },
    ],
  },
  {
    id: "quantum-physics",
    title: "Квантовая и атомная физика",
    description: "Кванты света, строение атома, волновая механика",
    icon: "Atom",
    topics: [
      { slug: "photoelectric-effect", title: "Фотоэффект" },
      { slug: "compton-effect", title: "Эффект Комптона. Давление света" },
      { slug: "bohr-model", title: "Модель атома Бора" },
      { slug: "wave-particle-duality", title: "Корпускулярно-волновой дуализм" },
      { slug: "uncertainty-principle", title: "Соотношение неопределённостей Гейзенберга" },
      { slug: "schrodinger-equation", title: "Уравнение Шрёдингера" },
      { slug: "hydrogen-atom-quantum", title: "Атом водорода в квантовой механике" },
      { slug: "multielectron-atoms", title: "Многоэлектронные атомы. Принцип Паули" },
      { slug: "xray-lasers", title: "Рентгеновское излучение. Лазеры" },
    ],
  },
  {
    id: "nuclear-physics",
    title: "Физика ядра и элементарных частиц",
    description: "Строение ядра, радиоактивность, ядерные реакции",
    icon: "CircleDot",
    topics: [
      { slug: "nucleus-binding-energy", title: "Строение ядра. Энергия связи" },
      { slug: "radioactivity", title: "Радиоактивность" },
      { slug: "nuclear-reactions-fission", title: "Ядерные реакции. Деление ядер" },
      { slug: "thermonuclear-fusion", title: "Термоядерный синтез" },
      { slug: "elementary-particles", title: "Элементарные частицы. Стандартная модель" },
      { slug: "dosimetry-protection", title: "Дозиметрия и защита от излучения" },
    ],
  },
];

export function findSection(sectionId: string): Section | undefined {
  return sections.find((s) => s.id === sectionId);
}

export function findSectionByTopicSlug(slug: string): Section | undefined {
  return sections.find((s) => s.topics.some((t) => t.slug === slug));
}

export interface FlatTopic extends SectionTopicRef {
  sectionId: string;
  sectionTitle: string;
}

export function allTopicsFlat(): FlatTopic[] {
  return sections.flatMap((s) =>
    s.topics.map((t) => ({ ...t, sectionId: s.id, sectionTitle: s.title })),
  );
}
