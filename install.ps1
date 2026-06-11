# claude-switch Windows PowerShell install helper (codex-auth style)
# Run in PowerShell:
#   irm https://raw.githubusercontent.com/<YOUR_GITHUB_USERNAME>/claude-switch/main/install.ps1 | iex
# Or locally: .\install.ps1

# NOTE: Replace <YOUR_GITHUB_USERNAME> with your actual GitHub username before publishing.

$ErrorActionPreference = "Stop"

Write-Host "=== claude-switch installer (terminal-first Claude account switcher) ===" -ForegroundColor Cyan

# Check node
try {
    $nodeVer = node --version
    Write-Host "Node detected: $nodeVer" -ForegroundColor Green
} catch {
    Write-Host "Node.js not found. Please install Node.js 18+ first: https://nodejs.org/" -ForegroundColor Red
    exit 1
}

Write-Host "Installing claude-switch globally..." -ForegroundColor Yellow
npm install -g claude-switch@latest

Write-Host "`nInstallation complete!" -ForegroundColor Green
Write-Host "Try these commands:" -ForegroundColor Cyan
Write-Host "  claude-switch --help"
Write-Host "  claude-switch login          # guided flow"
Write-Host "  claude-switch list"
Write-Host "  claude-switch                # interactive picker (codex-auth style)"
Write-Host "  claude-switch run personal   # launch isolated session"

Write-Host "`nTip: After adding profiles with 'claude-switch add <name> [--full]', use numbers or short names to switch/launch quickly." -ForegroundColor Gray

Write-Host "`nTo uninstall later: npm uninstall -g claude-switch" -ForegroundColor Gray