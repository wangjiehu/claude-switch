/**
 * registry.ts — Account registry (codex-auth style)
 *
 * Maintains ~/.claude-switch/registry.json as the single source of truth
 * for all saved accounts. Each entry records metadata about an account
 * independently of which profile directory it lives in.
 */

import fs from 'fs-extra';
import path from 'path';
import { SWITCH_DIR } from './utils';

export const REGISTRY_FILE = path.join(SWITCH_DIR, 'registry.json');

export type AccountType = 'apikey' | 'oauth' | 'unknown';
export type PlanType = 'free' | 'pro' | 'max' | 'api' | 'unknown';

export interface AccountEntry {
  /** Sanitized directory name — primary key */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Email address (if known) */
  email?: string;
  /** Claude plan type */
  plan?: PlanType;
  /** How this account authenticates */
  accountType: AccountType;
  /** ISO timestamp when this account was added */
  addedAt: string;
  /** ISO timestamp of last switch to this account */
  lastUsed?: string;
  /** Short note / label */
  note?: string;
}

export interface Registry {
  version: number;
  accounts: AccountEntry[];
}

const DEFAULT_REGISTRY: Registry = {
  version: 1,
  accounts: [],
};

/** Load the registry, returning a default if it doesn't exist or is corrupt. */
export async function loadRegistry(): Promise<Registry> {
  if (await fs.pathExists(REGISTRY_FILE)) {
    try {
      const data = await fs.readJson(REGISTRY_FILE);
      // Basic migration: ensure version field
      if (!data.version) data.version = 1;
      if (!Array.isArray(data.accounts)) data.accounts = [];
      return data as Registry;
    } catch {
      // Corrupt file — start fresh
      return { ...DEFAULT_REGISTRY, accounts: [] };
    }
  }
  return { ...DEFAULT_REGISTRY, accounts: [] };
}

/** Persist the registry to disk. */
export async function saveRegistry(registry: Registry): Promise<void> {
  await fs.ensureDir(SWITCH_DIR);
  await fs.writeJson(REGISTRY_FILE, registry, { spaces: 2 });
}

/** Find an entry by id (sanitized dir name). */
export function findEntry(registry: Registry, id: string): AccountEntry | undefined {
  return registry.accounts.find(a => a.id === id);
}

/**
 * Upsert an account entry into the registry.
 * Merges fields — existing fields not in `entry` are preserved.
 */
export async function upsertAccount(entry: Partial<AccountEntry> & { id: string }): Promise<void> {
  const registry = await loadRegistry();
  const idx = registry.accounts.findIndex(a => a.id === entry.id);

  if (idx >= 0) {
    // Merge — don't overwrite fields the caller didn't provide
    registry.accounts[idx] = { ...registry.accounts[idx], ...entry };
  } else {
    registry.accounts.push({
      name: entry.id,
      accountType: 'unknown',
      addedAt: new Date().toISOString(),
      ...entry,
    });
  }

  await saveRegistry(registry);
}

/** Remove an account entry by id. */
export async function removeAccount(id: string): Promise<void> {
  const registry = await loadRegistry();
  registry.accounts = registry.accounts.filter(a => a.id !== id);
  await saveRegistry(registry);
}

/** Mark an account as last used now. */
export async function touchAccount(id: string): Promise<void> {
  await upsertAccount({ id, lastUsed: new Date().toISOString() });
}

/** Format plan label for display */
export function formatPlan(plan?: PlanType): string {
  switch (plan) {
    case 'pro':  return 'Pro';
    case 'max':  return 'Max';
    case 'free': return 'Free';
    case 'api':  return 'API';
    default:     return '?';
  }
}

/** Format a relative time string (e.g. "2 hours ago") */
export function formatRelativeTime(iso?: string): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString();
}
