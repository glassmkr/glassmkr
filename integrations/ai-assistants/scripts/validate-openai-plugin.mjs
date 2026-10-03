#!/usr/bin/env node
//
// Pre-upload check for the OpenAI plugin package in ../openai-plugin.
//
// Why this exists: the portal validates a ZIP in two passes. Upload accepts
// draft-length text (80-char names, 240-char subtitles, 512-char prompts) and
// only final directory submission enforces the public limits (30, 30, 128),
// so a package can upload cleanly and still bounce at "Submit for review".
// With one review active at a time, each bounce costs a round trip. This
// script applies the FINAL-submission rules from the docs (read 2026-10-03):
//   developers.openai.com/plugins/deploy/submission         (field table)
//   developers.openai.com/plugins/deploy/submission-errors  (error codes)
//   developers.openai.com/plugins/plugin-guidelines         (listing copy)
// plus Glassmkr's own copy rules: no em or en dashes, no pricing / plan /
// trial / node-cap language in listing text.
//
// It does not fetch the agent-plugins.org JSON Schema (no network in CI and
// no published copy we could pin); the field rules below are transcribed
// from the docs' tables instead. Error codes reuse the portal's names where
// one exists so a portal finding and a local finding read the same.
//
// Usage: node integrations/ai-assistants/scripts/validate-openai-plugin.mjs

import { readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const AGENT_PLUGIN_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
export const AGENT_MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";
export const EXPECTED_MCP_URL = "https://app.glassmkr.com/api/triage/mcp";
export const TOOL_NAMES = ["analyze_server_output", "get_capture_command", "get_monitoring_setup"];

// submission-errors: plugin_category_unknown lists exactly these.
export const CATEGORIES = [
  "Productivity", "Creativity", "Developer Tools", "Business & Operations",
  "Data & Analytics", "Communication", "Education & Research", "Security",
  "Finance", "Healthcare", "Travel", "Entertainment", "Other",
];

// Listing copy only (not review test cases, whose expected behavior may
// legitimately say "contains no pricing"). plugin-guidelines: "Do not
// advertise pricing, subscriptions, free trials, discounts, or promotions";
// the rest are Glassmkr rules from the spec (no node caps, no "1.2B users",
// no claim of proactive suggestions, which OpenAI alone decides).
const BANNED_LISTING = [
  /\bpric(e|es|ing)\b/i, /\bfree\b/i, /\btrials?\b/i, /\bplans?\b/i,
  /\bsubscri(be|ption|ptions)\b/i, /\bupgrades?\b/i, /\bdiscounts?\b/i,
  /\bpromo(tion|tions)?\b/i, /\bnode (cap|limit)s?\b/i, /\b\d+\s*nodes\b/i,
  /\b1\.2\s*B\b/i, /\bproactive\b/i, /\bofficial\b/i, /\bbest\b/i,
];

// Built from code points so this file itself stays free of the characters
// it hunts for (an editor or tool that decodes \u escapes would otherwise
// write literal dashes into the source).
const cp = (...codes) => String.fromCodePoint(...codes);
const DASHES = new RegExp(`[${cp(0x2013, 0x2014)}]`);
// Control characters other than \n, plus Unicode line / paragraph separators.
const UNSUPPORTED_CHARS = new RegExp(
  `[\u0000-\u0009\u000B-\u001F\u007F${cp(0x2028, 0x2029)}${cp(0x200b)}-${cp(0x200f)}${cp(0x2060, 0xfeff)}]`,
);

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const oneLine = (s) => !s.includes("\n") && !s.includes("\r");

function httpsUrl(s, max) {
  if (typeof s !== "string" || s.length === 0 || s.length > max) return false;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && u.hostname !== "" && u.username === "" && u.password === "";
  } catch {
    return false;
  }
}

// WCAG 2.x relative luminance and contrast ratio; the portal's "2:1 against
// white / #212121" rule uses the same definition.
function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// PNG only: the package ships PNGs, and reading IHDR is enough to check the
// square / 48..4096 / extension-matches-content rules without an image lib.
function pngDims(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 24 || !sig.every((b, i) => buf[i] === b)) return null;
  if (buf.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const normalizePrompt = (s) => s.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

/** Fenced code block bodies in a Markdown document, exactly as written. */
export function codeBlocks(md) {
  const out = [];
  const re = /^```[^\n]*\n([\s\S]*?)\n```[ \t]*$/gm;
  let m;
  while ((m = re.exec(md)) !== null) out.push(m[1]);
  return out;
}

/**
 * @param {{ plugin: unknown, mcp: unknown, root: string, reviewMd?: string }} pkg
 * @returns {Array<{ code: string, message: string }>}
 */
export function validatePackage({ plugin, mcp, root, reviewMd }) {
  const errors = [];
  const err = (code, message) => errors.push({ code, message });

  if (!isObj(plugin)) {
    err("plugin_manifest_root_not_object", "plugin.json must be a JSON object");
    return errors;
  }

  // --- Package identity -----------------------------------------------------
  if (plugin.$schema !== AGENT_PLUGIN_SCHEMA) err("plugin_schema", `$schema must be ${AGENT_PLUGIN_SCHEMA}`);
  const name = plugin.name;
  if (typeof name !== "string" || name.length === 0) err("plugin_name_missing", "name is required");
  else {
    if (name.length > 64) err("plugin_name_too_long", "name must be 64 characters or fewer");
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) err("plugin_name_format", "name must be lowercase kebab-case for submission");
  }
  if (typeof plugin.version !== "string" || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(plugin.version) || plugin.version.length > 64) {
    err("plugin_version_not_semver", "version must be a semantic version such as 1.0.0");
  }
  if (typeof plugin.description !== "string" || plugin.description.trim() === "") err("plugin_description_missing", "description is required");
  else if (plugin.description.length > 1024) err("plugin_description_too_long", `description is ${plugin.description.length} chars; max 1024`);
  const author = plugin.author;
  if (!isObj(author) || typeof author.name !== "string" || author.name.trim() === "") err("plugin_developer_missing", "author.name is required");
  else {
    if (author.name.length > 120) err("plugin_author_name_too_long", "author.name max 120");
    if (author.email !== undefined && (typeof author.email !== "string" || author.email.length === 0 || author.email.length > 320)) err("plugin_author_email_invalid", "author.email must be 1..320 chars");
    if (author.url !== undefined && !httpsUrl(author.url, 2048)) err("plugin_author_url_not_https", "author.url must be an HTTPS URL");
  }
  if (plugin.homepage !== undefined && !httpsUrl(plugin.homepage, 2048)) err("plugin_homepage_format", "homepage must be an HTTPS URL");
  if (plugin.keywords !== undefined) {
    if (!Array.isArray(plugin.keywords) || plugin.keywords.some((k) => typeof k !== "string" || k.trim() === "")) err("plugin_keywords_invalid", "keywords must be non-empty strings");
    else {
      const seen = new Set();
      for (const k of plugin.keywords) {
        const key = k.toLowerCase();
        if (seen.has(key)) err("plugin_keywords_duplicate", `duplicate keyword "${k}"`);
        seen.add(key);
      }
    }
  }
  // submission: "Plugin ZIPs containing app references (apps / .app.json) or
  // lifecycle hooks cannot currently be submitted."
  if ("apps" in plugin || "hooks" in plugin) err("plugin_unsubmittable_component", "apps / hooks cannot be submitted");

  const ext = isObj(plugin.extensions) ? plugin.extensions["com.openai"] : undefined;
  if (!isObj(ext)) {
    err("openai_extension_missing", "extensions.com.openai is required for this package");
    return errors;
  }
  if ("apps" in ext || "hooks" in ext) err("plugin_unsubmittable_component", "extensions.com.openai.apps / hooks cannot be submitted");

  // --- Listing metadata (final-submission limits) ---------------------------
  const ui = ext.interface;
  if (!isObj(ui)) {
    err("plugin_interface_wrong_type", "extensions.com.openai.interface must be an object");
  } else {
    const line = (field, max, code) => {
      const v = ui[field];
      if (typeof v !== "string" || v.trim() === "") return err(`${code}_required`, `${field} is required`);
      if (v.length > max) err(`${code}_too_long`, `${field} is ${v.length} chars; max ${max}`);
      if (!oneLine(v)) err(`${code}_character_unsupported`, `${field} must be one line`);
    };
    line("displayName", 30, "submission_display_name");
    line("shortDescription", 30, "submission_subtitle");
    line("developerName", 80, "submission_developer_name");
    if (typeof ui.displayName === "string" && /\b(mcp|plugin|mcp server)\b/i.test(ui.displayName)) {
      err("display_name_suffix", 'plugin-guidelines: do not append "MCP", "MCP Server" or "Plugin" to the name');
    }
    if (typeof ui.longDescription !== "string" || ui.longDescription.trim() === "") err("submission_description_required", "longDescription is required");
    else if (ui.longDescription.length > 4000) err("submission_description_too_long", `longDescription is ${ui.longDescription.length} chars; max 4000`);
    if (!CATEGORIES.includes(ui.category)) err("plugin_category_unknown", `category "${ui.category}" is not one of: ${CATEGORIES.join(", ")}`);
    if (ui.capabilities !== undefined) {
      if (!Array.isArray(ui.capabilities)) err("plugin_capabilities_wrong_type", "capabilities must be a list");
      else {
        if (ui.capabilities.length > 20) err("plugin_capabilities_too_many", "at most 20 capabilities");
        for (const c of ui.capabilities) {
          if (typeof c !== "string" || c.trim() === "" || c.length > 120 || !oneLine(c)) err("plugin_capability_invalid", `capability must be one line, 1..120 chars: "${c}"`);
        }
      }
    }
    for (const f of ["websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"]) {
      if (!httpsUrl(ui[f], 1024)) err(`plugin_${f}_format`, `${f} must be an HTTPS URL of at most 1024 chars (required for remote MCP review)`);
    }
    const prompts = ui.defaultPrompt === undefined ? [] : Array.isArray(ui.defaultPrompt) ? ui.defaultPrompt : [ui.defaultPrompt];
    if (prompts.length > 3) err("plugin_default_prompt_too_many", "at most three starter prompts");
    const seenPrompts = new Set();
    for (const p of prompts) {
      if (typeof p !== "string" || p.trim() === "") { err("plugin_default_prompt_empty", "starter prompt must be non-empty"); continue; }
      if (p.length > 128) err("plugin_default_prompt_too_long", `starter prompt is ${p.length} chars; max 128: "${p}"`);
      if (!oneLine(p)) err("plugin_default_prompt_character_unsupported", "starter prompt must be one line");
      if (/(^|\s)@\S/.test(p)) err("plugin_default_prompt_mention", "starter prompt must not @mention a server");
      const n = normalizePrompt(p);
      if (seenPrompts.has(n)) err("plugin_default_prompt_duplicate", `duplicate starter prompt: "${p}"`);
      seenPrompts.add(n);
    }
    for (const [f, ground, code] of [["brandColor", "#FFFFFF", "plugin_brand_color"], ["brandColorDark", "#212121", "plugin_brand_color_dark"]]) {
      if (ui[f] === undefined) continue;
      if (typeof ui[f] !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(ui[f])) { err(`${code}_format`, `${f} must be #RRGGBB`); continue; }
      const ratio = contrast(ui[f], ground);
      if (ratio < 2) err(`${code}_contrast`, `${f} ${ui[f]} has ${ratio.toFixed(2)}:1 against ${ground}; needs 2:1`);
    }
    // No custom UI on this server, so no screenshots (submission-errors:
    // screenshots_not_allowed; app-review: "Don't provide screenshots when
    // the plugin has no UI").
    if (ui.screenshots !== undefined) err("screenshots_not_allowed", "screenshots are only allowed for MCP servers with custom UI");
    for (const f of ["logo", "composerIcon", "logoDark", "composerIconDark"]) {
      const v = ui[f];
      if (v === undefined) {
        if (f === "logo") err("plugin_logo_path_missing", "logo is required");
        if (f === "composerIcon") err("plugin_composer_icon_path_missing", "composerIcon is required");
        continue;
      }
      if (typeof v !== "string" || !v.startsWith("./")) { err("branding_asset_path_missing_root_prefix", `${f} must start with ./`); continue; }
      const abs = resolve(root, v);
      if (!abs.startsWith(resolve(root) + sep) || v.split("/").includes("..")) { err("declared_asset_path_unsafe", `${f} must stay inside the plugin`); continue; }
      if (!existsSync(abs) || !statSync(abs).isFile()) { err("declared_asset_file_missing", `${f} file ${v} does not exist`); continue; }
      if (statSync(abs).size > 5 * 1024 * 1024) err("image_file_too_large", `${f} exceeds 5 MiB`);
      if (!/\.png$/i.test(v)) { err("image_format_unchecked", `${f}: this checker only verifies PNG; use a PNG or extend the check`); continue; }
      const dims = pngDims(readFileSync(abs));
      if (!dims) { err("raster_image_extension_content_mismatch", `${f} is not a valid PNG`); continue; }
      if (dims.width !== dims.height) err("raster_image_not_square", `${f} is ${dims.width}x${dims.height}; must be square`);
      if (dims.width < 48) err("raster_image_dimensions_too_small", `${f} must be at least 48x48`);
      if (dims.width > 4096 || dims.height > 4096) err("raster_image_dimensions_too_large", `${f} must be at most 4096x4096`);
    }
  }

  // --- Review and publication -----------------------------------------------
  const review = ext.review;
  const allCases = [];
  if (!isObj(review)) err("review_missing", "extensions.com.openai.review is required for this package");
  else {
    for (const banned of ["test_credentials", "reviewer_instructions"]) {
      if (banned in review) err("review_field_rejected", `${banned} is rejected in ZIP metadata; use the dashboard form`);
    }
    const tc = review.test_cases;
    const pos = isObj(tc) && Array.isArray(tc.positive) ? tc.positive : [];
    const neg = isObj(tc) && Array.isArray(tc.negative) ? tc.negative : [];
    if (pos.length !== 5) err("test_cases_positive_count", `initial MCP review needs exactly 5 positive cases; found ${pos.length}`);
    if (neg.length !== 3) err("test_cases_negative_count", `initial MCP review needs exactly 3 negative cases; found ${neg.length}`);
    pos.forEach((c, i) => {
      if (!isObj(c)) return err("test_case_wrong_type", `positive[${i}] must be an object`);
      if (typeof c.description !== "string" || c.description.trim() === "" || c.description.length > 4000) err("test_case_description", `positive[${i}].description must be 1..4000 chars`);
      if (typeof c.prompt !== "string" || c.prompt.trim() === "") err("test_case_prompt", `positive[${i}].prompt is required`);
      if (typeof c.expected_behavior !== "string" || c.expected_behavior.trim() === "") err("test_case_expected_behavior", `positive[${i}].expected_behavior is required`);
      if (typeof c.tools_triggered !== "string" || c.tools_triggered.trim() === "") err("test_case_tools_triggered", `positive[${i}].tools_triggered is required`);
      else {
        for (const t of c.tools_triggered.split(",").map((s) => s.trim())) {
          if (!TOOL_NAMES.includes(t)) err("test_case_unknown_tool", `positive[${i}] names unknown tool "${t}"`);
        }
      }
      allCases.push(c);
    });
    neg.forEach((c, i) => {
      if (!isObj(c)) return err("test_case_wrong_type", `negative[${i}] must be an object`);
      if (typeof c.description !== "string" || c.description.trim() === "") err("test_case_description", `negative[${i}].description is required`);
      if (typeof c.prompt !== "string" || c.prompt.trim() === "") err("test_case_prompt", `negative[${i}].prompt is required`);
      allCases.push(c);
    });
    if (review.commerce !== undefined && typeof review.commerce !== "boolean") err("review_commerce_wrong_type", "review.commerce must be boolean");
  }
  const pub = ext.publication;
  if (!isObj(pub)) err("publication_missing", "extensions.com.openai.publication is required for this package");
  else {
    if (pub.countries !== undefined && (!Array.isArray(pub.countries) || pub.countries.some((c) => typeof c !== "string" || !/^[A-Z]{2}$/.test(c)))) {
      err("publication_countries_invalid", "countries must be uppercase two-letter codes ([] removes restrictions)");
    }
    if (typeof pub.release_notes !== "string" || pub.release_notes.trim() === "") err("release_notes_required", "release_notes are required for MCP review");
  }

  // --- Text hygiene over every string in the manifest -----------------------
  const walk = (v, path) => {
    if (typeof v === "string") {
      if (DASHES.test(v)) err("text_dash", `${path} contains an em or en dash`);
      if (UNSUPPORTED_CHARS.test(v)) err("text_character_unsupported", `${path} contains a control or invisible character`);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (isObj(v)) for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
  };
  walk(plugin, "");

  // Listing copy: what a directory visitor reads.
  const listing = [
    ["description", plugin.description],
    ["keywords", (plugin.keywords ?? []).join(" | ")],
    ...(isObj(ui) ? ["displayName", "shortDescription", "longDescription"].map((f) => [f, ui[f]]) : []),
    ...(isObj(ui) && Array.isArray(ui.capabilities) ? ui.capabilities.map((c, i) => [`capabilities[${i}]`, c]) : []),
    ...(isObj(ui) ? [].concat(ui.defaultPrompt ?? []).map((p, i) => [`defaultPrompt[${i}]`, p]) : []),
    ["publication.release_notes", isObj(pub) ? pub.release_notes : undefined],
  ];
  for (const [field, text] of listing) {
    if (typeof text !== "string") continue;
    for (const re of BANNED_LISTING) {
      const m = text.match(re);
      if (m) err("listing_copy_banned", `${field} contains "${m[0]}" (no pricing, plan, trial, node-cap or promotional language)`);
    }
  }

  // --- mcp.json -------------------------------------------------------------
  if (!isObj(mcp)) err("mcp_manifest_wrong_type", "mcp.json must be a JSON object");
  else {
    if (mcp.$schema !== AGENT_MCP_SCHEMA) err("mcp_schema", `mcp.json $schema must be ${AGENT_MCP_SCHEMA}`);
    const servers = isObj(mcp.mcpServers) ? Object.entries(mcp.mcpServers) : null;
    if (!servers) err("mcp_servers_missing", "mcp.json needs an mcpServers object");
    // Plugin-level review.test_cases require exactly one server (submission).
    else if (servers.length !== 1) err("mcp_server_count", `exactly one MCP server is required; found ${servers.length}`);
    else {
      const [sname, s] = servers[0];
      if (sname.trim() === "") err("mcp_server_name_empty", "server name must be non-empty");
      if (!isObj(s)) err("mcp_server_wrong_type", "server entry must be an object");
      else {
        if (s.type !== "streamable-http") err("mcp_server_transport", 'server type must be "streamable-http"');
        if (s.url !== EXPECTED_MCP_URL) err("mcp_server_url", `server url must be ${EXPECTED_MCP_URL} (the origin can never change after publication)`);
        // The server is anonymous on purpose. Any credential-shaped key here
        // would be shipped inside a public ZIP.
        for (const k of Object.keys(s)) {
          if (!["type", "url"].includes(k)) err("mcp_server_extra_field", `unexpected key "${k}" in the server entry (no auth, headers or env for this server)`);
        }
      }
    }
  }

  // --- Drift guard: the manifest's review prompts must match the reviewed doc
  if (typeof reviewMd === "string") {
    const blocks = new Set(codeBlocks(reviewMd));
    allCases.forEach((c, i) => {
      if (isObj(c) && typeof c.prompt === "string" && !blocks.has(c.prompt)) {
        err("review_doc_drift", `test case ${i} prompt is not a verbatim code block in REVIEW_TEST_CASES.md`);
      }
    });
  }

  return errors;
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(here, "..", "openai-plugin");
  const plugin = JSON.parse(readFileSync(join(root, "plugin.json"), "utf8"));
  const mcp = JSON.parse(readFileSync(join(root, "mcp.json"), "utf8"));
  const reviewMd = readFileSync(resolve(here, "..", "REVIEW_TEST_CASES.md"), "utf8");
  const errors = validatePackage({ plugin, mcp, root, reviewMd });
  const ui = plugin.extensions?.["com.openai"]?.interface ?? {};
  console.log(`[openai-plugin] ${plugin.name}@${plugin.version}: displayName ${ui.displayName?.length}/30, shortDescription ${ui.shortDescription?.length}/30, longDescription ${ui.longDescription?.length}/4000, description ${plugin.description?.length}/1024`);
  for (const p of [].concat(ui.defaultPrompt ?? [])) console.log(`[openai-plugin] starter prompt ${p.length}/128`);
  if (ui.brandColor) console.log(`[openai-plugin] brandColor ${ui.brandColor} ${contrast(ui.brandColor, "#FFFFFF").toFixed(2)}:1 vs white`);
  if (ui.brandColorDark) console.log(`[openai-plugin] brandColorDark ${ui.brandColorDark} ${contrast(ui.brandColorDark, "#212121").toFixed(2)}:1 vs #212121`);
  if (errors.length === 0) {
    console.log("[openai-plugin] OK: no findings");
    return;
  }
  for (const e of errors) console.error(`[openai-plugin] ${e.code}: ${e.message}`);
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
