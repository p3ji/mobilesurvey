/**
 * Strips the runtime scope suffix from an instance key, e.g. `revGross@` -> `revGross`,
 * `T_a_x@i=2` -> `T_a_x`. Matches the convention already used by `redactResponses` in
 * `@mobilesurvey/instrument-schema` — kept as a tiny shared helper so every check module
 * agrees on how to map a stored answer key back to a variable/field name.
 */
export function baseName(key: string): string {
  const i = key.indexOf('@');
  return i === -1 ? key : key.slice(0, i);
}
