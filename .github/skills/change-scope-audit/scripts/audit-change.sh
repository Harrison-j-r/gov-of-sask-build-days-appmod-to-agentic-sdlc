#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/../../../.." && pwd)"
spec="${1:?Usage: audit-change.sh <specs/change.md>}"
spec_file="$(
  if [[ "$spec" = /* ]]; then printf '%s' "$spec"; else printf '%s/%s' "$repo_root" "$spec"; fi
)"
spec_file="$(cd -- "$(dirname -- "$spec_file")" && pwd)/$(basename -- "$spec_file")"
case "$spec_file" in
  "$repo_root/specs/"*) ;;
  *) echo "Spec must be inside specs/." >&2; exit 2 ;;
esac
[[ -f "$spec_file" ]] || { echo "Specification not found: $spec" >&2; exit 2; }
relative_spec="${spec_file#"$repo_root"/}"

echo "Specification: $relative_spec"
echo "Approval markers:"
grep -Ei '(^>?\s*[-*]?\s*\[.*approved|Status:|Human approval|Approved specification commit|Reviewer:|Approval date:)' "$spec_file" |
  sed 's/^/  /' || true

echo
echo "Worktree changes:"
status="$(cd -- "$repo_root" && git --no-pager status --short)"
if [[ -n "$status" ]]; then printf '%s\n' "$status" | sed 's/^/  /'; else echo "  none"; fi

echo
echo "Allowed-path and source-root lines:"
grep -Ein '(^|[[:space:]])(Allowed paths|Source root|Primary validation command)|^[[:space:]]*[-*][[:space:]]+`[^`]+`' "$spec_file" |
  sed 's/^/  /' || echo "  none found"

echo
echo "Audit complete; no worktree change was made."
