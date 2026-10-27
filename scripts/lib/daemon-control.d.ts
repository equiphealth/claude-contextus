/**
 * Type surface for the plain-JS daemon-control module
 * (scripts/lib/daemon-control.js).
 *
 * The .js file is the source of truth — hooks run it with no build step, so
 * it cannot be TypeScript. This file only describes the surface that
 * TypeScript setup scripts consume; extend it if more imports are needed.
 * Only the stamp + stanza helpers used by contextus-setup are declared here.
 */

export interface SetupStamp {
  version: 1;
  completedAt: string;
  host: string;
  [key: string]: unknown;
}

export function setupStampPath(cwd?: string): string;
export function readSetupStamp(cwd?: string): SetupStamp | null;
export function writeSetupStamp(cwd?: string, info?: { host?: string }): SetupStamp | null;
export function hasAgentsStanza(cwd?: string): boolean;
export function hasContextusStanza(cwd?: string): boolean;
