import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function load(relative) {
  const source = readFileSync(join(root, relative), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports = {};
  new Function("exports", outputText)(exports);
  return exports;
}
const { parseAnswer } = load("src/components/quiz/answer.ts");
for (const input of ["", " ", "4garbage", "4e", "4.2.1", "Infinity", "NaN", "1e999", "0x10", "4,2,1"]) {
  assert.equal(parseAnswer(input), null, `Reject malformed answer ${JSON.stringify(input)}`);
}
for (const [input, expected] of [["4", 4], [" 4,2 ", 4.2], ["-1.5e-3", -0.0015], [".5", 0.5], ["−2", -2], ["0", 0], ["+3E2", 300]]) {
  assert.equal(parseAnswer(input), expected, `Parse complete answer ${input}`);
}
const { imageDistance } = load("src/topics/lenses/physics.ts");
assert.equal(imageDistance(1, 1), null, "Object at the focus has no finite image");
assert.equal(imageDistance(0.6, 0.6), null);
assert.equal(imageDistance(1, 2), 2, "Object at twice the focal length gives equal image distance");
assert.equal(imageDistance(1, 0.5), -1, "Object inside focus gives a virtual image");
assert.equal(imageDistance(-1, 2), -2 / 3, "Diverging lens gives a virtual image");
assert.ok(imageDistance(1, 1.0001) > 10000, "Near-focus values retain their physical magnitude");
const { initParticles, stepParticles, rmsSpeed, meanSpeed } = load("src/lib/particleGas.ts");
const { steadyStateAmplitude, undampedResonance } = load("src/topics/damped-forced-oscillations/physics.ts");
assert.equal(steadyStateAmplitude(5, 1, 6, 0, 6), null, "Undamped resonance has no finite steady state");
assert.equal(steadyStateAmplitude(5, 1, 6, 0.5, 6), 5 / 6, "Damping gives a finite resonant amplitude");
assert.equal(undampedResonance(5, 1, 6, 0).x, 0);
assert.equal(undampedResonance(5, 1, 6, 4).envelope, 2 * undampedResonance(5, 1, 6, 2).envelope);
for (const t of [0.3, 1, 2]) {
  const h = 1e-4;
  const displacement = time => undampedResonance(5, 1, 6, time).x;
  const acceleration = (displacement(t+h) - 2*displacement(t) + displacement(t-h)) / (h*h);
  assert.ok(Math.abs(acceleration + 36 * displacement(t) - 5 * Math.cos(6*t)) < 1e-5, "Resonant motion satisfies the driven oscillator equation");
}
const bounds = { xMin: -2, xMax: 2, zMin: -2, zMax: 2 };
const oldRandom = Math.random;
try {
  Math.random = () => 0;
  const particles = initParticles(1, bounds, 2, 0.1);
  assert.ok(particles[0].x - particles[0].r >= bounds.xMin, "Initial particle fits inside x wall");
  assert.ok(particles[0].z - particles[0].r >= bounds.zMin, "Initial particle fits inside z wall");
} finally { Math.random = oldRandom; }
const pair = [
  { x: -0.095, z: 0, vx: 1, vz: 0, r: 0.1 },
  { x: 0.095, z: 0, vx: -1, vz: 0, r: 0.1 },
];
const energyBefore = rmsSpeed(pair) ** 2;
stepParticles(pair, 0, bounds, { pairwise: true });
assert.equal(pair[0].vx, -1);
assert.equal(pair[1].vx, 1);
assert.equal(rmsSpeed(pair) ** 2, energyBefore, "Elastic collision conserves energy");
assert.equal(pair[0].vx + pair[1].vx, 0, "Elastic collision conserves momentum");
assert.equal(meanSpeed([]), 0);
assert.equal(rmsSpeed([]), 0);
const wall = [{ x: 1.95, z: 0, vx: 1, vz: 0, r: 0.1 }];
assert.equal(stepParticles(wall, 0.1, bounds), 2);
assert.equal(wall[0].vx, -1);
assert.equal(wall[0].x, 1.9);
console.log("Answer parsing, focal singularities, resonant motion, particle initialization, wall impulses, and elastic conservation passed.");
