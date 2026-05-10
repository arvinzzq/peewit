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
# Interactive chat
vole chat

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
| `vole chat` | Start an interactive chat session |
| `vole chat --resume` | Resume the most recent session |
| `vole chat --session <id>` | Resume a specific session |
| `vole run "<goal>"` | Run a one-shot background task |
| `vole web` | Open the web dashboard |
| `vole sessions` | List stored sessions |
| `vole tasks` | List background task runs |
| `vole skills` | Manage agent skills |

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
| `VOLE_API_KEY` | — | Anthropic API key |
| `OPENROUTER_API_KEY` | — | OpenRouter API key (alternative) |
| `VOLE_MODEL` | `claude-sonnet-4-6` | Model to use |
| `VOLE_MODEL_PROVIDER` | `anthropic` | Provider (`anthropic` or `openai-compatible`) |
| `VOLE_MAX_TOKENS` | `16000` | Max output tokens |

## License

MIT
