# Monk skills

Skills Monk learned from its own sessions. The learning loop (`@monk/learn`) writes one directory per skill:

```
<skill-name>/SKILL.md
```

Each `SKILL.md` has YAML frontmatter (`name`, `description`, and a `monk:` block with `source_sessions`, `fault_types`, `verified`, `win_rate`, `version`) followed by numbered steps. Every add, update, merge and retirement is its own git commit, so any skill can be reviewed with `git log -p <name>` and undone with `git revert`.

## Requirements for TrueForge

- This repo must be a **public GitHub (or GitLab) repo**. TrueForge only loads git skills from HTTPS `github.com` / `gitlab.com` URLs and fetches them without credentials, so private repos and local paths do not work.
- Set `SKILLS_REPO_URL` (the HTTPS URL of this repo), `SKILLS_REPO_REF` (branch, default `main`) and `SKILLS_REPO_PATH` (local clone) in Monk's `.env`. Add the GitHub repo as the `origin` remote of the local clone; Monk pushes after each learning round (never force-pushes).
- Monk registers each active skill with TrueForge as `{ type: 'git', name, description, url, ref, path: '<skill-name>' }` and sets the `monk` agent's `skills[]` (max 50, best win rate first). TrueForge re-checks the ref on every turn, so pushed changes take effect on the next turn.
- TrueForge does not read the frontmatter; the name and description the model sees come from the registration. The agent reads the file at `/opt/tfy/skills/<skill-name>/SKILL.md`.

Do not edit skills here by hand while Monk is learning; changes are fine between rounds (Monk reads its own database, not this repo, when merging).
