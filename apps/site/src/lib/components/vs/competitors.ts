// Authoritative competitor list for the /vs comparison cluster.
//
// Single source of truth, read by both the ComparisonFooter cross-link
// block (rendered on each /vs/<slug> page) and the /vs hub index page.
// Adding or removing a competitor is a one-line change here, and it
// flows to the per-page footer, the hub, and (via the hub) the sitemap.
//
// `category` is a neutral one-line descriptor of what each tool is,
// shown on the hub cards. It is a category statement, not a comparison
// claim, so it stays accurate without per-release maintenance.

export type Competitor = {
  slug: string;
  /** One line on where the other tool is strongest. Taken from that comparison
   *  page's own reviewed description rather than written fresh here, so the
   *  index cannot make a claim the page it links to does not support. */
  strength?: string;
  label: string;
  category: string;
};

export const COMPETITORS: Competitor[] = [
  { slug: "datadog", label: "Datadog", category: "Full-platform observability SaaS" , strength: "Breadth across APM, logs and traces, if you can carry per-host per-product pricing"},
  { slug: "prometheus", label: "Prometheus", category: "Open-source metrics and alerting" , strength: "Metrics and alerting you assemble yourself, with an ecosystem to match"},
  { slug: "netdata", label: "Netdata", category: "Real-time per-second monitoring" , strength: "Per-second resolution, when you need to see inside a one-minute spike"},
  { slug: "checkmk", label: "Checkmk", category: "Infrastructure and network monitoring" , strength: "Broad infrastructure and network coverage with a long agent catalog"},
  { slug: "zabbix", label: "Zabbix", category: "Open-source enterprise monitoring" , strength: "Enterprise breadth and templating, if you have someone to run it"},
  { slug: "librenms", label: "LibreNMS", category: "SNMP network monitoring" , strength: "Network devices first, over SNMP, which is not what Glassmkr does"},
  { slug: "collectd", label: "collectd", category: "System statistics collection daemon" , strength: "Collection breadth: it reads more distinct things than we do"},
  { slug: "cloudwatch", label: "AWS CloudWatch", category: "AWS-native metrics and logs" , strength: "Deep AWS service integration, though no hardware-level signals"},
  { slug: "newrelic", label: "New Relic", category: "Full-platform observability SaaS" , strength: "Data-ingest and user-based APM with 780 plus integrations"},
];
