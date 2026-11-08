/** Mirrors backend `points.is_listable_name`: placeholder/test identities that should set a real name. */
const PLACEHOLDER = /^\s*(student|o['’`]?quvchi|user|test(\s*user)?|demo|guest|\d*)\s*\d*\s*$/i;
const TEST_PREFIX = /^\s*(test|demo|qa)[\s_-]/i;

export function isPlaceholderName(name: string | null | undefined): boolean {
  const value = (name ?? "").trim();
  return !value || PLACEHOLDER.test(value) || TEST_PREFIX.test(value);
}
