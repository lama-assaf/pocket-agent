// src/clients/types.ts
// Types for on-disk client (brand) + world "brains". These describe the
// filesystem side of scoped memory; the SQLite side lives in src/memory/.

/** A memory root on disk paired with the scope its files should be tagged with. */
export interface ScopeRoot {
  /** Memory scope key, e.g. 'world' or 'client:acme'. */
  scope: string;
  /** Absolute path to the `.atelier/memory` directory for this scope. */
  memoryDir: string;
  /** Absolute path to the scope's repo root (parent of `.atelier`). */
  rootDir: string;
}

/** Resolved on-disk location for one client (brand). */
export interface ClientPaths {
  id: string;
  /** `<clientsRoot>/<id>` — the brand's checkout root. */
  rootDir: string;
  /** `<clientsRoot>/<id>/.atelier/memory`. */
  memoryDir: string;
  /** `<clientsRoot>/<id>/guardrails`. */
  guardrailsDir: string;
}
