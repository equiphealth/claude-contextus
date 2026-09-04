/**
 * Workspace resolution — bidirectional cross-project context sharing.
 *
 * A workspace groups projects that share context symmetrically. Defined as JSONC
 * files under ~/.contextus/workspaces/<name>.jsonc. When a query arrives from
 * project X, we find all workspaces X belongs to, collect sibling hashes, and
 * return them so the search can scope: WHERE project IN (self + siblings).
 */

import fs from 'node:fs';
import path from 'node:path';
import { expandHome, projectHash, stripJsonComments } from './config.js';

const WORKSPACES_DIR = expandHome('~/.contextus/workspaces');

export interface WorkspaceProject {
  path: string;
}

export interface Workspace {
  name: string;
  projects: WorkspaceProject[];
}

/** Read and parse a single workspace JSONC file. Returns null on parse failure. */
function readWorkspaceFile(filePath: string): Workspace | null {
  try {
    const text = fs.readFileSync(filePath, 'utf-8');
    const raw = JSON.parse(stripJsonComments(text));
    if (!raw.name || !Array.isArray(raw.projects)) return null;
    return {
      name: raw.name,
      projects: raw.projects.filter((p: any) => p && typeof p.path === 'string')
    };
  } catch {
    return null;
  }
}

/** Load all workspace definitions from ~/.contextus/workspaces/. */
export function loadWorkspaces(): Workspace[] {
  if (!fs.existsSync(WORKSPACES_DIR)) return [];
  const files = fs
    .readdirSync(WORKSPACES_DIR)
    .filter((f) => f.endsWith('.jsonc') || f.endsWith('.json'));
  const workspaces: Workspace[] = [];
  for (const f of files) {
    const ws = readWorkspaceFile(path.join(WORKSPACES_DIR, f));
    if (ws) workspaces.push(ws);
  }
  return workspaces;
}

/** Expand ~ in workspace project paths and resolve to absolute. */
function resolveProjectPath(p: string): string {
  return path.resolve(expandHome(p));
}

/**
 * Find all workspaces that contain a given project (by absolute path).
 * Returns workspace names for display/logging.
 */
export function workspacesForProject(projectAbsPath: string): Workspace[] {
  const resolved = path.resolve(projectAbsPath);
  return loadWorkspaces().filter((ws) =>
    ws.projects.some((p) => resolveProjectPath(p.path) === resolved)
  );
}

/**
 * Resolve the full project scope for a query: the project's own hash plus all
 * sibling project hashes from any workspace it belongs to. If not in any
 * workspace, returns just [selfHash]. Also includes the '__user__' sentinel
 * for global user context.
 */
export function resolveProjectScope(projectAbsPath: string): string[] {
  const selfHash = projectHash(projectAbsPath);
  const workspaces = workspacesForProject(projectAbsPath);

  const hashes = new Set<string>([selfHash, '__user__']);
  for (const ws of workspaces) {
    for (const p of ws.projects) {
      hashes.add(projectHash(resolveProjectPath(p.path)));
    }
  }
  return Array.from(hashes);
}

/**
 * Write a workspace file to ~/.contextus/workspaces/<name>.jsonc.
 * Creates the directory if needed.
 */
export function writeWorkspace(ws: Workspace): void {
  fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
  const filePath = path.join(WORKSPACES_DIR, `${ws.name}.jsonc`);
  const content = JSON.stringify(ws, null, 2) + '\n';
  fs.writeFileSync(filePath, content);
}

/** Delete a workspace file. Returns true if it existed. */
export function deleteWorkspace(name: string): boolean {
  const filePath = path.join(WORKSPACES_DIR, `${name}.jsonc`);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

/** List all workspace names. */
export function listWorkspaceNames(): string[] {
  return loadWorkspaces().map((ws) => ws.name);
}

/**
 * Add a project to an existing workspace (by name). Creates the workspace if it
 * doesn't exist. Returns the updated workspace.
 */
export function addProjectToWorkspace(workspaceName: string, projectPath: string): Workspace {
  const workspaces = loadWorkspaces();
  let ws = workspaces.find((w) => w.name === workspaceName);
  const resolved = path.resolve(expandHome(projectPath));

  if (!ws) {
    ws = { name: workspaceName, projects: [] };
  }

  const already = ws.projects.some((p) => resolveProjectPath(p.path) === resolved);
  if (!already) {
    ws.projects.push({ path: projectPath });
  }

  writeWorkspace(ws);
  return ws;
}

/** Remove a project from a workspace. Returns true if the project was found and removed. */
export function removeProjectFromWorkspace(workspaceName: string, projectPath: string): boolean {
  const workspaces = loadWorkspaces();
  const ws = workspaces.find((w) => w.name === workspaceName);
  if (!ws) return false;

  const resolved = path.resolve(expandHome(projectPath));
  const before = ws.projects.length;
  ws.projects = ws.projects.filter((p) => resolveProjectPath(p.path) !== resolved);
  if (ws.projects.length === before) return false;

  writeWorkspace(ws);
  return true;
}

/* ── Project Registry — hash ↔ path reverse lookup ──────────────────────────── */

/**
 * Lazy registry mapping projectId hashes to their absolute paths and friendly
 * names. Auto-populated when the daemon (or any caller with a cwd) sees a
 * project. Stored at ~/.contextus/data/projects.json.
 *
 * This enables UX-friendly output: status shows "automation" not "a1b2c3d4e5f6",
 * and --project can accept either form.
 */

export interface ProjectEntry {
  path: string;
  name: string;
  lastSeen: string;
}

const REGISTRY_PATH = expandHome('~/.contextus/data/projects.json');

let registryCache: Record<string, ProjectEntry> | null = null;

function loadRegistry(): Record<string, ProjectEntry> {
  if (registryCache) return registryCache;
  try {
    const text = fs.readFileSync(REGISTRY_PATH, 'utf-8');
    registryCache = JSON.parse(text);
    return registryCache!;
  } catch {
    registryCache = {};
    return registryCache;
  }
}

function saveRegistry(reg: Record<string, ProjectEntry>): void {
  const dir = path.dirname(REGISTRY_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2) + '\n');
  registryCache = reg;
}

/**
 * Is `p` an absolute path to a directory that actually exists? Wraps a
 * single `statSync` in try/catch rather than `existsSync` + a separate
 * `statSync` — several daemon handlers call this from within outer
 * catch-alls that would otherwise turn an uncaught throw into a 200 or 500
 * instead of the intended 400.
 *
 * Shared by every handler that accepts `cwd` from a request body, so the
 * validation logic lives in one place instead of being reimplemented per
 * handler.
 */
export function isValidProjectDir(p: string): boolean {
  if (!p || !path.isAbsolute(p)) return false;
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Register a project (idempotent). Call from any daemon handler that receives
 * both projectId and cwd. Only writes to disk if something changed.
 *
 * Validates `absolutePath` first (must be an absolute, existing directory) —
 * this is the single chokepoint every cwd-accepting handler funnels through,
 * so a malformed cwd can never write a bogus, permanent entry into
 * ~/.contextus/data/projects.json.
 */
export function registerProject(id: string, absolutePath: string): void {
  if (!id || !absolutePath) return;
  if (!isValidProjectDir(absolutePath)) return;
  const reg = loadRegistry();
  const resolved = path.resolve(absolutePath);
  const name = path.basename(resolved);
  const existing = reg[id];
  if (existing && existing.path === resolved) {
    // Same path — just bump lastSeen (skip write if recent enough: same day)
    const today = new Date().toISOString().slice(0, 10);
    if (existing.lastSeen?.startsWith(today)) return;
    existing.lastSeen = new Date().toISOString();
    saveRegistry(reg);
    return;
  }
  reg[id] = { path: resolved, name, lastSeen: new Date().toISOString() };
  saveRegistry(reg);
}

/** Look up the friendly name for a projectId hash. Returns the hash if unknown. */
export function projectName(id: string): string {
  const reg = loadRegistry();
  return reg[id]?.name ?? id;
}

/** Look up the absolute path for a projectId hash. Returns null if unknown. */
export function projectPath(id: string): string | null {
  const reg = loadRegistry();
  return reg[id]?.path ?? null;
}

/**
 * Resolve a project identifier that may be a hash OR a friendly name.
 * Returns the hash. Enables `--project automation` as well as `--project a1b2c3d4e5f6`.
 */
export function resolveProjectId(nameOrHash: string): string {
  const reg = loadRegistry();
  // Direct hash match
  if (reg[nameOrHash]) return nameOrHash;
  // Name match (case-insensitive, first wins)
  const lower = nameOrHash.toLowerCase();
  for (const [hash, entry] of Object.entries(reg)) {
    if (entry.name.toLowerCase() === lower) return hash;
  }
  // Path match
  const resolved = path.resolve(expandHome(nameOrHash));
  for (const [hash, entry] of Object.entries(reg)) {
    if (entry.path === resolved) return hash;
  }
  // Assume it IS a hash (caller may have computed it directly)
  return nameOrHash;
}

/** List all registered projects. */
export function listProjects(): Array<{ id: string } & ProjectEntry> {
  const reg = loadRegistry();
  return Object.entries(reg).map(([id, entry]) => ({ id, ...entry }));
}

/** Invalidate the in-memory cache (for tests). */
export function clearRegistryCache(): void {
  registryCache = null;
}
