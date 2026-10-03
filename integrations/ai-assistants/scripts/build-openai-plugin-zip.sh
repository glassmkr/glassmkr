#!/usr/bin/env bash
# Build the ZIP uploaded at platform.openai.com/plugins ("Upload plugin").
#
# The archive root holds plugin.json, mcp.json and assets/ directly: the portal
# accepts exactly one plugin root, at the archive root or in one top-level
# directory, with no sibling files (submission-errors: plugin_root_ambiguous,
# plugin_root_has_siblings). Only the files the package needs go in, so a
# stray .DS_Store or editor backup can never ride along into a public listing.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pkg="$here/../openai-plugin"
dist="$here/../dist"

node "$here/validate-openai-plugin.mjs"

version="$(node -p "require('$pkg/plugin.json').version")"
name="$(node -p "require('$pkg/plugin.json').name")"
out="$dist/${name}-openai-plugin-${version}.zip"

mkdir -p "$dist"
rm -f "$out"
(cd "$pkg" && zip -X -q -r "$out" plugin.json mcp.json assets/logo.png assets/icon.png)
unzip -l "$out"
echo "Built $out"
