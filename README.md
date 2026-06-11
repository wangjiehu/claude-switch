# claude-switch

Terminal-first multi-account switcher for Claude Code — supports **API key** and **OAuth** accounts, codex-auth style.

## Features

- **Dual auth mode** — API key accounts (`sk-ant-...`) and OAuth accounts (`claude auth login`)
- **codex-auth style UX** — switch by number, name fragment, email, alias, or `-` for previous
- **Registry** — local `registry.json` tracks email, plan type (Free/Pro/Max/API), and last-used times
- **Interactive picker** — arrow-key selection with plan badges and account type labels
- **Guided login** — `claude-switch login` walks you through adding any account type
- **Shell env export** — `claude-switch env` prints `export ANTHROPIC_API_KEY=...` for sourcing
- **Full isolation** — `claude-switch run <name>` launches Claude with a separate `CLAUDE_CONFIG_DIR`
- **Aliases** — short names for profiles (`w` → `work`)
- **Export/import** — move profiles between machines

## Installation

```bash
git clone https://github.com/yourname/claude-switch
cd claude-switch
npm install
npm run build
npm install -g .
```

## Quick Start

### Add an API key account

```bash
# Paste key directly
claude-switch add work --api-key sk-ant-api03-...

# Or read from current env
export ANTHROPIC_API_KEY=sk-ant-api03-...
claude-switch add work --api-key-env

# With metadata
claude-switch add work --api-key sk-ant-... --email work@company.com --plan pro
```

### Add an OAuth account (claude.ai subscription)

```bash
# Guided flow (recommended)
claude-switch login

# Or manually: log in first, then capture
claude auth login
claude-switch add personal --email me@gmail.com --plan pro
```

### List accounts

```bash
claude-switch list
# → 01. work  [Pro] [API]  work@company.com   last used: 2 hours ago
#    02. personal [Free] [OAuth]  me@gmail.com   added: 2025-01-15
```

### Switch accounts

```bash
claude-switch 1          # by row number
claude-switch work       # by name fragment
claude-switch work@      # by email fragment
claude-switch -          # back to previous
claude-switch            # interactive picker (arrow keys)
```

### Apply API key in current shell

After switching to an API key account, run:

```bash
# bash / zsh
eval $(claude-switch env)

# PowerShell
claude-switch env | Invoke-Expression
# or
claude-switch env --powershell | Invoke-Expression
```

### See current account

```bash
claude-switch whoami
# Currently active account
# ────────────────────────
#   Name:  work
#   Email: work@company.com
#   Plan:  Pro
#   Type:  API Key
#   Used:  2 hours ago
#   Key:   sk-ant-api0...xyz4
```

### Full isolation launch

```bash
# Snapshot a full config (recommended for long-running parallel work)
claude-switch add work --full

# Launch with isolated CLAUDE_CONFIG_DIR
claude-switch run work
```

## All Commands

| Command | Alias | Description |
|---------|-------|-------------|
| `claude-switch` | `csw` | Interactive account picker |
| `list` | `ls` | List all accounts |
| `add <name>` | | Save current auth as profile |
| `switch [query]` | `use` | Switch account (number/name/email/alias/-) |
| `login` | | Guided add flow (OAuth or API key) |
| `whoami` | | Show current account details |
| `env` | | Print shell-sourceable API key export |
| `run <name>` | | Launch Claude with isolated config |
| `remove <name>` | `rm` | Remove a profile |
| `current` | | Print active profile name |
| `status` | | Show auth state and active dir |
| `alias set <name> <short>` | | Create a short alias |
| `alias list` | | List all aliases |
| `alias clear <alias>` | | Remove an alias |
| `export <dir>` | | Export all profiles for backup |
| `import <dir>` | | Import profiles from backup |
| `doctor` | | Troubleshoot setup |

## `add` options

```
--api-key <key>     Store Anthropic API key for this profile
--api-key-env       Read key from ANTHROPIC_API_KEY env var
--email <email>     Set display email
--plan <plan>       free | pro | max | api  (default: unknown)
--note <note>       Short note
--full              Snapshot entire Claude config dir
-f, --force         Overwrite without confirmation
```

## Storage Layout

```
~/.claude-switch/
  registry.json          ← account registry (name, email, plan, type)
  aliases.json           ← short aliases
  current-profile.txt    ← active profile name
  previous-profile.txt   ← previous profile (for - switching)
  current-apikey.env     ← current API key export line (for shell sourcing)
  profiles/
    work/
      profile.json       ← metadata
      apikey.json        ← encrypted API key (if API key account)
      .credentials.json  ← OAuth credentials (if OAuth account)
    personal/
      profile.json
      .credentials.json
```

## How it works

### API key accounts
The key is stored in `~/.claude-switch/profiles/<name>/apikey.json`. On switch, a shell-sourceable line is written to `~/.claude-switch/current-apikey.env`. Run `eval $(claude-switch env)` to apply in the current shell.

### OAuth accounts
The `.credentials.json` from `~/.claude/` is copied into the profile on `add`, and restored atomically on `switch`. Restart Claude Code after switching.

## License

MIT
