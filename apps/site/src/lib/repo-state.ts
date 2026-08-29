// Whether the dashboard monorepo is publicly readable yet.
//
// The flip deploys the site BEFORE making the repository public, on purpose:
// the installer gate can only pass once the site serves the new install.sh, and
// nothing should go public while that gate is red. The consequence is a window
// where glassmkr.com documents `git clone https://github.com/glassmkr/glassmkr`
// and that URL answers 404, so anyone following the self-hosting guide fails at
// the first line.
//
// This flag makes that window visible rather than silent. While it is false the
// self-hosting guide says the repository publishes shortly and points at the
// agent repository, which is public today. Flip it to true in the same change
// that makes the repository public.
//
// scripts/check-rendered.mjs fetches the URL below and fails if reality and this
// flag disagree in EITHER direction, so a forgotten flip is caught by the same
// suite that runs against the live site.
export const DASHBOARD_REPO_PUBLIC = false;

export const DASHBOARD_REPO_URL = "https://github.com/glassmkr/glassmkr";
export const AGENT_REPO_URL = "https://github.com/glassmkr/crucible";
