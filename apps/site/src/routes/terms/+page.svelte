<svelte:head>
  <title>Terms of Service - Glassmkr</title>
  <!-- These two pages carried a title and nothing else: no description, no
       canonical, no social card. They are the pages a reader opens when they
       are deciding whether to trust us with a machine, and they were the only
       ones on the site a search result could not describe. -->
  <meta name="description" content="The terms covering the Glassmkr hosted dashboard and the Crucible agent, including the licences, what is warranted, and how either side ends the arrangement." />
  <link rel="canonical" href="https://glassmkr.com/terms" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://glassmkr.com/terms" />
  <meta property="og:title" content="Glassmkr Terms of Service" />
  <meta property="og:description" content="The terms covering the Glassmkr hosted dashboard and the Crucible agent, including the licences, what is warranted, and how either side ends the arrangement." />
  <meta property="og:image" content="https://glassmkr.com/og/default.png?v=20260826" />
  <meta property="og:site_name" content="Glassmkr" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Glassmkr Terms of Service" />
  <meta name="twitter:description" content="The terms covering the Glassmkr hosted dashboard and the Crucible agent, including the licences, what is warranted, and how either side ends the arrangement." />
  <meta name="twitter:image" content="https://glassmkr.com/og/default.png?v=20260826" />
</svelte:head>

<div class="container-narrow">
  <h1>Terms of Service</h1>
  <div class="legal-content">
    <p class="last-updated">Last updated: August 24, 2026</p>

    <h2>1. Who We Are</h2>
    <p>Glassmkr is operated by:</p>
    <ul>
      <li><strong>Name:</strong> Simon Rybisar</li>
      <li><strong>ICO:</strong> 03700585</li>
      <li><strong>VAT:</strong> CZ9105283363</li>
      <li><strong>Address:</strong> Korunni 1963/119, Praha, 130 00, Czech Republic</li>
      <li><strong>Email:</strong> <a href="mailto:hello@glassmkr.com">hello@glassmkr.com</a></li>
    </ul>
    <p>References to "we", "us", or "Glassmkr" throughout these Terms refer to the entity above.</p>

    <h2>2. Acceptance of Terms</h2>
    <p>By creating a Dashboard account, using any Glassmkr service, or installing Crucible, you agree to be bound by these Terms of Service. If you do not agree, you must not use our services.</p>
    <p>If you are entering into these Terms on behalf of an organization, you represent that you have the authority to bind that organization. In that case, "you" refers to the organization.</p>

    <h2>3. Service Description</h2>
    <p><strong>Dashboard</strong> is an open-source (AGPL-3.0-only) server health monitoring dashboard, operated as a hosted service at app.glassmkr.com. It receives health data from the Crucible agent running on your servers, stores it, evaluates alert rules, displays results, and provides managed alerting and AI health analysis (Furnace).</p>
    <p><strong>Crucible</strong> is an open-source monitoring agent released under the AGPL-3.0-only license from version 1.1.0 onward; versions 1.0.1 and earlier were released under the MIT license, which continues to govern those versions. You install it on your servers to collect hardware and operating system health data. Crucible can operate standalone or send data to Dashboard.</p>
    <p><strong>Important:</strong> Dashboard and Crucible are monitoring tools that report on server health. They do not prevent failures, do not guarantee detection of all possible issues, and do not replace proper system administration practices, backup procedures, or redundancy planning. Alert thresholds are configurable; opinionated defaults may not be appropriate for all environments.</p>

    <h2>4. Plans and Pricing</h2>
    <p>As of August 2026, Glassmkr has no paid plans and charges nothing:</p>
    <ul>
      <li><strong>Hosted:</strong> Free, with a 10-node per-account cap, 90-day data retention (audit log 365 days), full dashboard access, the full read+write API, all notification channels, predictive trend warnings, and AI analysis. No payment required.</li>
      <li><strong>Self-hosted:</strong> The full stack is open source (Dashboard and Crucible under AGPL-3.0-only) and free to run on your own hardware with no node limits. Self-hosted instances are governed by their software licenses, not by these Terms.</li>
    </ul>
    <p>Should pricing ever be introduced for any part of the hosted service, we will provide at least 30 days' written notice to existing customers before any charge applies.</p>

    <h2>5. Free Service</h2>
    <p>The hosted service requires no payment and no commitment. You may use it indefinitely within its limits (10 nodes per account). No credit card is required to sign up.</p>

    <h2>6. Paid Subscriptions</h2>
    <p>Paid subscriptions were retired in August 2026; no new subscriptions can be created and none remain active. Historical subscriptions were billed monthly through Stripe.</p>
    <p>Historical invoices remain available through the Stripe customer portal accessible from your Dashboard settings.</p>

    <h2>7. Cancellation and Refunds (historical subscriptions)</h2>
    <p>Section 6 states that paid subscriptions were retired in August 2026, that no new subscriptions can be created, and that none remain active. The terms in this section and section 8 applied while paid subscriptions existed and are retained for the historical record; the service itself is free of charge.</p>
    <p>While subscriptions existed: cancellation was available at any time through the Stripe customer portal, took effect at the end of the current billing period, and no partial refunds were provided to business customers for unused portions of a billing period. Consumers' statutory rights under applicable consumer protection law were, and remain, unaffected.</p>

    <h2>8. Consumer Withdrawal Right (EU, historical subscriptions)</h2>
    <p>Consumers within the European Union had the right to withdraw from a distance contract within 14 days of its conclusion, without giving any reason, in accordance with Directive 2011/83/EU. A subscriber who chose to use the service immediately consented to it beginning before the withdrawal period expired, and a withdrawal after commencement was charged pro rata for the period during which the service was provided.</p>
    <p>If you believe you hold an unresolved claim from a historical subscription, send a clear statement to <a href="mailto:hello@glassmkr.com">hello@glassmkr.com</a>. Eligible refunds are processed within 14 days of receiving the notice.</p>

    <h2>9. Service Availability and Modifications</h2>
    <p>We aim to maintain high availability but do not guarantee specific uptime percentages. We will make reasonable efforts to keep the service running and to notify users of planned maintenance.</p>
    <p>We may modify, suspend, or discontinue any part of the service. For material changes that reduce functionality you are currently paying for, we will provide at least 30 days' prior notice via email.</p>
    <p><strong>Consumers:</strong> If a material change adversely affects your use of the service, you have the right to terminate your subscription before the change takes effect and receive a pro-rata refund for any prepaid period you will not use.</p>

    <h2>10. Your Responsibilities</h2>
    <p>You agree to:</p>
    <ul>
      <li>Maintain the security of your account credentials and notify us immediately of any unauthorised access</li>
      <li>Provide accurate information during registration and keep it up to date</li>
      <li>Configure Crucible and alert thresholds appropriately for your environment</li>
      <li>Use the service only for lawful purposes and only to monitor servers you own or are authorised to monitor</li>
      <li>Refrain from attempting to access other customers' data or overloading the service with excessive requests</li>
      <li>Not resell access to the service without our written permission</li>
    </ul>
    <p><strong>Your data stays yours.</strong> You retain full ownership of all data your servers send to Dashboard. We do not claim any intellectual property rights over your server health data. You grant us a limited license to store, process, and display your data solely for the purpose of providing the service, including running AI analysis on your health snapshots.</p>

    <h2>11. Intellectual Property</h2>
    <p>"Glassmkr" and "Dashboard" are trademarks of Simon Rybisar. You may not use these marks without prior written permission, except to refer to our products in a factual, non-misleading manner.</p>
    <p>Dashboard (the dashboard, API, and backend services) is proprietary software. These Terms govern your use of Dashboard. You may not reverse engineer, decompile, or attempt to extract the source code of Dashboard.</p>
    <p>Crucible is released under the AGPL-3.0-only license (v1.0.1 and earlier: MIT). See section 12 below.</p>

    <h2>12. Open Source Components</h2>
    <p>Crucible is released under the AGPL-3.0-only license from version 1.1.0 onward. Versions 1.0.1 and earlier were released under the MIT license, and that license continues to govern those versions; a granted license is not withdrawn. You may use, modify, and distribute Crucible according to the license applicable to the version you hold. These open-source licenses apply independently of these Terms of Service; your rights under them are not restricted by these Terms.</p>
    <p>Dashboard may incorporate third-party open-source libraries. Their respective licenses are included in the Dashboard source distribution or documentation where required.</p>

    <h2>13. Limitation of Liability</h2>
    <p><strong>Business customers:</strong> To the maximum extent permitted by law, our total aggregate liability for any claims arising from or related to the service shall not exceed the total amount you paid us in the 12 months preceding the event giving rise to the claim. We shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits or revenues, whether incurred directly or indirectly.</p>
    <p><strong>Consumers:</strong> Nothing in these Terms limits or excludes liability that cannot be limited or excluded under applicable law. Your statutory rights under EU Directive 2019/770 (on the supply of digital content and digital services) and applicable national consumer protection legislation remain fully preserved.</p>
    <p><strong>All users:</strong></p>
    <ul>
      <li>Dashboard and Crucible do not guarantee detection of all server failures, performance degradation, or security incidents.</li>
      <li>The service is not a substitute for backups, disaster recovery, or redundancy planning.</li>
      <li>AI analysis is generated by a language model and may contain errors. It should be used as one input among many when making operational decisions.</li>
      <li>We are not responsible for actions taken or not taken based on alert notifications or AI analysis.</li>
      <li>We are not liable for service interruptions caused by third-party providers (Cloudflare, Stripe, network operators) beyond our reasonable control.</li>
    </ul>

    <h2>14. Disclaimer</h2>
    <p><strong>Business customers:</strong> The service is provided "as is" and "as available" without warranty of any kind, express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, and non-infringement.</p>
    <p><strong>Consumers:</strong> We will provide the service in conformity with the contract as required by EU Directive 2019/770 and applicable national law. Your statutory conformity rights are not affected by this section.</p>
    <p><strong>AI analysis caveat:</strong> AI health analysis (Furnace) is informational only. It may produce inaccurate, incomplete, or misleading results. You should not rely on AI analysis as the sole basis for operational decisions. Always verify AI recommendations against your own expertise and other monitoring sources.</p>

    <h2>15. Termination</h2>
    <p>We may suspend or terminate your account if you materially breach these Terms. Except in cases of abuse, fraud, or legal obligation, we will provide reasonable notice and an opportunity to remedy the breach before termination.</p>
    <p>You may terminate your account at any time by deleting it in your Dashboard settings. If you have an active paid subscription, cancellation of the subscription through Stripe is separate from account deletion.</p>
    <p>Upon termination, your data will be deleted in accordance with our <a href="/privacy">Privacy Policy</a>. Deletion is permanent and cannot be reversed.</p>

    <h2>16. Governing Law and Jurisdiction</h2>
    <p><strong>Business customers:</strong> These Terms are governed by and construed in accordance with the laws of the Czech Republic. Any disputes shall be resolved exclusively in the courts of Prague, Czech Republic.</p>
    <p><strong>EU consumers:</strong> If you are a consumer habitually resident in an EU member state, you also benefit from any mandatory provisions of the law of your country of residence. Nothing in these Terms deprives you of your right to bring proceedings in the courts of your country of residence, as provided by Regulation (EU) No 1215/2012.</p>

    <h2>17. Dispute Resolution</h2>
    <p>If you have a complaint or dispute, please contact us first at <a href="mailto:hello@glassmkr.com">hello@glassmkr.com</a>. We will make reasonable efforts to resolve the matter informally within 30 days.</p>
    <p><strong>EU Online Dispute Resolution:</strong> The European Commission provides an online dispute resolution platform at <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener noreferrer">https://ec.europa.eu/consumers/odr</a>. You may use this platform to resolve disputes related to online purchases.</p>
    <p><strong>Czech Trade Inspection Authority (COI):</strong> For consumers in the Czech Republic, the out-of-court dispute resolution body is the Czech Trade Inspection Authority: <a href="https://www.coi.cz" target="_blank" rel="noopener noreferrer">https://www.coi.cz</a>.</p>

    <h2>18. Changes to These Terms</h2>
    <p>We may update these Terms from time to time. Material changes will be communicated via email to registered users at least 30 days before taking effect.</p>
    <p>Continued use of the service after the revised Terms take effect constitutes acceptance of the new Terms.</p>
    <p><strong>Consumers:</strong> If you do not agree to material changes, you have the right to terminate your subscription before the changes take effect and receive a pro-rata refund for any prepaid period you will not use.</p>

    <h2>19. Contact</h2>
    <p>For questions about these Terms or the service, you can reach us at:</p>
    <ul>
      <li><strong>Name:</strong> Simon Rybisar</li>
      <li><strong>ICO:</strong> 03700585</li>
      <li><strong>VAT:</strong> CZ9105283363</li>
      <li><strong>Address:</strong> Korunni 1963/119, Praha, 130 00, Czech Republic</li>
      <li><strong>Email:</strong> <a href="mailto:hello@glassmkr.com">hello@glassmkr.com</a></li>
    </ul>
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
</style>
