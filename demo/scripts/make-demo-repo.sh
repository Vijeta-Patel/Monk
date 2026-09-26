#!/usr/bin/env bash
# Builds the Tally demo repo's history locally:
#   main                          habit list
#   feature/swipe-to-archive      PR #12 "Add swipe-to-archive on habit list" (3 commits, UNDO hidden bug)
#   fix/undo-insets               the fix, one commit on top of the PR branch
#
# Local only by default. `--publish <owner>/<repo>` creates the GitHub repo and opens PR #12
# with gh; run that yourself when you're ready (it's public, and it pushes).
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
out="${OUT:-$here/../data/demo-tally}"
publish=""
if [[ "${1:-}" == "--publish" ]]; then publish="${2:?usage: --publish owner/repo}"; fi

rm -rf "$out"
mkdir -p "$out"
cp -R "$here/tally/." "$out/"
cd "$out"
git init -q -b main
git config user.name "${GIT_AUTHOR_NAME:-monk-demo}"
git config user.email "${GIT_AUTHOR_EMAIL:-monk-demo@localhost}"
git add -A
git commit -q -m "Tally: a tiny habit tracker"

git checkout -q -b feature/swipe-to-archive
cp "$here/tally-pr12/app/src/main/java/dev/monk/tally/MainActivity.kt" app/src/main/java/dev/monk/tally/
git commit -qam "Archive habits by swiping left"
cp "$here/tally-pr12/app/src/main/res/layout/activity_main.xml" app/src/main/res/layout/
git add -A && git commit -qm "Show an undo bar after archiving; draw edge to edge"
cp "$here/tally-pr12/app/src/test/java/dev/monk/tally/ArchiveTest.kt" app/src/test/java/dev/monk/tally/
git add -A && git commit -qm "Tests for archive and undo"

git checkout -q -b fix/undo-insets
cp "$here/tally-fix/app/src/main/java/dev/monk/tally/MainActivity.kt" app/src/main/java/dev/monk/tally/
git commit -qam "Keep the undo bar above the navigation bar (fixes #13)"
git checkout -q feature/swipe-to-archive
echo "demo repo ready at $out"
git log --oneline --all --graph | sed 's/^/  /'

if [[ -n "$publish" ]]; then
  gh repo create "$publish" --public --source . --remote origin --push
  git push -q origin main feature/swipe-to-archive fix/undo-insets
  gh repo edit "$publish" --default-branch main
  gh pr create --repo "$publish" --base main --head feature/swipe-to-archive \
    --title "Add swipe-to-archive on habit list" \
    --body "Swipe a habit left to archive it; an undo bar lets you bring it back for 5 seconds."
  echo "During the demo, after monk files the issue: git push origin fix/undo-insets:feature/swipe-to-archive"
fi
