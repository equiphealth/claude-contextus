#!/usr/bin/env tsx
/**
 * install-ollama — Install Ollama via platform-appropriate method.
 *
 * Used by /contextus-setup skill to auto-install Ollama when not present.
 */

import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execCb);

export type Platform = 'macos' | 'linux' | 'windows' | 'unknown';

export interface InstallCommand {
  description: string;
  command: string;
  verifyDelay: number; // ms to wait before verifying
  requiresRoot?: boolean;
}

export const INSTALL_COMMANDS: Record<Platform, InstallCommand | null> = {
  macos: {
    description: 'Installing Ollama via Homebrew...',
    command: 'brew install ollama',
    verifyDelay: 5000,
    requiresRoot: false
  },
  linux: {
    description: 'Installing Ollama via official script...',
    command: 'curl -fsSL https://ollama.com/install.sh | sh',
    verifyDelay: 10000,
    requiresRoot: true // May prompt for sudo
  },
  windows: null, // No CLI install option
  unknown: null
};

export function detectPlatform(): Platform {
  switch (process.platform) {
    case 'darwin':
      return 'macos';
    case 'linux':
      return 'linux';
    case 'win32':
      return 'windows';
    default:
      return 'unknown';
  }
}

export async function commandExists(cmd: string): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      await exec(`where ${cmd}`);
    } else {
      await exec(`command -v ${cmd}`);
    }
    return true;
  } catch {
    return false;
  }
}

export async function hasHomebrew(): Promise<boolean> {
  return commandExists('brew');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function installOllama(
  platform: Platform,
  onProgress: (msg: string) => void
): Promise<{ success: boolean; error?: string }> {
  const cmd = INSTALL_COMMANDS[platform];
  if (!cmd) return { success: false, error: 'No auto-install for this platform' };

  onProgress(cmd.description);

  try {
    // Execute install command
    await exec(cmd.command);

    // Wait for install to complete
    await sleep(cmd.verifyDelay);

    // Verify binary exists
    if (!(await commandExists('ollama'))) {
      return { success: false, error: 'Install completed but binary not found' };
    }

    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}

// CLI mode: run install if invoked directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const platform = detectPlatform();
  console.log(`Detected platform: ${platform}`);

  if (!INSTALL_COMMANDS[platform]) {
    console.error(`Auto-install not supported on ${platform}`);
    process.exit(1);
  }

  installOllama(platform, (msg) => console.log(msg))
    .then((result) => {
      if (result.success) {
        console.log('✓ Ollama installed successfully');
        process.exit(0);
      } else {
        console.error(`✗ Install failed: ${result.error}`);
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('Install error:', err);
      process.exit(1);
    });
}
