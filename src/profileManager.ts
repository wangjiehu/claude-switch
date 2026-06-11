import path from 'path';
import fs from 'fs-extra';
import inquirer from 'inquirer';
import ora from 'ora';
import chalk from 'chalk';
import { execFileSync, spawn } from 'child_process';
import {
  getActiveClaudeDir,
  getProfileDir,
  sanitizeProfileName,
  profileExists,
  SWITCH_DIR,
  PROFILES_DIR,
  CREDENTIALS_FILE,
  METADATA_FILE,
  APIKEY_FILE,
  ProfileMetadata,
  copyCredentials,
  logSuccess,
  logInfo,
  logWarn,
  logError,
  ensureDir,
  CONFIG_SUBDIR,
  launchClaudeWithConfigDir,
  loadAliases,
  saveAliases,
  readApiKeyFromProfile,
  saveApiKeyToProfile,
  APIKEY_ENV_FILE,
  formatApiKeyExport,
  resolveClaudeBin,
  writeShellEnvFiles,
  APPDATA_CLAUDE_DIR,
} from './utils';
import {
  upsertAccount,
  removeAccount,
  loadRegistry,
  touchAccount,
  findEntry,
  formatPlan,
  formatRelativeTime,
  AccountType,
  PlanType,
  REGISTRY_FILE,
} from './registry';

// ─────────────────────────────────────────────────────────────────────────────
// status
// ─────────────────────────────────────────────────────────────────────────────

export async function status() {
  const activeDir = getActiveClaudeDir();
  const isOverridden = !!process.env.CLAUDE_CONFIG_DIR;

  console.log(chalk.bold('Claude Code config dir:'), activeDir);
  if (isOverridden) {
    logInfo('Using CLAUDE_CONFIG_DIR (full isolation mode)');
  }

  const credPath = path.join(activeDir, CREDENTIALS_FILE);
  const hasCreds = await fs.pathExists(credPath);

  if (hasCreds) {
    logSuccess('Credentials file found (.credentials.json) — OAuth session active');
  } else {
    logWarn('No .credentials.json found. Using API key or not yet logged in.');
  }

  // Check env for API key
  if (process.env.ANTHROPIC_API_KEY) {
    const key = process.env.ANTHROPIC_API_KEY;
    const masked = key.slice(0, 10) + '...' + key.slice(-4);
    logSuccess(`ANTHROPIC_API_KEY is set in env: ${masked}`);
  }

  const current = await getCurrentProfile();
  if (current) {
    console.log(chalk.bold('Tracked current profile:'), chalk.green(current));

    // Show registry info for current
    const registry = await loadRegistry();
    const entry = findEntry(registry, current);
    if (entry) {
      if (entry.email) console.log(chalk.gray(`  Email: ${entry.email}`));
      if (entry.plan)  console.log(chalk.gray(`  Plan:  ${formatPlan(entry.plan)}`));
      console.log(chalk.gray(`  Type:  ${entry.accountType}`));
    }
  } else {
    console.log(chalk.gray('No active profile tracked (default or unmanaged)'));
  }

  console.log(chalk.gray(`Profile storage: ${PROFILES_DIR}`));
}

// ─────────────────────────────────────────────────────────────────────────────
// whoami
// ─────────────────────────────────────────────────────────────────────────────

export async function whoami() {
  const current = await getCurrentProfile();

  if (!current) {
    logWarn('No active profile tracked. Use "claude-switch add <name>" to save the current account.');
    // Still show env key if present
    if (process.env.ANTHROPIC_API_KEY) {
      const key = process.env.ANTHROPIC_API_KEY;
      const masked = key.slice(0, 10) + '...' + key.slice(-4);
      logInfo(`Current env ANTHROPIC_API_KEY: ${masked}`);
    }
    return;
  }

  const registry = await loadRegistry();
  const entry = findEntry(registry, current);

  console.log('');
  console.log(chalk.bold('Currently active account'));
  console.log(chalk.bold('────────────────────────'));

  const metaPath = path.join(getProfileDir(current), METADATA_FILE);
  const meta: ProfileMetadata = await fs.readJson(metaPath).catch(() => ({ name: current, dirName: current, createdAt: '' }));

  console.log(`  Name:  ${chalk.green(meta.name || current)}`);

  if (entry?.email) {
    console.log(`  Email: ${chalk.cyan(entry.email)}`);
  }
  if (entry?.plan) {
    const planColors: Record<string, (s: string) => string> = {
      pro: chalk.blue, max: chalk.magenta, free: chalk.gray, api: chalk.yellow, unknown: chalk.gray,
    };
    const color = planColors[entry.plan] || chalk.white;
    console.log(`  Plan:  ${color(formatPlan(entry.plan))}`);
  }

  const type = entry?.accountType || meta.accountType || 'unknown';
  console.log(`  Type:  ${chalk.gray(type === 'apikey' ? 'API Key' : type === 'oauth' ? 'OAuth (claude.ai login)' : 'Unknown')}`);

  if (entry?.lastUsed) {
    console.log(`  Used:  ${chalk.gray(formatRelativeTime(entry.lastUsed))}`);
  }

  // Show current API key if apikey type
  if (type === 'apikey') {
    const key = await readApiKeyFromProfile(current);
    if (key) {
      const masked = key.slice(0, 10) + '...' + key.slice(-4);
      console.log(`  Key:   ${chalk.gray(masked)}`);
    }
  }

  console.log('');
}

// ─────────────────────────────────────────────────────────────────────────────
// list
// ─────────────────────────────────────────────────────────────────────────────

export async function listProfiles() {
  await ensureDir(PROFILES_DIR);

  const names = await getAllProfileNames();

  if (names.length === 0) {
    logInfo('No profiles saved yet.');
    console.log('Run: claude-switch add <name>            (saves current credentials)');
    console.log('Or:  claude-switch add <name> --api-key  (save an API key account)');
    return;
  }

  const current = await getCurrentProfile();
  const registry = await loadRegistry();

  console.log(chalk.bold('\nClaude accounts:\n'));

  const metaList = await Promise.all(
    names.map(async (name, index) => {
      const metaPath = path.join(PROFILES_DIR, name, METADATA_FILE);
      const meta: ProfileMetadata = (await fs.readJson(metaPath).catch(() => null)) || {
        name,
        dirName: name,
        createdAt: '',
      };
      const entry = findEntry(registry, name);
      return { name, index, meta, entry };
    })
  );

  for (const { name, index, meta, entry } of metaList) {
    const displayName = meta.name || name;
    const num = String(index + 1).padStart(2, '0');
    const isCurrent = current === name;

    const prefix = isCurrent ? chalk.green('→') : ' ';
    const namePart = isCurrent ? chalk.green.bold(displayName) : chalk.bold(displayName);

    // Plan badge
    const plan = entry?.plan || meta.plan;
    const planBadge = plan ? ` ${chalk.bgBlue.white(` ${formatPlan(plan as PlanType)} `)}` : '';

    // Account type badge
    const accType = entry?.accountType || meta.accountType || 'unknown';
    const typeBadge = accType === 'apikey'
      ? chalk.yellow(' [API]')
      : accType === 'oauth'
      ? chalk.blue(' [OAuth]')
      : '';

    const email = entry?.email || meta.email || '';

    console.log(`${prefix} ${chalk.gray(num)}. ${namePart}${planBadge}${typeBadge}${email ? '  ' + chalk.gray(email) : ''}`);

    const lastUsed = entry?.lastUsed || meta.lastUsed;
    if (lastUsed) {
      console.log(`     ${chalk.gray('last used: ' + formatRelativeTime(lastUsed))}`);
    } else {
      const created = meta.createdAt ? new Date(meta.createdAt).toLocaleDateString() : 'unknown';
      console.log(`     ${chalk.gray('added: ' + created)}`);
    }
    console.log('');
  }

  console.log(chalk.gray('Quick switch:'));
  console.log(chalk.gray('  claude-switch 1          # by row number'));
  console.log(chalk.gray('  claude-switch work       # by name fragment'));
  console.log(chalk.gray('  claude-switch -          # back to previous account'));
  console.log(chalk.gray('  claude-switch            # open interactive picker\n'));

  if (current) {
    console.log(chalk.gray(`Currently active: ${current}`));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// add
// ─────────────────────────────────────────────────────────────────────────────

export async function addProfile(
  name: string,
  options: {
    force?: boolean;
    full?: boolean;
    apiKey?: string;       // explicit key provided via CLI
    apiKeyEnv?: boolean;   // read from ANTHROPIC_API_KEY env var
    email?: string;
    plan?: string;
    note?: string;
    apiUrl?: string;
    proxy?: string;
  } = {}
) {
  const profileDir = getProfileDir(name);
  const dirName = sanitizeProfileName(name);

  if (await profileExists(name) && !options.force) {
    const { overwrite } = await inquirer.prompt([{
      type: 'confirm',
      name: 'overwrite',
      message: `Profile "${name}" already exists. Overwrite?`,
      default: false,
    }]);
    if (!overwrite) {
      logWarn('Aborted.');
      return;
    }
  }

  await ensureDir(profileDir);

  // ── Determine account type ──────────────────────────────────────────────────

  let apiKey: string | undefined = options.apiKey;

  // --api-key-env: pick up key from environment
  if (!apiKey && options.apiKeyEnv) {
    apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      logError('--api-key-env was set but ANTHROPIC_API_KEY is not in the current environment.');
      return;
    }
  }

  // Interactive: if no OAuth creds and no key passed, ask what mode
  const activeDir = getActiveClaudeDir();
  const hasOAuthCreds = await fs.pathExists(path.join(activeDir, CREDENTIALS_FILE));
  const hasEnvKey = !!process.env.ANTHROPIC_API_KEY;

  if (!apiKey && !hasOAuthCreds) {
    if (hasEnvKey) {
      // Auto-suggest picking up the env key
      const { useEnv } = await inquirer.prompt([{
        type: 'confirm',
        name: 'useEnv',
        message: `No OAuth credentials found. Use current ANTHROPIC_API_KEY from env? (${process.env.ANTHROPIC_API_KEY!.slice(0, 12)}...)`,
        default: true,
      }]);
      if (useEnv) {
        apiKey = process.env.ANTHROPIC_API_KEY;
      }
    } else {
      const { mode } = await inquirer.prompt([{
        type: 'list',
        name: 'mode',
        message: 'No credentials detected. How will this account authenticate?',
        choices: [
          { name: 'Enter API key manually', value: 'manual' },
          { name: 'I will log in via "claude auth login" first', value: 'oauth' },
          { name: 'Cancel', value: 'cancel' },
        ],
      }]);

      if (mode === 'cancel') { logWarn('Aborted.'); return; }
      if (mode === 'oauth') {
        logInfo('Please run "claude auth login" in another terminal, then re-run this command.');
        return;
      }
      if (mode === 'manual') {
        const { key } = await inquirer.prompt([{
          type: 'password',
          name: 'key',
          message: 'Paste your ANTHROPIC_API_KEY:',
          validate: (v: string) => v.startsWith('sk-ant-') ? true : 'Key should start with sk-ant-',
        }]);
        apiKey = key;
      }
    }
  }

  const accountType: AccountType = apiKey ? 'apikey' : hasOAuthCreds ? 'oauth' : 'unknown';
  const mode = options.full ? 'full config snapshot' : apiKey ? 'API key' : 'credentials only';
  const spinner = ora(`Saving account "${name}" (${mode})...`).start();

  try {
    if (apiKey) {
      // ── API Key mode ──────────────────────────────────────────────────────
      await saveApiKeyToProfile(dirName, apiKey, options.note);
    } else if (options.full) {
      // ── Full snapshot mode ────────────────────────────────────────────────
      const configTarget = path.join(profileDir, CONFIG_SUBDIR);
      await fs.copy(activeDir, configTarget, { overwrite: true, dereference: true });
      await copyCredentials(activeDir, profileDir);
      await fs.writeJson(path.join(profileDir, 'full.json'), { full: true }, { spaces: 2 });
    } else {
      // ── Light OAuth mode ──────────────────────────────────────────────────
      await copyCredentials(activeDir, profileDir);
      const activeCred = path.join(activeDir, CREDENTIALS_FILE);
      if (await fs.pathExists(activeCred)) {
        await fs.copy(activeCred, path.join(profileDir, 'credentials.snapshot.json'), { overwrite: true });
      }
    }

    // ── Write profile metadata ────────────────────────────────────────────────
    const meta: ProfileMetadata = {
      name,
      dirName,
      createdAt: new Date().toISOString(),
      accountType,
      ...(options.email ? { email: options.email } : {}),
      ...(options.plan ? { plan: options.plan } : {}),
      ...(options.note ? { note: options.note } : {}),
      ...(options.apiUrl ? { apiUrl: options.apiUrl } : {}),
      ...(options.proxy ? { proxy: options.proxy } : {}),
    };
    await fs.writeJson(path.join(profileDir, METADATA_FILE), meta, { spaces: 2 });

    // ── Register in registry.json ─────────────────────────────────────────────
    await upsertAccount({
      id: dirName,
      name,
      accountType,
      addedAt: new Date().toISOString(),
      ...(options.email ? { email: options.email } : {}),
      ...(options.plan ? { plan: options.plan as PlanType } : {}),
      ...(options.apiUrl ? { apiUrl: options.apiUrl } : {}),
      ...(options.proxy ? { proxy: options.proxy } : {}),
    });

    spinner.succeed(`Profile "${name}" saved (${mode}).`);

    if (apiKey) {
      const masked = apiKey.slice(0, 10) + '...' + apiKey.slice(-4);
      logSuccess(`API key saved: ${masked}`);
      logInfo('To activate in this shell, run:');
      console.log(chalk.bold(`  eval $(claude-switch env)   # bash/zsh`));
      console.log(chalk.bold(`  claude-switch env | Invoke-Expression   # PowerShell`));
    } else if (options.full) {
      logSuccess('Full config directory snapshotted. Use "claude-switch run ' + name + '" for isolated sessions.');
    } else if (accountType === 'oauth') {
      logSuccess('OAuth credentials captured. You can now switch to other accounts and come back.');
    } else {
      logWarn('No credentials found. Profile created but may be empty.');
    }

    await setCurrentProfile(dirName);
  } catch (err: any) {
    spinner.fail('Failed to save profile');
    logError(err.message || String(err));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// switch
// ─────────────────────────────────────────────────────────────────────────────

export async function switchProfile(name: string) {
  const profileDir = getProfileDir(name);

  if (!(await profileExists(name))) {
    logError(`Profile "${name}" does not exist.`);
    console.log('Available profiles: run "claude-switch list"');
    return;
  }

  const activeDir = getActiveClaudeDir();
  const spinner = ora(`Switching to "${name}"...`).start();

  try {
    // Determine account type
    const metaPath = path.join(profileDir, METADATA_FILE);
    const meta: ProfileMetadata = await fs.readJson(metaPath).catch(() => ({
      name,
      dirName: sanitizeProfileName(name),
      createdAt: new Date().toISOString(),
    }));

    const registry = await loadRegistry();
    const entry = findEntry(registry, sanitizeProfileName(name));
    const accountType = entry?.accountType || meta.accountType || 'unknown';

    if (accountType === 'apikey') {
      // ── API Key switch ──────────────────────────────────────────────────────
      const key = await readApiKeyFromProfile(sanitizeProfileName(name));
      if (!key) {
        spinner.fail('No API key found in this profile.');
        logInfo('Re-add it with: claude-switch add ' + name + ' --api-key-env');
        process.exit(1);
      }

      const apiUrl = entry?.apiUrl || meta.apiUrl;
      const proxy = entry?.proxy || meta.proxy;
      await writeShellEnvFiles(key, apiUrl, proxy);

      spinner.succeed(`Switched to "${name}" (API key mode).`);
      console.log('');
      logInfo('To apply in this shell, run one of:');
      console.log(chalk.bold('  eval $(claude-switch env)                  # bash/zsh'));
      console.log(chalk.bold('  claude-switch env | Invoke-Expression      # PowerShell'));
      console.log('');
      logInfo('Or start a new terminal — new sessions will pick it up automatically.');
    } else {
      // ── OAuth credential swap ───────────────────────────────────────────────
      // Clear env keys so OAuth credentials can take precedence
      await writeShellEnvFiles(null, null, null);

      // 1. Backup current active credentials
      const backupDir = path.join(SWITCH_DIR, 'current-backup');
      await ensureDir(backupDir);
      await copyCredentials(activeDir, backupDir);

      // 2. Atomically restore profile credentials
      const tempCred = path.join(activeDir, '.credentials.tmp.json');
      const sourceCred = path.join(profileDir, CREDENTIALS_FILE);
      let restored = false;

      if (await fs.pathExists(sourceCred)) {
        await fs.copy(sourceCred, tempCred, { overwrite: true });
        await fs.move(tempCred, path.join(activeDir, CREDENTIALS_FILE), { overwrite: true });
        restored = true;
      }

      spinner.succeed(`Switched to "${name}".`);

      if (restored) {
        logSuccess('OAuth credentials restored to active Claude directory.');
        logInfo('Restart Claude Code or start a new terminal session for changes to take effect.');
      } else {
        logWarn('No credentials file in profile. You may need to log in first.');
      }

      console.log(chalk.gray(`Active config dir: ${activeDir}`));
    }

    // 3. Update registry (single source of truth for lastUsed)
    await touchAccount(sanitizeProfileName(name));
    await setCurrentProfile(sanitizeProfileName(name));

  } catch (err: any) {
    spinner.fail('Switch failed');
    logError(err.message || String(err));
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// env — output shell-sourceable env vars for current profile
// ─────────────────────────────────────────────────────────────────────────────

export async function printEnv(shell?: string) {
  const current = await getCurrentProfile();

  if (!current) {
    // No profile — just show whatever is in env
    if (process.env.ANTHROPIC_API_KEY) {
      console.log(formatApiKeyExport(process.env.ANTHROPIC_API_KEY));
    } else {
      logWarn('No active profile and no ANTHROPIC_API_KEY in env.');
      process.exit(1);
    }
    return;
  }

  const registry = await loadRegistry();
  const entry = findEntry(registry, current);
  const meta = await getProfileMetadata(current);

  const key = await readApiKeyFromProfile(current);
  const apiUrl = entry?.apiUrl || meta?.apiUrl;
  const proxy = entry?.proxy || meta?.proxy;

  const isPowerShell = shell === 'powershell' || (process.platform === 'win32' && !shell);

  const outputs: string[] = [];

  if (key) {
    outputs.push(isPowerShell ? `$env:ANTHROPIC_API_KEY="${key}"` : `export ANTHROPIC_API_KEY="${key}"`);
  } else {
    outputs.push(isPowerShell ? `Remove-Item Env:\\ANTHROPIC_API_KEY -ErrorAction SilentlyContinue` : `unset ANTHROPIC_API_KEY`);
  }

  if (apiUrl) {
    outputs.push(isPowerShell ? `$env:ANTHROPIC_BASE_URL="${apiUrl}"` : `export ANTHROPIC_BASE_URL="${apiUrl}"`);
  } else {
    outputs.push(isPowerShell ? `Remove-Item Env:\\ANTHROPIC_BASE_URL -ErrorAction SilentlyContinue` : `unset ANTHROPIC_BASE_URL`);
  }

  if (proxy) {
    outputs.push(isPowerShell ? `$env:HTTPS_PROXY="${proxy}"` : `export HTTPS_PROXY="${proxy}"`);
    outputs.push(isPowerShell ? `$env:HTTP_PROXY="${proxy}"` : `export HTTP_PROXY="${proxy}"`);
  } else {
    outputs.push(isPowerShell ? `Remove-Item Env:\\HTTPS_PROXY -ErrorAction SilentlyContinue` : `unset HTTPS_PROXY`);
    outputs.push(isPowerShell ? `Remove-Item Env:\\HTTP_PROXY -ErrorAction SilentlyContinue` : `unset HTTP_PROXY`);
  }

  console.log(outputs.join('\n'));
}

// ─────────────────────────────────────────────────────────────────────────────
// login — guided login + auto capture
// ─────────────────────────────────────────────────────────────────────────────

export async function loginAndCapture() {
  console.log(chalk.cyan('\n=== claude-switch login (guided) ===\n'));

  const { mode } = await inquirer.prompt([{
    type: 'list',
    name: 'mode',
    message: 'What type of account do you want to add?',
    choices: [
      { name: 'OAuth / claude.ai subscription (runs claude auth login)', value: 'oauth' },
      { name: 'API key (paste key directly)', value: 'apikey' },
    ],
  }]);

  const { profileName } = await inquirer.prompt([{
    type: 'input',
    name: 'profileName',
    message: 'Name this account (e.g. work, personal):',
    validate: (v: string) => v.trim().length > 0 ? true : 'Name cannot be empty',
  }]);

  if (mode === 'apikey') {
    const { key } = await inquirer.prompt([{
      type: 'password',
      name: 'key',
      message: 'Paste your ANTHROPIC_API_KEY:',
      validate: (v: string) => v.startsWith('sk-ant-') ? true : 'Key should start with sk-ant-',
    }]);

    const { email } = await inquirer.prompt([{
      type: 'input',
      name: 'email',
      message: 'Account email (optional, for display):',
    }]);

    const { plan } = await inquirer.prompt([{
      type: 'list',
      name: 'plan',
      message: 'Plan type (for display):',
      choices: ['api', 'pro', 'max', 'free', 'unknown'],
      default: 'api',
    }]);

    await addProfile(profileName, {
      apiKey: key,
      email: email || undefined,
      plan,
    });
    return;
  }

  // OAuth mode: record mtime before, launch claude auth login, detect change
  const activeDir = getActiveClaudeDir();
  const credFile = path.join(activeDir, CREDENTIALS_FILE);
  const mtimeBefore = await fs.pathExists(credFile)
    ? (await fs.stat(credFile)).mtimeMs
    : 0;

  console.log('\n' + chalk.bold('Step 1:') + ' Launching "claude auth login"...');
  console.log(chalk.gray('Complete the browser OAuth flow, then return here.\n'));

  await new Promise<void>((resolve, reject) => {
    const claudeBin = resolveClaudeBin();
    const child = spawn(claudeBin, ['auth', 'login'], {
      stdio: 'inherit',
      shell: true,
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`claude auth login exited with code ${code}`));
    });
  }).catch((err) => {
    logError(`Login failed: ${err.message}`);
    logInfo('You can still manually run "claude auth login" then "claude-switch add <name>".');
  });

  // Check if credentials changed
  const credExists = await fs.pathExists(credFile);
  const mtimeAfter = credExists ? (await fs.stat(credFile)).mtimeMs : 0;

  if (!credExists || mtimeAfter <= mtimeBefore) {
    logWarn('No new credentials detected after login.');
    logInfo('If you completed the OAuth flow, run: claude-switch add ' + profileName);
    return;
  }

  logSuccess('New credentials detected! Saving as profile "' + profileName + '"...');

  const { email } = await inquirer.prompt([{
    type: 'input',
    name: 'email',
    message: 'Account email (optional, for display):',
  }]);

  const { plan } = await inquirer.prompt([{
    type: 'list',
    name: 'plan',
    message: 'Plan type (for display):',
    choices: ['pro', 'max', 'free', 'unknown'],
    default: 'unknown',
  }]);

  await addProfile(profileName, {
    email: email || undefined,
    plan,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// run
// ─────────────────────────────────────────────────────────────────────────────

export async function runProfile(name: string, extraArgs: string[] = []) {
  const profileDir = getProfileDir(name);

  if (!(await profileExists(name))) {
    logError(`Profile "${name}" does not exist.`);
    process.exit(1);
  }

  // Check if API key profile
  const key = await readApiKeyFromProfile(sanitizeProfileName(name));
  if (key) {
    const env = { ...process.env, ANTHROPIC_API_KEY: key };
    logInfo(`Launching claude with API key from profile "${name}"...`);
    const claudeBin = resolveClaudeBin();
    const child = spawn(claudeBin, extraArgs, {
      stdio: 'inherit',
      env,
      shell: true,
    });
    child.on('error', (err: Error) => logError(`Failed to launch claude: ${err.message}`));
    child.on('close', (code: number) => { if (code !== 0) logWarn(`Claude exited with code ${code}`); });
    return;
  }

  const fullMarker = path.join(profileDir, 'full.json');
  const isFull = await fs.pathExists(fullMarker);

  if (isFull) {
    const configDir = path.join(profileDir, CONFIG_SUBDIR);
    if (await fs.pathExists(configDir)) {
      launchClaudeWithConfigDir(configDir, extraArgs);
      return;
    }
  }

  // Fallback: credential swap then launch
  logWarn('Profile does not have a full snapshot. Performing credential swap then launching...');
  await switchProfile(name);

  const activeDir = getActiveClaudeDir();
  logInfo(`Launching claude (current credentials are now from "${name}")`);
  launchClaudeWithConfigDir(activeDir, extraArgs);
}

// ─────────────────────────────────────────────────────────────────────────────
// switchByQuery / interactiveSwitch
// ─────────────────────────────────────────────────────────────────────────────

export async function switchByQuery(query: string): Promise<boolean> {
  const resolved = await resolveProfileQuery(query);

  if (resolved) {
    await switchProfile(resolved);
    return true;
  }

  return false;
}

export async function interactiveSwitch(): Promise<void> {
  const names = await getAllProfileNames();

  if (names.length === 0) {
    logInfo('No profiles saved yet. Use "claude-switch login" to add your first account.');
    return;
  }

  const current = await getCurrentProfile();
  const previous = await getPreviousProfile();
  const registry = await loadRegistry();

  const choices = names.map((name, idx) => {
    const num = String(idx + 1).padStart(2, '0');
    const isCurrent = current === name;
    const isPrevious = previous === name && !isCurrent;

    const entry = findEntry(registry, name);
    const planBadge = entry?.plan ? ` [${formatPlan(entry.plan)}]` : '';
    const typeBadge = entry?.accountType === 'apikey' ? ' (API)' : entry?.accountType === 'oauth' ? ' (OAuth)' : '';
    const emailPart = entry?.email ? ` ${entry.email}` : '';

    let label = `${name}${planBadge}${typeBadge}${emailPart}`;
    if (isCurrent) label += ` ${chalk.green('← current')}`;
    if (isPrevious) label += ` ${chalk.yellow('← previous')}`;

    return {
      name: `${num}. ${label}`,
      value: name,
      short: name,
    };
  });

  const { selected } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selected',
      message: 'Select account to switch to:',
      choices: [
        ...choices,
        new inquirer.Separator(),
        { name: 'Cancel', value: null },
      ],
      pageSize: 14,
    },
  ]);

  if (!selected) {
    logInfo('Cancelled.');
    return;
  }

  await switchProfile(selected);
}

// ─────────────────────────────────────────────────────────────────────────────
// remove
// ─────────────────────────────────────────────────────────────────────────────

export async function removeProfile(name: string) {
  const profileDir = getProfileDir(name);

  if (!(await profileExists(name))) {
    logError(`Profile "${name}" not found.`);
    return;
  }

  const { confirm } = await inquirer.prompt([{
    type: 'confirm',
    name: 'confirm',
    message: `Delete profile "${name}" and all its data?`,
    default: false,
  }]);

  if (!confirm) {
    logWarn('Cancelled.');
    return;
  }

  await fs.remove(profileDir);

  const current = await getCurrentProfile();
  if (current === sanitizeProfileName(name)) {
    await clearCurrentProfile();
  }

  // Remove from registry
  await removeAccount(sanitizeProfileName(name));

  logSuccess(`Profile "${name}" removed.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile state helpers
// ─────────────────────────────────────────────────────────────────────────────

export async function getCurrentProfile(): Promise<string | null> {
  const marker = path.join(SWITCH_DIR, 'current-profile.txt');
  if (await fs.pathExists(marker)) {
    const name = (await fs.readFile(marker, 'utf8')).trim();
    if (name && await profileExists(name)) {
      return name;
    }
  }
  return null;
}

async function setCurrentProfile(dirName: string) {
  const current = await getCurrentProfile();
  if (current && current !== dirName) {
    const prevMarker = path.join(SWITCH_DIR, 'previous-profile.txt');
    await fs.writeFile(prevMarker, current, 'utf8');
  }
  const marker = path.join(SWITCH_DIR, 'current-profile.txt');
  await fs.writeFile(marker, dirName, 'utf8');
}

async function clearCurrentProfile() {
  const marker = path.join(SWITCH_DIR, 'current-profile.txt');
  if (await fs.pathExists(marker)) {
    await fs.remove(marker);
  }
}

export async function getPreviousProfile(): Promise<string | null> {
  const prevMarker = path.join(SWITCH_DIR, 'previous-profile.txt');
  if (await fs.pathExists(prevMarker)) {
    const name = (await fs.readFile(prevMarker, 'utf8')).trim();
    if (name && await profileExists(name)) {
      return name;
    }
  }
  return null;
}

export async function getAllProfileNames(): Promise<string[]> {
  await ensureDir(PROFILES_DIR);
  const entries = await fs.readdir(PROFILES_DIR);

  const checks = await Promise.all(
    entries.map(async (entry) => {
      const metaPath = path.join(PROFILES_DIR, entry, METADATA_FILE);
      return (await fs.pathExists(metaPath)) ? entry : null;
    })
  );

  return checks.filter((e): e is string => e !== null);
}

export async function getProfileMetadata(name: string): Promise<ProfileMetadata | null> {
  const p = path.join(getProfileDir(name), METADATA_FILE);
  if (await fs.pathExists(p)) {
    return fs.readJson(p);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Alias support
// ─────────────────────────────────────────────────────────────────────────────

export async function setAlias(nameOrQuery: string, alias: string) {
  const resolved = await resolveProfileQuery(nameOrQuery);
  if (!resolved) {
    logError(`Could not resolve profile for "${nameOrQuery}". Use exact name or run list first.`);
    return;
  }

  const aliases = await loadAliases();
  aliases[alias] = resolved;
  await saveAliases(aliases);

  logSuccess(`Alias "${alias}" set to profile "${resolved}".`);
  logInfo(`You can now use: claude-switch ${alias}   or   claude-switch switch ${alias}`);
}

export async function clearAlias(alias: string) {
  const aliases = await loadAliases();
  if (aliases[alias]) {
    delete aliases[alias];
    await saveAliases(aliases);
    logSuccess(`Alias "${alias}" cleared.`);
  } else {
    logWarn(`No alias named "${alias}".`);
  }
}

export async function listAliases() {
  const aliases = await loadAliases();
  const entries = Object.entries(aliases);

  if (entries.length === 0) {
    logInfo('No aliases set yet. Use "claude-switch alias set <name> <short>"');
    return;
  }

  console.log(chalk.bold('\nAliases:\n'));
  for (const [alias, target] of entries) {
    console.log(`  ${chalk.cyan(alias)}  →  ${target}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile query resolver (supports aliases, numbers, fragments)
// ─────────────────────────────────────────────────────────────────────────────

export async function resolveProfileQuery(query: string): Promise<string | null> {
  const trimmed = query.trim().toLowerCase();

  // Special: switch back to previous
  if (trimmed === '-' || trimmed === 'previous' || trimmed === 'prev') {
    return await getPreviousProfile();
  }

  const aliases = await loadAliases();
  if (aliases[query] || aliases[trimmed]) {
    const target = aliases[query] || aliases[trimmed];
    if (await profileExists(target)) return target;
  }

  const allProfiles = await getAllProfileNames();

  // Exact match
  const exact = allProfiles.find(p => p.toLowerCase() === trimmed);
  if (exact) return exact;

  // Numeric row
  if (/^\d+$/.test(trimmed)) {
    const index = parseInt(trimmed, 10) - 1;
    if (index >= 0 && index < allProfiles.length) {
      return allProfiles[index];
    }
    return null;
  }

  // Partial name match
  const matches = allProfiles.filter(name =>
    name.toLowerCase().includes(trimmed)
  );

  if (matches.length === 1) {
    return matches[0];
  }

  // Also try matching against registry email / display name
  const registry = await loadRegistry();
  const emailMatches = allProfiles.filter(name => {
    const e = findEntry(registry, name);
    return e?.email?.toLowerCase().includes(trimmed) || e?.name?.toLowerCase().includes(trimmed);
  });

  if (emailMatches.length === 1) return emailMatches[0];

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Export / Import
// ─────────────────────────────────────────────────────────────────────────────

export async function exportProfiles(outputDir: string, safe = false) {
  await ensureDir(outputDir);
  const modeLabel = safe ? ' (safe mode)' : '';
  const spinner = ora(`Exporting profiles to ${outputDir}${modeLabel}...`).start();

  try {
    const names = await getAllProfileNames();
    if (names.length === 0) {
      spinner.warn('No profiles to export.');
      return;
    }

    for (const name of names) {
      const src = getProfileDir(name);
      const dest = path.join(outputDir, name);
      await ensureDir(dest);

      // Always copy metadata
      const metaSrc = path.join(src, METADATA_FILE);
      if (await fs.pathExists(metaSrc)) {
        await fs.copy(metaSrc, path.join(dest, METADATA_FILE));
      }

      if (!safe) {
        // Copy credentials and config in non-safe mode
        const apikeySrc = path.join(src, APIKEY_FILE);
        if (await fs.pathExists(apikeySrc)) {
          await fs.copy(apikeySrc, path.join(dest, APIKEY_FILE));
        }
        const oauthSrc = path.join(src, CREDENTIALS_FILE);
        if (await fs.pathExists(oauthSrc)) {
          await fs.copy(oauthSrc, path.join(dest, CREDENTIALS_FILE));
        }
        const snapSrc = path.join(src, 'credentials.snapshot.json');
        if (await fs.pathExists(snapSrc)) {
          await fs.copy(snapSrc, path.join(dest, 'credentials.snapshot.json'));
        }
        const fullMarker = path.join(src, 'full.json');
        if (await fs.pathExists(fullMarker)) {
          await fs.copy(fullMarker, path.join(dest, 'full.json'));
        }
        const configSrc = path.join(src, CONFIG_SUBDIR);
        if (await fs.pathExists(configSrc)) {
          await fs.copy(configSrc, path.join(dest, CONFIG_SUBDIR));
        }
      }
    }

    // Export aliases and registry
    const aliases = await loadAliases();
    await fs.writeJson(path.join(outputDir, 'aliases.json'), aliases, { spaces: 2 });

    const registry = await loadRegistry();
    await fs.writeJson(path.join(outputDir, 'registry.json'), registry, { spaces: 2 });

    spinner.succeed(`Exported ${names.length} profiles to ${outputDir}${modeLabel}`);
    if (safe) {
      logSuccess('Safe export completed: API keys and credentials were excluded.');
    } else {
      logInfo('You can zip this folder or move it to another machine.');
    }
    logInfo('To import later: claude-switch import ' + outputDir);
  } catch (err: any) {
    spinner.fail('Export failed');
    logError(err.message);
  }
}

export async function importProfiles(inputDir: string, force = false) {
  if (!(await fs.pathExists(inputDir))) {
    logError(`Import path does not exist: ${inputDir}`);
    return;
  }

  const spinner = ora(`Importing profiles from ${inputDir}...`).start();

  try {
    const entries = await fs.readdir(inputDir);
    let imported = 0;

    for (const entry of entries) {
      const srcProfile = path.join(inputDir, entry);
      if (!(await fs.stat(srcProfile)).isDirectory()) continue;

      const metaPath = path.join(srcProfile, METADATA_FILE);
      if (!(await fs.pathExists(metaPath))) continue;

      const dest = getProfileDir(entry);
      if (await profileExists(entry) && !force) {
        logWarn(`Skipping existing profile "${entry}" (use --force to overwrite)`);
        continue;
      }

      await fs.copy(srcProfile, dest, { overwrite: true });
      imported++;

      // Re-register in local registry
      const meta: ProfileMetadata = await fs.readJson(metaPath).catch(() => ({}));
      if (meta.name) {
        await upsertAccount({
          id: sanitizeProfileName(entry),
          name: meta.name,
          accountType: (meta.accountType as AccountType) || 'unknown',
          addedAt: meta.createdAt || new Date().toISOString(),
          email: meta.email,
          plan: (meta.plan as PlanType) || undefined,
        });
      }
    }

    // Import aliases
    const aliasSrc = path.join(inputDir, 'aliases.json');
    if (await fs.pathExists(aliasSrc)) {
      const importedAliases = await fs.readJson(aliasSrc);
      const current = await loadAliases();
      await saveAliases({ ...current, ...importedAliases });
    }

    // Import registry (merge)
    const regSrc = path.join(inputDir, 'registry.json');
    if (await fs.pathExists(regSrc)) {
      const importedReg = await fs.readJson(regSrc).catch(() => ({ accounts: [] }));
      const localReg = await loadRegistry();
      for (const acc of (importedReg.accounts || [])) {
        if (!findEntry(localReg, acc.id)) {
          localReg.accounts.push(acc);
        }
      }
      await fs.writeJson(REGISTRY_FILE, localReg, { spaces: 2 });
    }

    spinner.succeed(`Imported ${imported} profiles.`);
    if (imported > 0) logSuccess('Run "claude-switch list" to see them.');
  } catch (err: any) {
    spinner.fail('Import failed');
    logError(err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Clean temporary files and caches
// ─────────────────────────────────────────────────────────────────────────────
export async function cleanProfiles() {
  const spinner = ora('Cleaning temporary files...').start();
  try {
    const backupDir = path.join(SWITCH_DIR, 'current-backup');
    const psFile = path.join(SWITCH_DIR, 'current-apikey.ps1');
    const envFile = path.join(SWITCH_DIR, 'current-apikey.env');

    let cleanedCount = 0;
    if (await fs.pathExists(backupDir)) {
      await fs.remove(backupDir);
      cleanedCount++;
    }
    if (await fs.pathExists(psFile)) {
      await fs.remove(psFile);
      cleanedCount++;
    }
    if (await fs.pathExists(envFile)) {
      await fs.remove(envFile);
      cleanedCount++;
    }

    spinner.succeed(`Cleaned ${cleanedCount} temporary files/directories.`);

    const { cleanIndexedDB } = await inquirer.prompt([{
      type: 'confirm',
      name: 'cleanIndexedDB',
      message: 'Do you want to clean Claude Code session databases and history (IndexedDB)?',
      default: false,
    }]);

    if (cleanIndexedDB) {
      const dbDir = path.join(APPDATA_CLAUDE_DIR, 'IndexedDB');
      if (await fs.pathExists(dbDir)) {
        const dbSpinner = ora('Clearing Claude IndexedDB...').start();
        await fs.remove(dbDir).catch((e) => {
          dbSpinner.warn(`Could not clear IndexedDB fully (it might be in use): ${e.message}`);
        });
        dbSpinner.succeed('Claude IndexedDB directories cleared.');
      } else {
        logInfo('No Claude IndexedDB directories found.');
      }
    }
  } catch (err: any) {
    spinner.fail('Cleanup failed');
    logError(err.message);
  }
}

