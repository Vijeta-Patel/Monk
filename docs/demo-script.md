# Demo script (5 minutes)

Ends on the before/after number, with one unscripted moment a judge controls.

## Before you go on

- `pnpm monk trueforge`, `pnpm monk up --phone`, `pnpm monk setup`, `pnpm monk doctor` all green.
- The demo repo is published: https://github.com/chhhee10/tally with PR #1 open (`demo/scripts/make-demo-repo.sh --publish`).
  The fix is ready on `fix/undo-insets`, not yet pushed to the PR.
- The emulator is booted from `monk-clean`, and mirrored on the left of the screen (`scrcpy`).
- Right of the screen: `pnpm tui`, 120×36 or larger. Dashboard on the second display at :8788.
- The benchmark report from the last full run is open in a tab (`benchmarks/results/<date>/REPORT.md`).
- Record with a throwaway GitHub token and bot; revoke both afterwards.

## Beats

| time | beat | on screen | you do |
| --- | --- | --- | --- |
| 0:00 | "An agent that acts on your real systems and gets better every time something breaks." | one slide | |
| 0:20 | On Telegram: **"Test PR #1 on github.com/chhhee10/tally on the phone before we ship"** | phone in hand + big screen | send it |
| 0:40 | Monk plans six steps, then builds and tests in the sandbox | TUI: plan, `ctrl+o` on the build step shows the dashed ▣ sandbox well | point at "isolated · can't touch your machine" |
| 1:20 | APK installs; the Phone helper taps through swipe-to-archive; chaos drops a popup and crashes the app; Monk recovers with learned skills | emulator left, TUI chaos card right | |
| 2:00 | Finds the planted bug: UNDO hides under the nav bar. Files issue #13 with a screenshot and repro steps | GitHub issue | open it |
| 2:30 | Push the fix: `git push origin fix/undo-insets:feature/swipe-to-archive`. Monk re-tests on the phone; it passes | emulator + TUI | push |
| 2:50 | Approval: "merge PR #1 and publish v1.3.0?" with the exact repo, SHAs, tag and file hash | yellow screen in the TUI + buttons on Telegram | tap **✓ Approve** on the phone (filmed) |
| 3:20 | Learning curve: generations 0–5, success up, chaos tax down, confidence intervals don't overlap | dashboard | |
| 3:50 | A judge picks any fault (API or phone). `/chaos <fault>` injects it into the live session; Monk recovers | Telegram + TUI chaos feed | hand them the phone |
| 4:30 | "Same agent, different job, just message it. All stock TrueForge plus Monk plugins." | README | |

## If something breaks on stage

- Wi-Fi or an API down: switch to the recorded 2-minute backup video.
- The model stalls: `esc` in the TUI or `/stop` in Telegram, then resend.
- To show the TUI without keys at all: `pnpm demo` plays the same story offline.
