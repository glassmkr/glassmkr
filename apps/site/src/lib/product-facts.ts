// Configured product facts for site copy. The canonical fact-to-source map is
// ground-truth.yaml at the monorepo root; this module is the one place site
// components read configured (non-generated) values from, so a change lands
// everywhere at once. Never hand-copy these values into templates.
import facts from "$lib/data/product-facts.json";

export const HOSTED_NODE_CAP: number = facts.hostedNodeCap;
export const CRUCIBLE_LICENSE: string = facts.crucibleLicense;
export const DASHBOARD_LICENSE_LABEL: string = facts.dashboardLicenseLabel;
