#!/usr/bin/env node
// Known-bad fixtures for validate-openai-plugin.mjs. Each mutation is one the
// portal rejects only at final submission (upload accepts it), which is the
// gap this checker exists to close. The good-package case runs last so a
// checker that returns [] for everything cannot pass.
import { readFileSync, mkdtempSync, copyFileSync, mkdirSync, writeFileSync, rmSync, symlinkSync, cpSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { validatePackage, codeBlocks, contrast } from "./validate-openai-plugin.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "openai-plugin");
const reviewMd = readFileSync(resolve(here, "..", "REVIEW_TEST_CASES.md"), "utf8");
const good = JSON.parse(readFileSync(join(root, "plugin.json"), "utf8"));
const goodMcp = JSON.parse(readFileSync(join(root, "mcp.json"), "utf8"));

let bad = 0;
const check = (c, m) => (c ? console.log(`[openai-plugin-test] ok   ${m}`)
  : (bad++, console.error(`[openai-plugin-test] FAIL ${m}`)));

const clone = (v) => JSON.parse(JSON.stringify(v));
const codes = (plugin, mcp = goodMcp, md = reviewMd, r = root) =>
  validatePackage({ plugin, mcp, root: r, reviewMd: md }).map((e) => e.code);
function expectCode(mutate, code, label) {
  const p = clone(good);
  mutate(p, p.extensions["com.openai"].interface, p.extensions["com.openai"]);
  const got = codes(p);
  check(got.includes(code), `${label} -> ${code}${got.includes(code) ? "" : ` (got: ${got.join(", ") || "none"})`}`);
}

// --- Listing limits that upload accepts but final submission rejects --------
expectCode((p, ui) => { ui.displayName = "Glassmkr Server Hardware Triage"; }, "submission_display_name_too_long", "31-char display name");
expectCode((p, ui) => { ui.shortDescription = "Diagnose disk, RAID, GPU faults"; }, "submission_subtitle_too_long", "31-char subtitle");
expectCode((p, ui) => { ui.displayName = "Glassmkr MCP"; }, "display_name_suffix", '"MCP" appended to the name');
expectCode((p, ui) => { ui.category = "Infrastructure"; }, "plugin_category_unknown", "category not in the portal list");
expectCode((p, ui) => { ui.defaultPrompt = [...ui.defaultPrompt, "One more prompt"]; }, "plugin_default_prompt_too_many", "four starter prompts");
expectCode((p, ui) => { ui.defaultPrompt[0] = "x".repeat(129); }, "plugin_default_prompt_too_long", "129-char starter prompt");
expectCode((p, ui) => { ui.defaultPrompt[1] = "Use @glassmkr to check my disks"; }, "plugin_default_prompt_mention", "@mention in a starter prompt");
expectCode((p, ui) => { ui.defaultPrompt[2] = ` ${ui.defaultPrompt[0].toUpperCase()} `; }, "plugin_default_prompt_duplicate", "duplicate prompt after normalization");
expectCode((p, ui) => { ui.defaultPrompt[0] = "line one\nline two"; }, "plugin_default_prompt_character_unsupported", "multi-line starter prompt");
expectCode((p, ui) => { ui.brandColor = "#FFD580"; }, "plugin_brand_color_contrast", "pale brand color on white");
expectCode((p, ui) => { ui.brandColorDark = "#2A2A2A"; }, "plugin_brand_color_dark_contrast", "dark brand color on #212121");
expectCode((p, ui) => { ui.supportURL = "http://glassmkr.com/docs/ai-assistants"; }, "plugin_supportURL_format", "plain-http support URL");
expectCode((p, ui) => { delete ui.privacyPolicyURL; }, "plugin_privacyPolicyURL_format", "missing privacy URL");
expectCode((p, ui) => { ui.screenshots = ["./assets/logo.png"]; }, "screenshots_not_allowed", "screenshots without custom UI");
expectCode((p, ui) => { ui.logo = "./assets/missing.png"; }, "declared_asset_file_missing", "logo file missing");
expectCode((p, ui) => { ui.logo = "assets/logo.png"; }, "branding_asset_path_missing_root_prefix", "logo path without ./");
expectCode((p, ui) => { ui.composerIcon = "./../plugin.json"; }, "declared_asset_path_unsafe", "icon path escaping the package");
expectCode((p) => { p.description = "x".repeat(1025); }, "plugin_description_too_long", "1025-char package description");
expectCode((p) => { p.name = "Glassmkr Triage"; }, "plugin_name_format", "non-kebab package name");
expectCode((p) => { p.version = "1.0"; }, "plugin_version_not_semver", "two-part version");

// --- Copy rules -------------------------------------------------------------
expectCode((p, ui) => { ui.longDescription += " Monitor up to 10 nodes."; }, "listing_copy_banned", "node cap in the long description");
expectCode((p, ui) => { ui.longDescription += " Start a free trial."; }, "listing_copy_banned", "free trial in the long description");
expectCode((p, ui) => { ui.shortDescription = "Pricing for server triage"; }, "listing_copy_banned", "pricing in the subtitle");
expectCode((p, ui) => { ui.longDescription += " Reach 1.2B weekly users."; }, "listing_copy_banned", "1.2B users claim");
expectCode((p, ui) => { ui.longDescription = ui.longDescription.replace("Limitations:", `Limitations ${String.fromCodePoint(0x2014)}`); }, "text_dash", "em-dash in listing copy");
expectCode((p, ui, ext) => { ext.review.test_cases.positive[0].expected_behavior += ` ${String.fromCodePoint(0x2013)} done`; }, "text_dash", "en-dash in a test case");
expectCode((p, ui) => { ui.longDescription += `${String.fromCodePoint(0x2028)}More.`; }, "text_character_unsupported", "Unicode line separator in the long description");
expectCode((p, ui) => { ui.capabilities[0] += "\tx"; }, "text_character_unsupported", "tab in a capability");

// --- Review materials -------------------------------------------------------
expectCode((p, ui, ext) => { ext.review.test_cases.positive.pop(); }, "test_cases_positive_count", "four positive cases");
expectCode((p, ui, ext) => { ext.review.test_cases.negative.push({ description: "x", prompt: "y" }); }, "test_cases_negative_count", "four negative cases");
expectCode((p, ui, ext) => { ext.review.test_cases.positive[0].tools_triggered = "analyze_output"; }, "test_case_unknown_tool", "misspelled tool name");
expectCode((p, ui, ext) => { delete ext.review.test_cases.positive[1].expected_behavior; }, "test_case_expected_behavior", "positive case without expected behavior");
expectCode((p, ui, ext) => { ext.review.test_credentials = { user: "x" }; }, "review_field_rejected", "credentials inside the ZIP");
expectCode((p, ui, ext) => { ext.publication.countries = ["us"]; }, "publication_countries_invalid", "lowercase country code");
expectCode((p, ui, ext) => { ext.publication.release_notes = ""; }, "release_notes_required", "empty release notes");
expectCode((p, ui, ext) => { ext.apps = "./.app.json"; }, "plugin_unsubmittable_component", "app reference in the package");
expectCode((p, ui, ext) => { ext.review.test_cases.positive[2].prompt += "\n"; }, "review_doc_drift", "manifest prompt differs from REVIEW_TEST_CASES.md");

// --- mcp.json ---------------------------------------------------------------
{
  const m = clone(goodMcp);
  m.mcpServers["glassmkr-triage"].url = "https://triage.glassmkr.com/mcp";
  check(codes(good, m).includes("mcp_server_url"), "wrong MCP origin -> mcp_server_url");
}
{
  const m = clone(goodMcp);
  m.mcpServers["glassmkr-triage"].headers = { Authorization: "Bearer $KEY" };
  check(codes(good, m).includes("mcp_server_extra_field"), "auth header in mcp.json -> mcp_server_extra_field");
}
{
  const m = clone(goodMcp);
  m.mcpServers.second = { type: "streamable-http", url: "https://app.glassmkr.com/mcp" };
  check(codes(good, m).includes("mcp_server_count"), "two MCP servers -> mcp_server_count");
}

// --- Images: a non-square PNG must fail -------------------------------------
{
  const dir = mkdtempSync(join(tmpdir(), "gm-plugin-"));
  mkdirSync(join(dir, "assets"));
  copyFileSync(join(root, "assets", "icon.png"), join(dir, "assets", "icon.png"));
  // Minimal 64x32 PNG header: IHDR is all the checker reads.
  const hdr = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(hdr, 0);
  hdr.writeUInt32BE(13, 8); hdr.write("IHDR", 12, "ascii"); hdr.writeUInt32BE(64, 16); hdr.writeUInt32BE(32, 20);
  writeFileSync(join(dir, "assets", "logo.png"), hdr);
  check(codes(good, goodMcp, reviewMd, dir).includes("raster_image_not_square"), "64x32 logo -> raster_image_not_square");
  writeFileSync(join(dir, "assets", "logo.png"), "<svg/>");
  check(codes(good, goodMcp, reviewMd, dir).includes("raster_image_extension_content_mismatch"), "SVG bytes in a .png -> raster_image_extension_content_mismatch");
  rmSync(dir, { recursive: true, force: true });
}

// --- Helpers ----------------------------------------------------------------
check(Math.abs(contrast("#FFFFFF", "#000000") - 21) < 1e-9, "contrast(white, black) is 21:1");
check(codeBlocks("a\n```\nx\ny\n```\nb\n```text\nz\n```\n").join("|") === "x\ny|z", "codeBlocks returns fenced bodies verbatim");

// --- Run through a symlinked path, the way a checkout under /tmp or a linked
// ~/code is reached: the entry guard compared a realpath with argv[1] as typed,
// so the validator printed nothing and exited 0 and the build script zipped a
// package it never checked (R3-22). -------------------------------------------
{
  const dir = mkdtempSync(join(tmpdir(), "gm-plugin-link-"));
  const pkg = join(dir, "real");
  mkdirSync(pkg);
  cpSync(resolve(here, ".."), pkg, { recursive: true, filter: (src) => !/[\\/]dist(?:[\\/]|$)/.test(src) });
  const badPlugin = clone(good);
  badPlugin.extensions["com.openai"].interface.displayName = "Glassmkr Server Hardware Triage";
  writeFileSync(join(pkg, "openai-plugin", "plugin.json"), JSON.stringify(badPlugin, null, 2));
  symlinkSync(pkg, join(dir, "link"), "dir");
  const run = spawnSync(process.execPath, [join(dir, "link", "scripts", "validate-openai-plugin.mjs")], { encoding: "utf8" });
  check(run.status === 1 && /submission_display_name_too_long/.test(run.stderr), `known-bad package run through a symlink exits 1 (got ${run.status})`);
  rmSync(dir, { recursive: true, force: true });
}

// --- The real package passes -------------------------------------------------
{
  const errors = validatePackage({ plugin: good, mcp: goodMcp, root, reviewMd });
  check(errors.length === 0, `shipped package has no findings${errors.length ? `: ${errors.map((e) => `${e.code} (${e.message})`).join("; ")}` : ""}`);
}

if (bad > 0) {
  console.error(`[openai-plugin-test] ${bad} check(s) failed`);
  process.exit(1);
}
console.log("[openai-plugin-test] all checks passed");
