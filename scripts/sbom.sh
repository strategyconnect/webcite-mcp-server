#!/usr/bin/env bash
# Write a CycloneDX SBOM of the production npm dependency tree of one commit.
#
# Usage:
#   scripts/sbom.sh [--sha <commit>] [--out <file>]
#
# Defaults: --sha HEAD, --out ./sbom.cdx.json. The tree comes from
# package.json and package-lock.json at that commit (git show), not
# from the working tree or an installed node_modules, so the SBOM matches the
# released commit exactly. Dev dependencies are left out. The commit SHA is
# recorded in metadata.properties (webcite:source-commit), and the result is
# validated against the CycloneDX 1.6 JSON schema; the script fails if it is
# invalid. Tools run through npx at pinned versions and are not app dependencies.
set -euo pipefail

CDX_NPM=@cyclonedx/cyclonedx-npm@6.0.1
CDX_LIB=@cyclonedx/cyclonedx-library@10.5.1
AJV=(ajv@8.17.1 ajv-formats@3.0.1 ajv-formats-draft2019@1.6.1)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REV=HEAD
OUT="$PWD/sbom.cdx.json"
while [ $# -gt 0 ]; do
  case "$1" in
    --sha) REV="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
case "$OUT" in /*) ;; *) OUT="$PWD/$OUT" ;; esac

SHA="$(git -C "$ROOT" rev-parse --verify "$REV^{commit}")"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/src" "$TMP/validator"
git -C "$ROOT" show "$SHA:package.json" > "$TMP/src/package.json"
git -C "$ROOT" show "$SHA:package-lock.json" > "$TMP/src/package-lock.json"

(cd "$TMP/src" && npx --yes "$CDX_NPM" --package-lock-only --omit dev \
  --spec-version 1.6 --output-format JSON --output-reproducible \
  --output-file "$TMP/raw.cdx.json")

npm install --silent --no-audit --no-fund --prefix "$TMP/validator" "$CDX_LIB" "${AJV[@]}" >/dev/null
node - "$TMP/raw.cdx.json" "$OUT" "$SHA" "$TMP/validator" <<'NODE'
const fs = require('node:fs');
const { createRequire } = require('node:module');
const [raw, out, sha, dir] = process.argv.slice(2);
const { Validation } = createRequire(`${dir}/node_modules/`)('@cyclonedx/cyclonedx-library');
const bom = JSON.parse(fs.readFileSync(raw, 'utf8'));
const meta = bom.metadata || {};
const props = (meta.properties || []).filter(p => p.name !== 'webcite:source-commit');
const withSha = { ...bom, metadata: { ...meta, properties: [...props, { name: 'webcite:source-commit', value: sha }] } };
const text = JSON.stringify(withSha, null, 2) + '\n';
const count = list => (list || []).reduce((n, c) => n + 1 + count(c.components), 0);
new Validation.JsonStrictValidator(withSha.specVersion).validate(text).then(errors => {
  if (errors) { console.error('sbom: schema validation FAILED', JSON.stringify(errors, null, 2)); process.exit(1); }
  fs.writeFileSync(out, text);
  console.log(`sbom: ${out} commit=${sha} spec=${withSha.specVersion} components=${count(withSha.components)} schema=valid`);
});
NODE
