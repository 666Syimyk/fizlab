/** Accept only an internal path, never a scheme, protocol-relative URL or backslash. */
export function authNext(search: string, fallback = "/") {
  const next = new URLSearchParams(search).get("next");
  const hasUnsafeCharacter = next && Array.from(next).some(character => character === "\\" || character.charCodeAt(0) < 32);
  return next?.startsWith("/") && !next.startsWith("//") && !hasUnsafeCharacter ? next : fallback;
}
