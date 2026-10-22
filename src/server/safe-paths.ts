/**
 * Server-side path guards.
 *
 * Every API route that turns user-supplied data (project ids, part `src` paths)
 * into filesystem paths must go through these helpers so a crafted payload
 * such as `{"id": "../../.ssh"}` can never read or write outside the app's
 * own `public/` and `exports/` folders.
 */
import path from "node:path";

const PROJECT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export class UnsafePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafePathError";
  }
}

/** True when `id` is a safe single path segment (letters, digits, `-`, `_`; max 64 chars). */
export function isSafeProjectId(id: unknown): id is string {
  return typeof id === "string" && PROJECT_ID_RE.test(id);
}

/** Throws unless `id` is a safe project id. */
export function assertSafeProjectId(id: unknown): string {
  if (!isSafeProjectId(id)) {
    throw new UnsafePathError(`Invalid project id ${JSON.stringify(id)}`);
  }
  return id;
}

/** Normalises free text into a safe project id (used for uploads). */
export function toSafeProjectId(raw: string | null | undefined, fallback = "custom-hero"): string {
  const slug = (raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 64);
  return slug.length > 0 ? slug : fallback;
}

/**
 * Resolves `relative` inside `root` and throws if the result escapes `root`
 * (via `..`, absolute paths, or drive letters).
 */
export function resolveInside(root: string, relative: string): string {
  const absRoot = path.resolve(root);
  const target = path.resolve(absRoot, relative.replace(/^[/\\]+/, ""));
  if (target !== absRoot && !target.startsWith(absRoot + path.sep)) {
    throw new UnsafePathError(`Path ${JSON.stringify(relative)} escapes ${absRoot}`);
  }
  return target;
}
