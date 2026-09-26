# TrueForge patches

Monk runs against unmodified TrueForge. The patches here are optional, minimal, and written as
upstreamable PRs (each `.patch` has a matching `.md` PR description). Nothing in Monk requires
them unless the matching flag is set.

| patch | enables | flag |
| --- | --- | --- |
| `0001-subagent-models` | Phone helper on a vision model while everything else stays on DeepSeek | `TRUEFORGE_SUBAGENT_MODELS=true` |

Check a patch still applies: `git -C vendor/trueforge apply --check ../../patches/<name>.patch`.
