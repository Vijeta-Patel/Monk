#!/usr/bin/env bash
# Local, Monk-only AgentEye built from the agenteye repo's main worktree (hosted LLM judges + JEV).
# Model settings come from Monk's .env, so the LiteLLM proxy and key are set in one place.
# No demo-agent: the instance only ever holds what Monk sends it.
set -euo pipefail
AE="${AGENTEYE_DIR:-$HOME/Desktop/agenteye-main}"
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
if [[ -f "$root/.env" ]]; then set -a; . "$root/.env"; set +a; fi

# Hosted LLM judges call the proxy directly (AgentEye's external LLM mode).
export AGENTEYE_LLM_MODE=external
export AGENTEYE_LLM_BASE_URL="${LLM_BASE_URL%/}"; AGENTEYE_LLM_BASE_URL="${AGENTEYE_LLM_BASE_URL%/v1}"
export AGENTEYE_LLM_API_KEY="${LLM_API_KEY:-}"
export AGENTEYE_JUDGE_MODEL="${JUDGE_MODEL:-${MODEL:-}}"
# The audit agent reaches the same proxy (Anthropic-style /v1/messages, which LiteLLM serves).
export AGENTEYE_AGENT_MODEL="${AUDIT_MODEL:-${JUDGE_MODEL:-${MODEL:-claude-sonnet-4-6}}}"
# JEV (classifier evaluations) runs on Cloudflare Workers AI: account id + API token, optionally
# through an AI Gateway. A pasted Cloudflare URL is accepted too; the account id (and gateway
# name) are read out of it. Unset leaves JEV off and says so.
jev_acct="${AGENTEYE_JEV_ACCOUNT_ID:-}"
jev_gateway="${AGENTEYE_JEV_GATEWAY_ID:-}"
if [[ "$jev_acct" == http* ]]; then
  if [[ "$jev_acct" =~ gateway\.ai\.cloudflare\.com/v1/([^/]+)/([^/]+) ]]; then
    jev_gateway="${jev_gateway:-${BASH_REMATCH[2]}}"; jev_acct="${BASH_REMATCH[1]}"
  elif [[ "$jev_acct" =~ /accounts/([^/]+) ]]; then
    jev_acct="${BASH_REMATCH[1]}"
  else
    echo "! AGENTEYE_JEV_ACCOUNT_ID is a URL without a Cloudflare account id in it; set the id itself" >&2; jev_acct=""
  fi
fi
export FAILPROOFAI_EVALUATOR_JEV_ACCOUNT_ID="$jev_acct"
export FAILPROOFAI_EVALUATOR_JEV_TOKEN="${AGENTEYE_JEV_TOKEN:-}"
export FAILPROOFAI_EVALUATOR_JEV_GATEWAY_ID="$jev_gateway"
export FAILPROOFAI_EVALUATOR_JEV_BASE_URL="${AGENTEYE_JEV_BASE_URL:-https://api.cloudflare.com/client/v4}"

compose=(docker compose -p agenteye-monk -f "$AE/docker-compose.yml" -f "$here/compose.monk.yml")
"${compose[@]}" up -d postgres redis clickhouse minio minio-init mailpit server dashboard managed-evaluator agent
echo "waiting for the server…"
for _ in $(seq 1 90); do curl -sf http://localhost:8080/health >/dev/null 2>&1 && break; sleep 2; done
curl -sf http://localhost:8080/health >/dev/null && echo "✓ AgentEye server http://localhost:8080 · dashboard http://localhost:3000 · login emails http://localhost:8027"
[[ -n "$AGENTEYE_LLM_API_KEY" && -n "$AGENTEYE_JUDGE_MODEL" ]] && echo "✓ LLM judges via $AGENTEYE_LLM_BASE_URL ($AGENTEYE_JUDGE_MODEL)" || echo "· LLM judges off until LLM_API_KEY and MODEL are set in .env"
[[ -n "$AGENTEYE_LLM_API_KEY" ]] && echo "✓ audits via $AGENTEYE_AGENT_MODEL" || echo "· audits find nothing until LLM_API_KEY is set (the agentic leg needs a model)"
[[ -n "$FAILPROOFAI_EVALUATOR_JEV_TOKEN" ]] && echo "✓ JEV classifier on" || echo "· JEV off until AGENTEYE_JEV_ACCOUNT_ID and AGENTEYE_JEV_TOKEN are set in .env"
