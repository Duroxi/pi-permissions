<p align="center">
  <img src="docs/assets/logo.png" alt="pi-permissions logo">
</p>

# pi-permissions

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat)](https://opensource.org/licenses/MIT) [![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/) [![Pi Package](https://img.shields.io/badge/Pi-Package-6366F1?style=flat)](https://pi.mariozechner.at/)

A unified permission enforcement extension for the [Pi](https://pi.mariozechner.at/) coding agent, combining the best features from across the Pi permission system ecosystem.

## What It Does

- **Hides disallowed tools** before the agent starts — no wasted turns probing for blocked tools
- **Enforces allow / ask / deny** at tool-call time with UI confirmation dialogs
- **Controls bash commands** with wildcard pattern matching (`git *: ask`, `rm -rf *: deny`)
- **Gates MCP and skill access** at server, tool, and skill-name granularity
- **Protects sensitive file patterns** — cross-cutting `path` rules deny `.env`, `~/.ssh/*`, etc. across all tools and bash at once, matching both the path as referenced and its symlink-resolved form so a deny cannot be evaded through a symlink alias
- **Guards external paths** — prompts before file tools or bash commands reach outside `cwd`
- **Fails closed** — an internal gate error blocks the tool (with a `gate_error` review-log entry), and an unparseable bash command — or an opaque `bash -c`/`eval` wrapper — prompts (`ask`) rather than passing silently
- **Forwards prompts from subagents** — `ask` policies work even in non-UI execution contexts
- **Broadcasts UI prompt events** — `permissions:ui_prompt` fires only when the permission system is about to invoke the active user-facing permission UI
- **Permission modes** — choose from `"default"`, `"allowEdits"`, or `"yolo"` to control auto-approval behavior at a global level
- **Quick permission commands** — `/allow`, `/block`, `/ask`, `/policy` slash commands for interactive rule management without editing config files
- **Cryptographic nonce binding** — forwarded permission responses are verified with timing-safe nonce comparison to prevent response forgery on the file-based IPC channel
- **Timeout fail-safe** — forwarded permission prompts automatically deny after a configurable timeout, preventing hung subagents on unresponsive sessions
- **ReDoS protection** — wildcard patterns exceeding 500 characters are rejected with a never-match sentinel

## Project Origins

This project is an **integration** of three separate Pi permission system projects, combining their respective strengths into a single unified codebase:

| Source | Version | Key Contributions |
|--------|---------|-------------------|
| [**gotgenes/pi-permission-system**](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system) | v18.1.1 | Core architecture — gate pipeline, path normalization, permission manager, access intent extraction, policy loading, subagent forwarding, skill gates, comprehensive test suite, and documentation |
| [**MasuRii/pi-permission-system**](https://github.com/MasuRii/pi-permission-system) | v0.8.0 | Security features — cryptographic nonce binding for forwarded permission IPC, configurable prompt timeout with fail-safe deny, ReDoS protection via wildcard length limits |
| [**pi-quick-perms**](https://github.com/Duroxi/pi-quick-perms) | — | UX features — `"allowEdits"` permission mode for auto-approving write/edit operations, `/allow` `/block` `/ask` quick permission commands, three-state permission mode (`default` / `allowEdits` / `yolo`) |

### Integration Details

- **All bug fixes from both upstreams** are carried forward; each fix was verified against both projects' test suites
- **Adversarial security review** was conducted across 5 dimensions (ReDoS, nonce binding, permission mode logic, quick commands, timeout forwarding) with all critical findings addressed in targeted source fixes and unit tests
- **Cross-platform test compatibility** — path comparisons use `node:path.normalize()` so tests pass on both Windows and POSIX systems
- **318 unit tests** covering all integrated features pass on the combined codebase

## Quick Start

1. Create the global config file at `~/.pi/agent/extensions/pi-permission-system/config.json`:

    ```jsonc
    {
      "permission": {
        "*": "allow",
        "path": {
          "*": "allow",
          "*.env": "deny",
          "*.env.*": "deny",
          "*.env.example": "allow"
        },
        "bash": {
          "*": "ask",
          "rm -rf *": "deny",
          "sudo *": "ask"
        },
        "external_directory": "ask"
      }
    }
    ```

2. Start Pi — the extension automatically loads and enforces your policy.

All permissions use one of three states:

| State   | Behavior                                 |
| ------- | ---------------------------------------- |
| `allow` | Permits the action silently              |
| `deny`  | Blocks the action with an error message  |
| `ask`   | Prompts the user for confirmation via UI |

When the dialog prompts, you can approve once or approve a pattern for the rest of the session.
See [Session Approvals](docs/session-approvals.md) for details on session-scoped rules and pattern suggestions.

The `path` surface is a cross-cutting gate that applies to **all** file access — Pi tools, bash commands, MCP calls, and extension tools alike.
A `path` pattern matches both the path as the agent references it and its canonical (symlink-resolved) form, so a deny still fires when a symlink aliases a sensitive target.

For per-tool path patterns (`read`, `write`, `edit`, `find`, `grep`, `ls`), patterns are matched against the file path from `input.path`.
When Pi's current working directory is known, relative path inputs also match their cwd-normalized absolute form.

The `external_directory` surface is the CWD-boundary gate: it decides whether reaching **outside** the working tree is allowed, and accepts a pattern map so you can allow specific outside-CWD directories without opening up all external access:

```jsonc
{
  "permission": {
    "external_directory": {
      "*": "ask",
      "~/.cargo/registry/*": "allow"
    }
  }
}
```

### Permission Modes

The extension supports three permission modes configured via the `"mode"` field:

| Mode | Behavior |
|------|----------|
| `"default"` | All `ask`-state checks require user confirmation |
| `"allowEdits"` | Auto-approves `write`/`edit` operations on paths inside the current working directory; prompts for everything else including external paths |
| `"yolo"` | Auto-approves all `ask`-state checks (equivalent to the legacy `yoloMode: true`) |

```jsonc
{
  "mode": "allowEdits",
  "permission": {
    "*": "allow",
    "bash": { "*": "ask" }
  }
}
```

### Quick Permission Commands

Manage rules on the fly without editing config files:

- `/allow bash gh api *` — Allow `gh api *` commands
- `/block rm -rf *` — Deny `rm -rf *` commands
- `/ask write /etc/*` — Ask before writing to `/etc/`
- `/policy` — Show the active permission policy file
- `/policy-reload` — Reload Pi resources after policy changes

Use `--global` flag to write to global config instead of project config:
`/allow --global sudo * ask`

## Configuration

Config lives in one JSON file per scope:

| Scope   | Path                                                      |
| ------- | --------------------------------------------------------- |
| Global  | `~/.pi/agent/extensions/pi-permission-system/config.json` |
| Project | `<cwd>/.pi/extensions/pi-permission-system/config.json`   |

Project overrides global; per-agent YAML frontmatter overrides both.

Within a surface map like `bash` or `mcp`, **last matching rule wins** — put broad catch-alls first and specific overrides after.

For the full reference — all surfaces, runtime knobs, per-agent overrides, merge semantics, and common recipes — see [Configuration Reference](docs/configuration.md).

## Documentation

- [Configuration Reference](docs/configuration.md) — Full policy reference, runtime knobs, per-agent overrides, recipes
- [Session Approvals](docs/session-approvals.md) — Session-scoped rules, pattern suggestions
- [Cross-Extension API](docs/cross-extension-api.md) — Service accessor, event bus integration
- [Subagent Integration](docs/subagent-integration.md) — Permission forwarding, subagent coexistence
- [Troubleshooting](docs/troubleshooting.md) — Common issues, diagnostic logging, threat model

## Development

```bash
npm run check       # Type-check TypeScript (no emit)
npm run test        # Run tests
npm run test:watch  # Run tests in watch mode
```

## Security

This project takes permission enforcement seriously. Key security mechanisms include:

- **Cryptographic nonce binding**: Forwarded permission responses must echo a 32-byte `crypto.randomBytes` nonce, verified with `timingSafeEqual` to prevent response forgery
- **Timeout fail-safe**: Forwarded permission prompts auto-deny after a configurable timeout (`forwardedPromptTimeoutSeconds`, default 30s), preventing hung subagents
- **ReDoS protection**: Wildcard patterns exceeding 500 characters are rejected; the length check runs after tilde expansion to prevent bypass
- **Never-match regex**: Exceedingly long or malformed patterns compile to `/[^\s\S]/` — a character class that cannot match any character including empty string
- **Fails closed**: All gate errors, parse failures, and unhandled edge cases default to `deny` or `ask`, never `allow`
- **Nonce-based request IDs**: Forwarded permission request IDs use `crypto.randomUUID()` for unpredictable file names on the IPC channel

## License

[MIT](LICENSE)
