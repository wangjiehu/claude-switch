# claude-switch

Terminal-first multi-account switcher for Claude Code — supports **API key** and **OAuth** accounts, codex-auth style. Works great on Windows, macOS, and Linux.

## Features

- **Dual auth mode** — API key accounts (`sk-ant-...`) and OAuth accounts (`claude auth login`)
- **⚡ Shell Hook Integration** — Automatic environment switching without manual `eval` or sourcing.
- **🌐 Per-Profile Proxy & API Endpoint** — Configure independent HTTP/HTTPS proxies (`HTTPS_PROXY`) and API gateways (`ANTHROPIC_BASE_URL`) per profile. Residual variables are cleaned automatically when switching.
- **🛡️ Machine-Bound Security** — API keys are stored encrypted using AES-256-GCM with a key derived from your machine's hardware fingerprint (e.g. `MachineGuid` on Windows).
- **codex-auth style UX** — switch by number, name fragment, email, alias, or `-` for previous
- **Registry** — local `registry.json` tracks email, plan type (Free/Pro/Max/API), and last-used times
- **Interactive picker** — arrow-key selection with plan badges and account type labels
- **Guided login** — `claude-switch login` walks you through adding any account type
- **Full isolation** — `claude-switch run <name>` launches Claude with a separate `CLAUDE_CONFIG_DIR`
- **Aliases** — short names for profiles (`w` → `work`)
- **Safe Export/Import** — Export configurations for backups or team sharing. Includes a `--safe` mode to exclude keys/credentials.

## Installation

```bash
git clone https://github.com/wangjiehu/claude-switch
cd claude-switch
npm install
npm run build
npm install -g .
```

## Quick Start

### 1. Enable Shell Hook (Recommended)

Run the following command to print hook functions for your shell:

```bash
claude-switch init
```

Add the wrapper function to your shell profile (`~/.bashrc`, `~/.zshrc`, or `$PROFILE` for PowerShell). This allows you to use the shorthand command `csw` which automatically refreshes your terminal environment variables upon switching profiles.

### 2. Add an API key account

```bash
# Paste key directly
claude-switch add work --api-key sk-ant-api03-...

# Configure custom proxy and API base URL
claude-switch add work --api-key sk-ant-... --proxy http://127.0.0.1:7890 --api-url https://api.company-gateway.com

# Or read from current env
export ANTHROPIC_API_KEY=sk-ant-api03-...
claude-switch add work --api-key-env
```

### 3. Add an OAuth account (claude.ai subscription)

```bash
# Guided flow (recommended)
claude-switch login

# Or manually: log in first, then capture
claude auth login
claude-switch add personal --email me@gmail.com --plan pro
```

### 4. List accounts

```bash
claude-switch list
# Or shorthand
csw ls
# → 01. work  [Pro] [API]  work@company.com   last used: 2 hours ago
#    02. personal [Free] [OAuth]  me@gmail.com   added: 2025-01-15
```

### 5. Switch accounts

```bash
csw 1          # by row number
csw work       # by name fragment
csw work@      # by email fragment
csw -          # back to previous
csw            # interactive picker (arrow keys)
```

---

## All Commands

| Command | Alias | Description |
|---------|-------|-------------|
| `claude-switch` | `csw` | Interactive account picker |
| `list` | `ls` | List all accounts |
| `add [options] <name>` | | Save current auth as profile |
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
| `export [options] <dir>` | | Export all profiles for backup |
| `import <dir>` | | Import profiles from backup |
| `clean` | | Clean temporary files & Claude session history |
| `init` | | Print shell hook integration wrapper |
| `doctor` | | Troubleshoot setup |

### `add` Options

```
--api-key <key>     Store Anthropic API key for this profile
--api-key-env       Read key from ANTHROPIC_API_KEY env var
--email <email>     Set display email
--plan <plan>       free | pro | max | api  (default: unknown)
--note <note>       Short note
--api-url <url>     Set a custom API base URL for this profile
--proxy <url>       Set a proxy URL (HTTP/HTTPS) for this profile
--full              Snapshot entire Claude config dir
-f, --force         Overwrite without confirmation
```

### `export` Options

```
--safe              Exclude sensitive keys and credentials from export (perfect for sharing templates)
```

---

## Storage Layout

```
~/.claude-switch/
  registry.json          ← account registry (name, email, plan, type, proxy, apiUrl)
  aliases.json           ← short aliases
  current-profile.txt    ← active profile name
  previous-profile.txt   ← previous profile (for - switching)
  current-apikey.env     ← current API key env export line (Bash/Zsh sourcing)
  current-apikey.ps1     ← current API key env script (PowerShell dot-sourcing)
  profiles/
    work/
      profile.json       ← metadata
      apikey.json        ← encrypted API key (AES-256-GCM)
      .credentials.json  ← OAuth credentials (if OAuth account)
    personal/
      profile.json
      .credentials.json
```

## Security Design

API keys stored in `apikey.json` are encrypted using `aes-256-gcm`. The encryption key is derived using `pbkdf2` from hardware properties of the host machine (e.g. `MachineGuid` registry key on Windows, platform UUID on macOS, and `/etc/machine-id` on Linux) along with your user profile name. 

This ensures that even if your `.claude-switch` directory is copied or synchronized via cloud drives, it cannot be decrypted on other computers.

## License

MIT
