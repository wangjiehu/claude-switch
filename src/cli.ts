#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';

// Global error handlers — must come before any async work
process.on('unhandledRejection', (err: any) => {
  console.error(chalk.red('✗ Unhandled error: ' + (err?.message || String(err))));
  process.exit(1);
});
process.on('uncaughtException', (err: any) => {
  console.error(chalk.red('✗ Fatal error: ' + (err?.message || String(err))));
  process.exit(1);
});

import {
  addProfile,
  listProfiles,
  switchProfile,
  removeProfile,
  getCurrentProfile,
  status,
  whoami,
  interactiveSwitch,
  switchByQuery,
  resolveProfileQuery,
  getAllProfileNames,
  runProfile,
  setAlias,
  clearAlias,
  listAliases,
  exportProfiles,
  importProfiles,
  loginAndCapture,
  printEnv,
  cleanProfiles,
} from './profileManager';
import { ensureClaudeDir, logInfo, logError } from './utils';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version: PKG_VERSION } = require('../package.json') as { version: string };

const program = new Command();

program
  .name('claude-switch')
  .alias('csw')
  .description('Switch between multiple Claude Code accounts (API key & OAuth). codex-auth style.')
  .version(PKG_VERSION);

// Single preAction hook — runs before every command
program.hook('preAction', async () => {
  await ensureClaudeDir();
});

// Bare `claude-switch` → interactive picker
program.action(async () => {
  await interactiveSwitch();
});

// ─────────────────────────────────────────────────────────────────────────────
// Core commands
// ─────────────────────────────────────────────────────────────────────────────

program
  .command('status')
  .description('Show current active profile, auth type, and credential info')
  .action(async () => {
    await status();
  });

program
  .command('whoami')
  .description('Show details of the currently active account (name, email, plan, type)')
  .action(async () => {
    await whoami();
  });

program
  .command('list')
  .alias('ls')
  .description('List all saved accounts with plan badges and last-used times')
  .action(async () => {
    await listProfiles();
  });

program
  .command('add <name>')
  .description('Save the current auth state as a named account profile')
  .option('-f, --force', 'Overwrite existing profile without confirmation')
  .option('--full', 'Snapshot entire Claude config dir for full per-session isolation')
  .option('--api-key <key>', 'Store this Anthropic API key for the profile')
  .option('--api-key-env', 'Read API key from ANTHROPIC_API_KEY env var')
  .option('--email <email>', 'Set account email (for display in list)')
  .option('--plan <plan>', 'Set plan label: free | pro | max | api', 'unknown')
  .option('--note <note>', 'Attach a short note to the profile')
  .option('--api-url <url>', 'Set a custom Anthropic API base URL for this profile')
  .option('--proxy <url>', 'Set a proxy URL (HTTP/HTTPS) for this profile')
  .action(async (name: string, options) => {
    await addProfile(name, {
      force: options.force,
      full: options.full,
      apiKey: options.apiKey,
      apiKeyEnv: options.apiKeyEnv,
      email: options.email,
      plan: options.plan,
      note: options.note,
      apiUrl: options.apiUrl,
      proxy: options.proxy,
    });
  });

program
  .command('switch [query]')
  .alias('use')
  .description('Switch account — supports: number, name fragment, email fragment, alias, or "-" for previous')
  .action(async (query?: string) => {
    if (!query) {
      await interactiveSwitch();
      return;
    }

    const switched = await switchByQuery(query);

    if (!switched) {
      const names = await getAllProfileNames();
      if (names.length > 0) {
        logInfo(`Could not uniquely resolve "${query}". Opening interactive picker...`);
        await interactiveSwitch();
      } else {
        console.log(chalk.yellow('No profiles saved. Run "claude-switch login" to add your first account.'));
      }
    }
  });

program
  .command('run <name>')
  .description('Launch Claude with this account\'s API key or full-isolation config dir')
  .action(async (name: string) => {
    await runProfile(name);
  });

program
  .command('remove <name>')
  .alias('rm')
  .description('Remove a saved profile')
  .action(async (name: string) => {
    await removeProfile(name);
  });

program
  .command('current')
  .description('Print the currently tracked profile name')
  .action(async () => {
    const current = await getCurrentProfile();
    if (current) {
      console.log(chalk.green(`Current: ${current}`));
    } else {
      console.log(chalk.yellow('No profile tracked (using default ~/.claude)'));
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// env — output shell-sourceable variable for the current profile's API key
// ─────────────────────────────────────────────────────────────────────────────

program
  .command('env')
  .description('Print shell-sourceable env vars for current profile\'s API key')
  .option('--powershell', 'Output PowerShell syntax ($env:VAR="val")')
  .option('--bash', 'Output bash/zsh syntax (export VAR="val")')
  .action(async (options) => {
    const shell = options.powershell ? 'powershell' : options.bash ? 'bash' : undefined;
    await printEnv(shell);
  });

// ─────────────────────────────────────────────────────────────────────────────
// login — guided add flow (OAuth or API key)
// ─────────────────────────────────────────────────────────────────────────────

program
  .command('login')
  .description('Guided helper: log in and automatically capture the account')
  .action(async () => {
    await loginAndCapture();
  });

// ─────────────────────────────────────────────────────────────────────────────
// Alias management
// ─────────────────────────────────────────────────────────────────────────────

const aliasCmd = program.command('alias').description('Manage short aliases for profiles');

aliasCmd
  .command('set <name> <alias>')
  .description('Set an alias (e.g. alias set work w)')
  .action(async (name: string, alias: string) => {
    await setAlias(name, alias);
  });

aliasCmd
  .command('clear <alias>')
  .description('Remove an alias')
  .action(async (alias: string) => {
    await clearAlias(alias);
  });

aliasCmd
  .command('list')
  .alias('ls')
  .description('List all aliases')
  .action(async () => {
    await listAliases();
  });

// ─────────────────────────────────────────────────────────────────────────────
// menu / doctor / export / import
// ─────────────────────────────────────────────────────────────────────────────

program
  .command('menu')
  .description('Open interactive account picker')
  .action(async () => {
    await interactiveSwitch();
  });

program
  .command('export <output-dir>')
  .description('Export all profiles (and aliases/registry) for backup or migration')
  .option('--safe', 'Exclude sensitive keys and credentials from export')
  .action(async (outputDir: string, options) => {
    await exportProfiles(outputDir, options.safe);
  });

program
  .command('import <input-dir>')
  .description('Import profiles from a previously exported directory')
  .option('-f, --force', 'Overwrite existing profiles with same name')
  .action(async (inputDir: string, options) => {
    await importProfiles(inputDir, options.force);
  });

program
  .command('clean')
  .description('Clean temporary backups and files (optional Claude Code database cleanup)')
  .action(async () => {
    await cleanProfiles();
  });

program
  .command('init')
  .description('Print shell wrapper function/hook for automatic environment switching')
  .action(() => {
    console.log(chalk.cyan('\n=== Shell Hook Integration ===\n'));
    console.log('To enable automatic environment switching without needing manual eval,');
    console.log('add the following wrapper function to your shell profile.\n');

    console.log(chalk.yellow('For Bash / Zsh (add to ~/.bashrc or ~/.zshrc):'));
    console.log(chalk.gray(`--------------------------------------------------
csw() {
  claude-switch "$@"
  local exit_code=$?
  if [ -f "$HOME/.claude-switch/current-apikey.env" ]; then
    source "$HOME/.claude-switch/current-apikey.env"
  fi
  return $exit_code
}
--------------------------------------------------`));

    console.log(chalk.yellow('\nFor PowerShell (add to $PROFILE or Microsoft.PowerShell_profile.ps1):'));
    console.log(chalk.gray(`--------------------------------------------------
function csw {
    & claude-switch @args
    $exit_code = $LASTEXITCODE
    $env_file = "$HOME/.claude-switch/current-apikey.ps1"
    if (Test-Path $env_file) {
        . "$env_file"
    }
    return $exit_code
}
--------------------------------------------------`));
    console.log('');
  });

program
  .command('doctor')
  .description('Check Claude Code setup and give troubleshooting advice')
  .action(async () => {
    const { getActiveClaudeDir, SWITCH_DIR, APIKEY_ENV_FILE } = await import('./utils');
    const path = await import('path');
    const fs = await import('fs-extra');

    console.log(chalk.cyan('\n=== claude-switch doctor ===\n'));

    const claudeDir = getActiveClaudeDir();
    console.log(`Claude config dir: ${chalk.bold(claudeDir)}`);

    const credFile = path.join(claudeDir, '.credentials.json');
    const hasCred = await fs.pathExists(credFile);
    console.log(`OAuth creds file: ${hasCred ? chalk.green('✓ found') : chalk.yellow('✗ not found')}`);

    const hasKey = !!process.env.ANTHROPIC_API_KEY;
    console.log(`ANTHROPIC_API_KEY in env: ${hasKey ? chalk.green('✓ set') : chalk.yellow('✗ not set')}`);

    const hasEnvFile = await fs.pathExists(APIKEY_ENV_FILE);
    console.log(`API key env file: ${hasEnvFile ? chalk.green('✓ ' + APIKEY_ENV_FILE) : chalk.gray('✗ none')}`);

    console.log(`\nProfile storage: ${chalk.bold(SWITCH_DIR)}`);
    console.log('\n' + chalk.bold('Typical flows:'));
    console.log('  # Add an API key account:');
    console.log(chalk.gray('  claude-switch add work --api-key sk-ant-...'));
    console.log('  # Add an OAuth account:');
    console.log(chalk.gray('  claude-switch login   (follow prompts)'));
    console.log('  # Switch accounts:');
    console.log(chalk.gray('  claude-switch 1       # by row'));
    console.log(chalk.gray('  claude-switch work    # by name'));
    console.log(chalk.gray('  claude-switch -       # previous'));
    console.log('  # Apply API key in current shell:');
    console.log(chalk.gray('  eval $(claude-switch env)                   # bash/zsh'));
    console.log(chalk.gray('  claude-switch env | Invoke-Expression       # PowerShell'));
    console.log('');
  });

// ─────────────────────────────────────────────────────────────────────────────
// Direct profile query at top level: `claude-switch work` / `claude-switch 2`
// ─────────────────────────────────────────────────────────────────────────────

program.on('command:*', async () => {
  try {
    const args = program.args || [];
    if (args.length < 1) return;

    const first = args[0];

    // Skip if it's a known command
    const known = program.commands.flatMap(cmd => [cmd.name(), ...cmd.aliases()]);
    if (known.includes(first)) return;

    const resolved = await resolveProfileQuery(first);

    if (resolved) {
      // For API key profiles, switch (apply env) rather than run
      await switchProfile(resolved);
      process.exit(0);
    } else {
      const switched = await switchByQuery(first);
      if (!switched) await interactiveSwitch();
      process.exit(0);
    }
  } catch (err: any) {
    logError(err?.message || String(err));
    process.exit(1);
  }
});

program.parse(process.argv);
