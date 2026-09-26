# Setting up accounts and keys

Everything goes in `.env` (copy `.env.example`). Nothing here is ever committed, logged unredacted
or written into a skill. `pnpm monk doctor` tells you what's missing.

## Required

| key | how to get it |
| --- | --- |
| `LLM_BASE_URL`, `LLM_API_KEY` | Your LiteLLM proxy (default `https://models.aikin.club/v1`) and a key for it. Give the key a budget in LiteLLM: a stuck retry loop is the main cost risk. |
| `MODEL` | Run `pnpm monk models`: it lists the proxy's models, cheapest tool-calling ones first, and suggests `MODEL` (and `VISION_MODEL` for the Phone helper). |
| `GITHUB_TOKEN` | github.com → Settings → Developer settings → Fine-grained tokens. Give it access to **only** the sandbox repo (and the demo repo), with Contents, Issues, Pull requests and Metadata: read/write. |
| `EVAL_REPO` | An empty repo you own, e.g. `you/monk-sandbox`. `pnpm monk bench seed` fills it with fixture issues, PRs, branches and a tag, all marked `monk-fixture`. Reset only ever touches those. |

## Strongly recommended

| key | why |
| --- | --- |
| `SKILLS_REPO_URL` | TrueForge loads skills **only from public GitHub/GitLab repos**. Create an empty public repo (e.g. `you/monk-skills`); `monk setup` clones it to `SKILLS_REPO_PATH`, and the learning loop commits and pushes skills there. Without it, skills are learned and stored locally but not loaded by the agent. |
| `DAYTONA_API_KEY` | app.daytona.io → Keys, with permission to create snapshots. Without it TrueForge uses its local bwrap sandbox, which can only reach PyPI and GitHub, so the Android Gradle build can't download dependencies. |

## Channels

| key | how |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Message @BotFather → `/newbot`. |
| `DISCORD_BOT_TOKEN` | discord.com/developers → New application → Bot → Reset token. Turn on **Message Content Intent**. Invite it with `bot` + `applications.commands` scopes and Send Messages, Attach Files, Read Message History. |
| `ALLOWED_USERS` | Comma-separated `telegram:<user id>`, `discord:<user id>` (or bare ids). Everyone else is ignored. Get your Telegram id from @userinfobot; for Discord, turn on Developer Mode and use Copy User ID. |

`/link` in one chat gives a code; `/link CODE` in the other joins the same conversation.

**Voice notes (Telegram):** run `bash scripts/setup-stt.sh` once. It installs local speech to text
(faster-whisper, CPU) under `data/stt-venv`, so audio never leaves the machine. Monk replies with
what it heard, then answers it like a typed message.

## Phone (optional, `--phone`)

1. Install the Android command-line tools and set `ANDROID_HOME`.
2. `scripts/emulator.sh setup && scripts/emulator.sh start`, then `scripts/emulator.sh snapshot`
   once it's in a clean state (the eval runner restores `monk-clean` before each mobile task).
3. Set `MONK_PHONE=true` or run `pnpm monk up --phone`. mobile-mcp runs behind the chaos proxy.
4. For screenshots the text model can't read, apply `patches/0001-subagent-models.patch` to
   TrueForge and set `TRUEFORGE_SUBAGENT_MODELS=true`. The Phone helper then runs on `VISION_MODEL`.

## The demo app

`pnpm demo:repo` builds the Tally repo's history locally in `data/demo-tally`: `main`, then PR #12
with the planted bug on `feature/swipe-to-archive`, then the fix on `fix/undo-insets`. When you
want it on GitHub, run `bash demo/scripts/make-demo-repo.sh --publish you/tally`. This creates a
public repo and opens PR #12.

## More MCP servers

Copy `mcp-servers.example.json` to `mcp-servers.json`, then restart `pnpm monk up` and re-run
`pnpm monk setup`. Every server goes behind the chaos proxy, so its tools get chaos-tested,
approval-gated when destructive, and learned from.
