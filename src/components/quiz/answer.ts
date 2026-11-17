/** Parse one complete finite decimal, including comma decimals and scientific notation. */
export function parseAnswer(value: string): number | null {
  const normalized = value.trim().replace(/^−/, "-").replace(",", ".");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}
