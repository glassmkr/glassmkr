<svelte:head>
  <title>Privacy Policy - Glassmkr</title>
  <!-- These two pages carried a title and nothing else: no description, no
       canonical, no social card. They are the pages a reader opens when they
       are deciding whether to trust us with a machine, and they were the only
       ones on the site a search result could not describe. -->
  <meta name="description" content="What Glassmkr collects, why, how long it is kept, and the rights you have over it. Written against the GDPR and Czech Act No. 110/2019 Sb." />
  <link rel="canonical" href="https://glassmkr.com/privacy" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://glassmkr.com/privacy" />
  <meta property="og:title" content="Glassmkr Privacy Policy" />
  <meta property="og:description" content="What Glassmkr collects, why, how long it is kept, and the rights you have over it. Written against the GDPR and Czech Act No. 110/2019 Sb." />
  <meta property="og:image" content="https://glassmkr.com/og/default.png?v=20260830" />
  <meta property="og:site_name" content="Glassmkr" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Glassmkr Privacy Policy" />
  <meta name="twitter:description" content="What Glassmkr collects, why, how long it is kept, and the rights you have over it. Written against the GDPR and Czech Act No. 110/2019 Sb." />
  <meta name="twitter:image" content="https://glassmkr.com/og/default.png?v=20260830" />
</svelte:head>

<div class="container-narrow">
  <h1>Privacy Policy</h1>
  <div class="legal-content">
    <p class="last-updated">Last updated: August 24, 2026</p>

    <p>This Privacy Policy explains how Glassmkr ("we", "us", "our") collects, uses, and protects personal data when you use app.glassmkr.com (Dashboard), the Crucible monitoring agent, and related services. This policy is written in accordance with the General Data Protection Regulation (EU) 2016/679 ("GDPR") and the Czech Act No. 110/2019 Sb. on Personal Data Processing.</p>

    <h2>1. Who We Are (Controller)</h2>

    <p>The data controller responsible for your personal data is:</p>
    <ul>
      <li><strong>Name:</strong> Simon Rybisar (IČO 03700585)</li>
      <li><strong>Address:</strong> Korunni 1963/119, Praha, 130 00, Czech Republic</li>
      <li><strong>Email:</strong> <a href="mailto:privacy@glassmkr.com">privacy@glassmkr.com</a></li>
    </ul>

    <p>We are not required to appoint a Data Protection Officer under Article 37 of the GDPR. Our core activity is infrastructure monitoring, which does not constitute large-scale monitoring of individuals, nor do we process special categories of personal data on a large scale.</p>

    <h2>2. What Data We Collect</h2>

    <p><strong>Account data.</strong> When you create a Dashboard account, we collect your email address, a hashed password (bcrypt), and, if you use OAuth login, an OAuth provider identifier. We never store your password in plain text.</p>

    <p><strong>Server monitoring data.</strong> When you install Crucible and connect it to Dashboard, the agent sends periodic health snapshots. This data includes:</p>
    <ul>
      <li>CPU metrics: aggregate utilization, per-core utilization, load averages</li>
      <li>Memory metrics: RAM usage, swap usage, allocation breakdowns</li>
      <li>Disk metrics: space usage per mount point, inode usage, mount options, I/O rates, latency</li>
      <li>Storage health: SMART attributes, NVMe wear indicators</li>
      <li>IPMI/BMC data: sensor readings (temperatures, fan speeds, voltages), System Event Log entries, ECC error counts, PSU status</li>
      <li>Network metrics: interface traffic, error counts, link speed, connection states</li>
      <li>RAID status: array health, component drives, rebuild progress</li>
      <li>Security posture: firewall status, open ports, failed login attempts, unattended upgrades status</li>
      <li>System information: hostname, OS, kernel version, uptime</li>
    </ul>
    <p>This data describes your server hardware and operating system. It does not include file contents, application data, database contents, user data stored on your servers, network traffic payloads, or any data processed by applications running on your servers.</p>

    <p><strong>Billing data.</strong> Glassmkr no longer offers paid plans (retired August 2026). For accounts that previously had one, payment was processed by Stripe. We store only your Stripe customer ID and subscription status. We do not store credit card numbers, CVVs, or full card details. Stripe's own privacy policy governs their handling of your payment information: <a href="https://stripe.com/privacy">stripe.com/privacy</a>.</p>

    <p><strong>Notification channel data.</strong> If you configure alert channels, we store the configuration you provide: Telegram chat IDs, email addresses, or Slack webhook URLs. These are used solely to deliver alerts you have configured.</p>

    <p><strong>Technical logs.</strong> We log API requests (endpoint, timestamp, response status, IP address) for security monitoring and incident response. We do not log request bodies beyond what is necessary for the service to function.</p>

    <h2>3. How We Use Your Data</h2>

    <div class="table-scroll" tabindex="0" role="region" aria-label="privacy table, scrolls horizontally"><table>
      <thead>
        <tr>
          <th>Purpose</th>
          <th>Legal Basis</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Providing the monitoring service (dashboards, data storage, API access)</td>
          <td>Art. 6(1)(b) GDPR: performance of a contract</td>
        </tr>
        <tr>
          <td>Processing historical payments and subscriptions (paid plans were retired in August 2026)</td>
          <td>Art. 6(1)(b) GDPR: performance of a contract</td>
        </tr>
        <tr>
          <td>Evaluating alert rules and sending notifications</td>
          <td>Art. 6(1)(b) GDPR: performance of a contract</td>
        </tr>
        <tr>
          <td>AI health analysis (via Furnace, self-hosted on our infrastructure in Amsterdam)</td>
          <td>Art. 6(1)(b) GDPR: performance of a contract</td>
        </tr>
        <tr>
          <td>Security monitoring, incident detection, and abuse prevention</td>
          <td>Art. 6(1)(f) GDPR: legitimate interest in maintaining service security</td>
        </tr>
        <tr>
          <td>Retaining invoices and billing records for Czech tax obligations</td>
          <td>Art. 6(1)(c) GDPR: compliance with a legal obligation</td>
        </tr>
      </tbody>
    </table></div>

    <p><strong>AI processing.</strong> Health snapshots may be analyzed by a self-hosted Gemma 4 model running on our own infrastructure in Amsterdam. This processing happens entirely on our servers. No data is sent to third-party AI providers (OpenAI, Google, Anthropic, or others).</p>

    <p><strong>Machine learning processing for trend warnings.</strong> Glassmkr uses machine learning models to generate trend warnings from your server's historical monitoring metrics. These models run on Glassmkr-owned infrastructure in the European Union. We do not transmit your monitoring data to external AI providers (such as OpenAI, Anthropic, or Google Cloud AI services). The models used are: (a) a tree-based classifier trained on Backblaze's publicly released drive failure dataset, which evaluates per-drive SMART attributes to estimate failure risk, and (b) a large language model (Gemma 4) that generates plain-English descriptions of warnings already identified by our deterministic detection rules. Neither model is trained on your private data; the tree classifier is retrained quarterly on Backblaze's updated public dataset only. Drive model identifiers (for example "ST12000NM0007") are used to match against this public failure-rate lookup table; those identifiers are manufacturer-public information, not customer-identifying data.</p>

    <p><strong>Trend warning feedback.</strong> If you mark a trend warning as "valuable" or "false positive", we store that feedback against the warning record and use it in aggregate to calibrate future warnings for your account.</p>

    <p>We do not sell your data. We do not use your data for advertising. We do not share your server data with other customers.</p>

    <h2>4. Subprocessors and Third Parties</h2>

    <div class="table-scroll" tabindex="0" role="region" aria-label="privacy table, scrolls horizontally"><table>
      <thead>
        <tr>
          <th>Subprocessor</th>
          <th>Purpose</th>
          <th>Location</th>
          <th>Transfer Safeguard</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Stripe</td>
          <td>Historical payment processing (paid plans were retired in August 2026)</td>
          <td>United States</td>
          <td>EU-US DPF + SCCs</td>
        </tr>
        <tr>
          <td>Cloudflare</td>
          <td>DNS, CDN, DDoS protection</td>
          <td>United States</td>
          <td>EU-US DPF + SCCs</td>
        </tr>
        <tr>
          <td>Telegram</td>
          <td>Alert delivery (if configured by you)</td>
          <td>Various</td>
          <td>User-initiated transfer</td>
        </tr>
        <tr>
          <td>Slack</td>
          <td>Alert delivery (if configured by you)</td>
          <td>United States</td>
          <td>EU-US DPF + SCCs</td>
        </tr>
      </tbody>
    </table></div>

    <p>Telegram and Slack only receive data when you actively configure them as notification channels. We do not sell data to any third party. We do not use any analytics, tracking, or advertising services.</p>

    <h2>5. International Data Transfers</h2>

    <p>All primary data (account data, monitoring snapshots, AI analysis results) is stored on dedicated servers in Amsterdam, Netherlands, within the European Union.</p>

    <p>Certain subprocessors are based in the United States. These transfers are covered by the European Commission's adequacy decision for the EU-US Data Privacy Framework (DPF), adopted on 10 July 2023. As an additional safeguard, we maintain Standard Contractual Clauses (SCCs) with each US-based subprocessor.</p>

    <h2>6. Data Retention</h2>

    <div class="table-scroll" tabindex="0" role="region" aria-label="privacy table, scrolls horizontally"><table>
      <thead>
        <tr>
          <th>Data Category</th>
          <th>Retention Period</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Monitoring snapshots</td>
          <td>90 days</td>
        </tr>
        <tr>
          <td>Alert history</td>
          <td>1 year</td>
        </tr>
        <tr>
          <td>AI analysis reports</td>
          <td>Duration of your account</td>
        </tr>
        <tr>
          <td>Account data</td>
          <td>Duration of your account + 30 days after deletion</td>
        </tr>
        <tr>
          <td>Billing records</td>
          <td>10 years (Czech legal requirement, Act No. 563/1991 Sb.)</td>
        </tr>
        <tr>
          <td>Security logs</td>
          <td>12 months</td>
        </tr>
      </tbody>
    </table></div>

    <p>Retention periods are enforced automatically. When you delete a server from Dashboard, all associated snapshots, alerts, and analyses are permanently deleted. When you delete your account, all your data is permanently deleted after the 30-day grace period, except billing records retained under legal obligation.</p>

    <h2>7. Your Rights</h2>

    <p>Under the GDPR, you have the following rights regarding your personal data:</p>
    <ul>
      <li><strong>Right of access</strong> (Art. 15): obtain confirmation of whether we process your data and request a copy.</li>
      <li><strong>Right to rectification</strong> (Art. 16): correct inaccurate personal data we hold about you.</li>
      <li><strong>Right to erasure</strong> (Art. 17): request deletion of your personal data when it is no longer necessary for its original purpose.</li>
      <li><strong>Right to restriction of processing</strong> (Art. 18): request that we limit how we use your data in certain circumstances.</li>
      <li><strong>Right to data portability</strong> (Art. 20): receive your data in a structured, commonly used, machine-readable format.</li>
      <li><strong>Right to object</strong> (Art. 21): object to processing based on legitimate interests. For security logs processed under Art. 6(1)(f), you may object at any time.</li>
      <li><strong>Right to withdraw consent</strong> (Art. 7(3)): where processing is based on consent, withdraw it at any time without affecting the lawfulness of prior processing.</li>
    </ul>

    <p>To exercise any of these rights, email <a href="mailto:privacy@glassmkr.com">privacy@glassmkr.com</a>. We will respond within 30 days. You may also export your data at any time via the Dashboard API or dashboard.</p>

    <p><strong>Supervisory authority.</strong> You have the right to lodge a complaint with the Czech Data Protection Authority:</p>
    <ul>
      <li><strong>Name:</strong> Urad pro ochranu osobnich udaju (UOOU)</li>
      <li><strong>Address:</strong> Pplk. Sochora 27, 170 00 Praha 7, Czech Republic</li>
      <li><strong>Email:</strong> <a href="mailto:posta@uoou.cz">posta@uoou.cz</a></li>
      <li><strong>Website:</strong> <a href="https://www.uoou.cz">uoou.cz</a></li>
    </ul>

    <h2>8. Cookies</h2>

    <div class="table-scroll" tabindex="0" role="region" aria-label="privacy table, scrolls horizontally"><table>
      <thead>
        <tr>
          <th>Cookie Name</th>
          <th>Purpose</th>
          <th>Type</th>
          <th>Duration</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><code>guardian_token</code></td>
          <td>Authentication (maintains your login session)</td>
          <td>Strictly necessary / functional</td>
          <td>Session</td>
        </tr>
      </tbody>
    </table></div>

    <p>This cookie is HttpOnly, Secure, and SameSite=Lax. It is scoped to the domain .glassmkr.com. We do not use analytics cookies, tracking cookies, or advertising cookies. We do not use Google Analytics or similar tracking services.</p>

    <p>Under the ePrivacy Directive (2002/58/EC, Art. 5(3)), strictly necessary cookies do not require user consent. Because our only cookie is essential for authentication, no cookie consent banner is required.</p>

    <h2>9. Children</h2>

    <p>Glassmkr is a server monitoring service intended for system administrators and IT professionals. Our services are not directed at individuals under 16 years of age. We do not knowingly collect personal data from children. If you believe a child under 16 has provided us with personal data, please contact us at <a href="mailto:privacy@glassmkr.com">privacy@glassmkr.com</a> and we will delete that data promptly.</p>

    <h2>10. Changes to This Policy</h2>

    <p>We may update this Privacy Policy from time to time to reflect changes in our practices or legal requirements. The "Last updated" date at the top of this page indicates when the policy was last revised.</p>

    <p>For material changes that affect how we process your data or reduce your rights, we will notify you by email at the address associated with your Dashboard account at least 14 days before the changes take effect.</p>

    <h2>11. Contact and Complaints</h2>

    <p>For any privacy-related questions, requests, or complaints, contact us at:</p>
    <ul>
      <li><strong>Controller:</strong> Simon Rybisar, IČO 03700585</li>
      <li><strong>Address:</strong> Korunni 1963/119, Praha, 130 00, Czech Republic</li>
      <li><strong>Email:</strong> <a href="mailto:privacy@glassmkr.com">privacy@glassmkr.com</a></li>
    </ul>

    <p>If you are not satisfied with our response, you have the right to lodge a complaint with the Czech supervisory authority, the Urad pro ochranu osobnich udaju (UOOU), at Pplk. Sochora 27, 170 00 Praha 7, Czech Republic; email: <a href="mailto:posta@uoou.cz">posta@uoou.cz</a>; website: <a href="https://www.uoou.cz">uoou.cz</a>.</p>
  </div>
</div>

<style>
  .container-narrow {
    position: relative;
    z-index: 1;
    max-width: 780px;
    margin: 0 auto;
    padding: 40px 24px 80px;
  }

  h1 {
    font-size: 28px;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 8px;
  }

  .legal-content :global(h2) {
    font-size: 14px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-primary);
    margin-top: 40px;
    margin-bottom: 16px;
  }

  .legal-content :global(p) {
    font-size: 14px;
    color: var(--text-secondary);
    line-height: 1.7;
    margin-bottom: 12px;
  }

  .legal-content :global(ul) {
    font-size: 14px;
    color: var(--text-secondary);
    line-height: 1.7;
    margin-bottom: 12px;
    padding-left: 24px;
  }

  .legal-content :global(li) { margin-bottom: 4px; }

  .legal-content :global(a) {
    color: var(--accent);
    text-decoration: none;
  }

  .legal-content :global(a:hover) { text-decoration: underline; }

  .last-updated {
    font-size: 13px;
    color: var(--text-tertiary);
    margin-bottom: 32px;
  }

  .legal-content :global(table) {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    color: var(--text-secondary);
    margin-bottom: 16px;
  }

  .legal-content :global(th) {
    text-align: left;
    font-weight: 600;
    color: var(--text-primary);
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    font-size: 13px;
  }

  .legal-content :global(td) {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    line-height: 1.6;
  }

  .legal-content :global(code) {
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 12px;
    background: var(--surface-raised, rgba(255,255,255,0.05));
    padding: 2px 6px;
    border-radius: var(--radius-sm);
  }
</style>
