/**
 * Tests for Ollama installation utilities
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectPlatform,
  commandExists,
  installOllama,
  INSTALL_COMMANDS,
  type Platform
} from '../scripts/install-ollama.js';

describe('detectPlatform', () => {
  it('returns correct platform for common OS types', () => {
    const platform = detectPlatform();
    assert.ok(['macos', 'linux', 'windows', 'unknown'].includes(platform));
  });

  it('returns macos for darwin', () => {
    if (process.platform === 'darwin') {
      assert.equal(detectPlatform(), 'macos');
    }
  });

  it('returns linux for linux', () => {
    if (process.platform === 'linux') {
      assert.equal(detectPlatform(), 'linux');
    }
  });
});

describe('INSTALL_COMMANDS', () => {
  it('has valid commands for supported platforms', () => {
    assert.ok(INSTALL_COMMANDS.macos);
    assert.ok(INSTALL_COMMANDS.linux);
    assert.equal(INSTALL_COMMANDS.macos?.command, 'brew install ollama');
    assert.ok(INSTALL_COMMANDS.linux?.command.includes('ollama.com/install.sh'));
  });

  it('has null for unsupported platforms', () => {
    assert.equal(INSTALL_COMMANDS.windows, null);
    assert.equal(INSTALL_COMMANDS.unknown, null);
  });

  it('sets appropriate verify delays', () => {
    assert.equal(INSTALL_COMMANDS.macos?.verifyDelay, 5000);
    assert.equal(INSTALL_COMMANDS.linux?.verifyDelay, 10000);
  });

  it('marks linux install as requiring root', () => {
    assert.equal(INSTALL_COMMANDS.linux?.requiresRoot, true);
    assert.equal(INSTALL_COMMANDS.macos?.requiresRoot, false);
  });
});

describe('commandExists', () => {
  it('returns true for existing commands', async () => {
    // Test with a command that definitely exists
    const exists = await commandExists('node');
    assert.equal(exists, true);
  });

  it('returns false for non-existent commands', async () => {
    const exists = await commandExists('this-command-definitely-does-not-exist-xyz123');
    assert.equal(exists, false);
  });
});

describe('installOllama', () => {
  it('returns error for unsupported platforms', async () => {
    const result = await installOllama('windows', () => {});
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('No auto-install'));
  });

  it('returns error for unknown platform', async () => {
    const result = await installOllama('unknown', () => {});
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('No auto-install'));
  });

  // Note: We don't test actual installation here as it would require
  // mocking child_process.exec and would be quite fragile. Real
  // installation should be tested manually per the design doc.
});
