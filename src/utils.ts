import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import chalk from 'chalk';
import { spawn, execFileSync } from 'child_process';
import { encrypt, decrypt } from './secureStore';

export const SWITCH_DIR = path.join(os.homedir(), '.claude-switch');
export const PROFILES_DIR = path.join(SWITCH_DIR, 'profiles');

/** File used to persist the current account's API key for shell sourcing */
export const APIKEY_ENV_FILE = path.join(SWITCH_DIR, 'current-apikey.env');
export const APIKEY_PS_FILE = path.join(SWITCH_DIR, 'current-apikey.ps1');

/** Electron app data dir for Claude (contains IndexedDB / Local Storage) */
export const APPDATA_CLAUDE_DIR = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'Claude')
  : path.join(os.homedir(), '.config', 'Claude');  // fallback for Linux/macOS

export function getActiveClaudeDir(): string {
  // Respect official override first
  if (process.env.CLAUDE_CONFIG_DIR) {
    return process.env.CLAUDE_CONFIG_DIR;
  }
  return path.join(os.homedir(), '.claude');
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.ensureDir(dir);
}

export async function ensureClaudeDir(): Promise<void> {
  const claudeDir = getActiveClaudeDir();
  await fs.ensureDir(claudeDir);
  await ensureDir(SWITCH_DIR);
  await ensureDir(PROFILES_DIR);
}

export function getProfileDir(name: string): string {
  // Sanitize name lightly
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(PROFILES_DIR, safe);
}

/** Returns the sanitized directory name for a given profile name */
export function sanitizeProfileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export async function profileExists(name: string): Promise<boolean> {
  return fs.pathExists(getProfileDir(name));
}

export const CREDENTIALS_FILE = '.credentials.json';
export const METADATA_FILE = 'profile.json';
export const APIKEY_FILE = 'apikey.json';

export interface ProfileMetadata {
  name: string;        // the original (unsanitized) display name
  dirName: string;     // the sanitized directory name
  createdAt: string;
  lastUsed?: string;
  email?: string;
  note?: string;
  /** 'apikey' | 'oauth' | 'unknown' */
  accountType?: string;
  /** 'free' | 'pro' | 'max' | 'api' | 'unknown' */
  plan?: string;
  apiUrl?: string;
  proxy?: string;
}

export interface ApiKeyEntry {
  key: string;
  addedAt: string;
  note?: string;
}

/** Read the stored API key for a profile, or null if not set */
export async function readApiKeyFromProfile(name: string): Promise<string | null> {
  const p = path.join(getProfileDir(name), APIKEY_FILE);
  if (await fs.pathExists(p)) {
    try {
      const entry: ApiKeyEntry = await fs.readJson(p);
      if (!entry.key) return null;
      // Transparent decryption
      return decrypt(entry.key);
    } catch {
      return null;
    }
  }
  return null;
}

/** Save an API key into a profile directory */
export async function saveApiKeyToProfile(name: string, key: string, note?: string): Promise<void> {
  // Transparent encryption
  const encryptedKey = encrypt(key);
  const entry: ApiKeyEntry = {
    key: encryptedKey,
    addedAt: new Date().toISOString(),
    ...(note ? { note } : {}),
  };
  await fs.writeJson(path.join(getProfileDir(name), APIKEY_FILE), entry, { spaces: 2 });
}

export async function copyCredentials(fromDir: string, toDir: string): Promise<boolean> {
  const fromCred = path.join(fromDir, CREDENTIALS_FILE);
  const toCred = path.join(toDir, CREDENTIALS_FILE);

  if (await fs.pathExists(fromCred)) {
    await fs.copy(fromCred, toCred, { overwrite: true });
    return true;
  }
  return false;
}

export function logSuccess(msg: string) {
  console.log(chalk.green('✓ ' + msg));
}

export function logInfo(msg: string) {
  console.log(chalk.cyan(msg));
}

export function logWarn(msg: string) {
  console.log(chalk.yellow('⚠ ' + msg));
}

export function logError(msg: string) {
  console.error(chalk.red('✗ ' + msg));
}

// For full isolation profiles
export const CONFIG_SUBDIR = 'config';

/**
 * Resolve the actual claude binary path.
 * On Windows, tries claude.cmd first (npm global), then claude.exe, then claude.
 * Falls back gracefully to just 'claude' with shell:true.
 */
export function resolveClaudeBin(): string {
  if (process.platform === 'win32') {
    const candidates = ['claude.cmd', 'claude.exe', 'claude'];
    for (const bin of candidates) {
      try {
        execFileSync('where', [bin], { stdio: 'pipe' });
        return bin;
      } catch {
        // not found, try next
      }
    }
  } else {
    try {
      execFileSync('which', ['claude'], { stdio: 'pipe' });
      return 'claude';
    } catch {
      // not in PATH, fall through
    }
  }
  // Final fallback: let the shell resolve it
  return 'claude';
}

// Spawn claude with custom config dir (for run command)
export function launchClaudeWithConfigDir(configDir: string, extraArgs: string[] = []) {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: configDir };
  console.log(chalk.cyan(`Launching claude with CLAUDE_CONFIG_DIR=${configDir}`));
  logInfo('This will start a fully isolated Claude session for the profile.');

  const claudeBin = resolveClaudeBin();

  const child = spawn(claudeBin, extraArgs, {
    stdio: 'inherit',
    env,
    shell: true,  // important for global npm bins on Windows/PowerShell
  });

  child.on('error', (err) => {
    logError(`Failed to launch claude: ${err.message}`);
    logInfo('Make sure "claude" is installed and in PATH (npm i -g @anthropic-ai/claude-code or similar).');
  });

  child.on('close', (code) => {
    if (code !== 0) {
      logWarn(`Claude exited with code ${code}`);
    }
  });
}

// Simple alias storage
export const ALIASES_FILE = path.join(SWITCH_DIR, 'aliases.json');

export async function loadAliases(): Promise<Record<string, string>> {
  if (await fs.pathExists(ALIASES_FILE)) {
    return fs.readJson(ALIASES_FILE).catch(() => ({}));
  }
  return {};
}

export async function saveAliases(aliases: Record<string, string>) {
  await ensureDir(SWITCH_DIR);
  await fs.writeJson(ALIASES_FILE, aliases, { spaces: 2 });
}

/**
 * Generate a shell-sourceable env line for the current API key.
 * Works for bash/zsh/fish-compatible shells.
 */
export function formatApiKeyExport(key: string): string {
  if (process.platform === 'win32') {
    // PowerShell
    return `$env:ANTHROPIC_API_KEY="${key}"`;
  }
  // bash/zsh
  return `export ANTHROPIC_API_KEY="${key}"`;
}

/**
 * Writes both bash/zsh env file and powershell env file containing
 * environment exports/unsets for the active profile settings.
 */
export async function writeShellEnvFiles(
  apiKey?: string | null,
  apiUrl?: string | null,
  proxy?: string | null
): Promise<void> {
  let envContent = '';
  let psContent = '';

  // API Key
  if (apiKey) {
    envContent += `export ANTHROPIC_API_KEY="${apiKey}"\n`;
    psContent += `$env:ANTHROPIC_API_KEY="${apiKey}"\n`;
  } else {
    envContent += `unset ANTHROPIC_API_KEY\n`;
    psContent += `Remove-Item Env:\\ANTHROPIC_API_KEY -ErrorAction SilentlyContinue\n`;
  }

  // Base URL
  if (apiUrl) {
    envContent += `export ANTHROPIC_BASE_URL="${apiUrl}"\n`;
    psContent += `$env:ANTHROPIC_BASE_URL="${apiUrl}"\n`;
  } else {
    envContent += `unset ANTHROPIC_BASE_URL\n`;
    psContent += `Remove-Item Env:\\ANTHROPIC_BASE_URL -ErrorAction SilentlyContinue\n`;
  }

  // Proxy settings
  if (proxy) {
    envContent += `export HTTPS_PROXY="${proxy}"\n`;
    envContent += `export HTTP_PROXY="${proxy}"\n`;
    psContent += `$env:HTTPS_PROXY="${proxy}"\n`;
    psContent += `$env:HTTP_PROXY="${proxy}"\n`;
  } else {
    envContent += `unset HTTPS_PROXY\n`;
    envContent += `unset HTTP_PROXY\n`;
    psContent += `Remove-Item Env:\\HTTPS_PROXY -ErrorAction SilentlyContinue\n`;
    psContent += `Remove-Item Env:\\HTTP_PROXY -ErrorAction SilentlyContinue\n`;
  }

  await fs.writeFile(APIKEY_ENV_FILE, envContent, 'utf8');
  await fs.writeFile(APIKEY_PS_FILE, psContent, 'utf8');
}

