/** Topics fully open without login — one demo per section. */
export const FREE_DEMO_SLUGS = new Set([
  "kinematics",
  "isoprocesses",
  "lorentz-force",
  "lenses",
  "photoelectric-effect",
  "radioactivity",
]);

/** Temporary demo mode: every topic is open to everyone. Set to false to restore paid access. */
export const ALL_TOPICS_FREE = true;

export function isFreeDemoTopic(slug: string): boolean {
  return ALL_TOPICS_FREE || FREE_DEMO_SLUGS.has(slug);
}
