# Grok Build + Claude Code coordination (no additional API billing)

## Goal
Use Claude Code under the owner's existing Claude Pro subscription and Grok Build under its separately authenticated subscription. GitHub is the shared review surface. This does NOT provide automatic Grok-to-Claude dispatch; the official xAI bridge is Claude-to-Grok.

## Safety rules
- Never add ANTHROPIC_API_KEY or XAI_API_KEY to the repository.
- Claude Code: authenticate interactively with the Claude Pro account. Unset ANTHROPIC_API_KEY before launch. Decline paid API credits when subscription limits are reached.
- Grok CLI: authenticate through the browser/subscription where supported; do not assume free API usage.
- Do not run unattended Claude GitHub Actions or remote Claude automation; those may require separate API billing.
- No automatic production deployments, merges, Stripe changes, secret access, or paid service activation.
- Separate branches for concurrent work; require passing tests and owner approval for merges.

## Install locally (manual, on the owner's Mac)
1. Confirm Node.js >= 18.18, `claude --version`, `grok --version`, and `grok models`.
2. In Claude Code, run:
   `/plugin marketplace add xai-org/grok-build-plugin-cc`
   `/plugin install grok-build@xai-grok-build`
   `/reload-plugins`
   `/grok-build:check`
3. Verify `printenv ANTHROPIC_API_KEY` is empty before using Claude Code.
4. Start a read-only review on a dedicated feature branch and inspect the diff.

## Suggested workflow
1. Owner creates a GitHub issue with acceptance criteria.
2. Claude Code plans and delegates a bounded review to Grok Build using the official bridge.
3. Changes occur on dedicated branches, not directly on main.
4. Run existing test/build commands and document results.
5. Open a PR; owner approves merge/deploy.

## Verified references
- https://github.com/xai-org/grok-build-plugin-cc
- https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan
- https://support.claude.com/en/articles/12304248-manage-api-key-environment-variables-in-claude-code

## Not yet verified
Local Mac installations, Grok account entitlement, plugin installation, successful end-to-end delegation, and repository-specific test commands.
