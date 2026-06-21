/**
 * Workspace resolution — bidirectional cross-project context sharing.
 *
 * A workspace groups projects that share context symmetrically. Defined as JSONC
 * files under ~/.contextus/workspaces/<name>.jsonc. When a query arrives from
 * project X, we find all workspaces X belongs to, collect sibling hashes, and
 * return them so the search can scope: WHERE project IN (self + siblings).
 */

import fs from 'fs';
import path from 'path';
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
