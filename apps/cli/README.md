# vole-agent

A capable coding and general-purpose agent for your terminal.

## Install

```bash
npm install -g vole-agent
```

## Setup

Add your API key to `~/.vole/config.json` (created automatically on first run):

```json
{ "apiKey": "sk-ant-..." }
```

Or set an environment variable in your shell profile:

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # Anthropic
export OPENROUTER_API_KEY=sk-or-...   # OpenRouter
```

Sessions are stored per-project under `<git-root>/.vole/sessions/` when inside a git repository, or `~/.vole/sessions/` otherwise.

## Usage

```bash
# Interactive chat (bare `vole` defaults to chat in a real terminal)
vole
vole chat                              # explicit form

# Resume previous session
vole chat --resume

# One-shot task
vole run "refactor the auth module to use async/await"

# Web dashboard
vole web

# List sessions
vole sessions
```

## Commands

| Command | Description |
|---|---|
| `vole` | Bare invocation defaults to interactive chat (when stdin is a TTY) |
| `vole chat` | Start an interactive chat session |
| `vole chat --resume` | Resume the most recent session |
| `vole chat --session <id>` | Resume a specific session |
| `vole run "<goal>"` | Run a one-shot background task |
| `vole run --dream` | Consolidate daily memory notes into `MEMORY.md` |
| `vole web` | Open the web dashboard |
| `vole sessions` | List stored sessions |
| `vole tasks` | List background task runs |
| `vole skills` | List loaded skills (also `install`/`enable`/`disable`/`trust`/`review` subcommands) |
| `vole daemon` | Start the cron scheduler daemon (use `--once` for a one-shot run) |
| `vole taskflow list/show/cancel` | Inspect cross-session task records |
| `vole gateway status` | Show lane occupancy in this process and cross-process session locks |
| `vole subagents list` | List recent sub-agent task records (taskflow) |
| `vole subagents kill <id\|all>` | Mark a sub-agent task as cancelled (or all running ones with "all") |

## Chat slash commands

Inside `vole chat`:

| Command | Description |
|---|---|
| `/resume` | Pick and resume a previous session |
| `/clear` | Clear screen and reset context |
| `/trace` | Show recent event trace |
| `/config` | Show current configuration |
| `/skills` | List loaded skills |
| `/help` | Show all commands |
| `/exit` | Leave chat |

## Configuration

Configuration is loaded from (in order of precedence): environment variables → `vole.config.json` (project) → `~/.vole/config.json` (user) → defaults.

**File format** (`~/.vole/config.json` or `vole.config.json`):

```json
{
  "apiKey": "sk-ant-...",
  "model": "claude-haiku-4-5",
  "defaultMode": "confirm"
}
```

**Environment variables:**

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Use Anthropic provider (claude-haiku-4-5) |
| `OPENROUTER_API_KEY` | — | Use OpenRouter (needs `VOLE_MODEL`) |
| `VOLE_API_KEY` | — | Generic API key override |
| `VOLE_BASE_URL` | `https://api.openai.com/v1` | Provider base URL |
| `VOLE_MODEL` | `gpt-4.1-mini` | Model name |
| `VOLE_DEFAULT_MODE` | `confirm` | Autonomy mode: `observe` / `confirm` / `auto` |
| `VOLE_WORKSPACE_ROOT` | `.` | Working directory |
| `VOLE_LONG_TERM_MEMORY` | `disabled` | Memory policy: `disabled` / `read-only` / `write` |
| `VOLE_PROMPT_MODE` | `full` | Prompt rendering: `full` / `minimal` / `none` |
| `VOLE_EXECUTION_CONTRACT` | `default` | Execution discipline: `default` / `strict-agentic` |
| `VOLE_TOOL_PROFILE` | `full` | Tool capability set: `coding` / `full` / `messaging` / `background` |
| `VOLE_SANDBOX` | `false` | Restrict shell to workspace root: `true` / `false` |
| `VOLE_THINKING_BUDGET` | `adaptive` | Anthropic reasoning depth: `off` / `minimal` … `max` / `adaptive` |

## License

MIT
