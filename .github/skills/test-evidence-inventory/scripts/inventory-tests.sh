#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/../../../.." && pwd)"
project_root="${1:?Usage: inventory-tests.sh <project-root>}"
if [[ ! -d "$repo_root/$project_root" ]]; then
  echo "Project root not found: $project_root" >&2
  exit 2
fi
root="$(cd -- "$repo_root/$project_root" && pwd)"

case "$root" in
  "$repo_root/legacy-src/java-asset-manager"|"$repo_root/legacy-src/java-asset-manager/"* \
  |"$repo_root/legacy-src/dotnet-bookcatalog/shared-legacy-app"|"$repo_root/legacy-src/dotnet-bookcatalog/shared-legacy-app/"*) ;;
  *) echo "ProjectRoot must be one of the selected legacy Java or .NET roots." >&2; exit 2 ;;
esac

relative="${root#"$repo_root"/}"
echo "Test evidence inventory: $relative"

if [[ "$relative" == legacy-src/java-asset-manager* ]]; then
  echo "Track: Java / Maven"
  mapfile -t test_files < <(find "$root" -type f -name '*Test*.java' | sort)
  echo "Test files: $((${#test_files[@]}))"
  for file in "${test_files[@]}"; do echo "  ${file#"$repo_root"/}"; done
  echo "Framework declarations:"
  mapfile -t pom_files < <(find "$root" -type f -name pom.xml | sort)
  framework_found=false
  for file in "${pom_files[@]}"; do
    if grep -Eiq 'junit|spring-boot-starter-test|mockito' "$file"; then
      echo "  ${file#"$repo_root"/}"
      framework_found=true
    fi
  done
  [[ "$framework_found" == true ]] || echo "  none found"
  echo "Proposed validation: ./mvnw -B test"
elif [[ "$relative" == legacy-src/dotnet-bookcatalog/shared-legacy-app* ]]; then
  echo "Track: classic .NET / MSBuild"
  mapfile -t projects < <(
    find "$root" -type f -name '*.csproj' -not -path '*/bin/*' -not -path '*/obj/*' -not -path '*/packages/*' | sort
  )
  echo "C# projects: ${#projects[@]}"
  test_count=0
  echo "Test projects:"
  for file in "${projects[@]}"; do
    if [[ "$(basename "$file")" =~ (Test|Spec) ]] ||
       grep -Eiq 'xunit|nunit|mstest|Microsoft.NET.Test.Sdk' "$file"; then
      echo "  ${file#"$repo_root"/}"
      test_count=$((test_count + 1))
    fi
  done
  [[ "$test_count" -gt 0 ]] || echo "  none found"
  echo "Proposed validation: msbuild BookCatalog.sln -restore -p:Configuration=Release"
fi

echo "Inventory complete; no test or build command was run."
