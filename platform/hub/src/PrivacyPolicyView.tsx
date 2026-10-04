/**
 * Privacy, Security & Research Ethics Policy View
 * Comprehensive policy covering demonstration guardrails, local-first client storage,
 * Canadian & international privacy statutes (PIPEDA, Law 25, GDPR, CCPA), and research ethics (TCPS 2).
 */
import { ArrowLeft, Building, CheckCircle2, Cpu, Database, EyeOff, FileText, Lock, Mail, Scale, ShieldCheck } from 'lucide-react';

interface PrivacyPolicyViewProps {
  onBack: () => void;
}

export function PrivacyPolicyView({ onBack }: PrivacyPolicyViewProps) {
  return (
    <div className="privacy-policy-view">
      <header className="privacy-policy-header">
        <div className="privacy-policy-header__inner">
          <button
            type="button"
            className="btn btn--subtle btn--back"
            onClick={onBack}
            aria-label="Back to Platform Hub"
          >
            <ArrowLeft size={16} /> Back to Hub
          </button>
          <div className="privacy-policy-header__title-block">
            <div className="privacy-badge">
              <ShieldCheck size={16} /> Institutional Standards &amp; Regulatory Compliance
            </div>
            <h1>Privacy, Security &amp; Research Ethics Policy</h1>
            <p className="privacy-meta">
              Effective Date: October 2026 · Platform Version: 1.0 (Public Demonstration) · Maintainer: Peji (
              <a href="mailto:contact@peji.ca">contact@peji.ca</a>)
            </p>
          </div>
        </div>
      </header>

      <main className="privacy-policy-main">
        <div className="privacy-policy-layout">
          {/* Quick Table of Contents Navigation */}
          <aside className="privacy-toc" aria-label="Policy Table of Contents">
            <div className="privacy-toc__card">
              <h3>Policy Navigation</h3>
              <ul>
                <li><a href="#scope">1. Demonstration Scope &amp; Guardrails</a></li>
                <li><a href="#local-first">2. Local-First Client Architecture</a></li>
                <li><a href="#statutory">3. Statutory &amp; Regulatory Compliance</a></li>
                <li><a href="#ethics">4. Research Ethics &amp; TCPS 2 Standards</a></li>
                <li><a href="#sensors">5. Sensors &amp; Paradata Governance</a></li>
                <li><a href="#telemetry">6. Infrastructure &amp; Zero Tracking</a></li>
                <li><a href="#enterprise">7. Dedicated Enterprise Deployments</a></li>
                <li><a href="#contact">8. Privacy Officer Contact</a></li>
              </ul>
            </div>
          </aside>

          {/* Main Policy Content */}
          <div className="privacy-content">
            {/* Executive Summary Card */}
            <div className="privacy-summary-card">
              <div className="privacy-summary-card__header">
                <Lock size={20} className="text-primary" />
                <h2>Executive Privacy &amp; Data Safeguard Summary</h2>
              </div>
              <ul className="privacy-summary-points">
                <li>
                  <CheckCircle2 size={16} className="text-success" />
                  <span><strong>Zero Cloud Leakage of User Surveys:</strong> Questionnaires authored in Designer or Collector reside strictly inside your browser's local sandbox (<code>localStorage</code>). They are never saved to our databases.</span>
                </li>
                <li>
                  <CheckCircle2 size={16} className="text-success" />
                  <span><strong>Public Collection Guardrail:</strong> Live multi-respondent cloud data collection is restricted in this public demo to protect public respondents and maintain institutional ethics standards.</span>
                </li>
                <li>
                  <CheckCircle2 size={16} className="text-success" />
                  <span><strong>Full Canadian &amp; Global Compliance:</strong> Architected to adhere to PIPEDA, Quebec Law 25, TCPS 2, EU GDPR, and CCPA standards.</span>
                </li>
                <li>
                  <CheckCircle2 size={16} className="text-success" />
                  <span><strong>Client-Side Hardware Protection:</strong> Location and photo collection require affirmative respondent consent; photo EXIF metadata is stripped in memory before any attachment handling.</span>
                </li>
              </ul>
            </div>

            {/* Section 1 */}
            <section id="scope" className="privacy-section">
              <div className="privacy-section__icon-header">
                <FileText size={22} className="privacy-section__icon" />
                <h2>1. Demonstration Scope &amp; Operational Guardrails</h2>
              </div>
              <p>
                The Modular Survey Tools platform (<code>msurvey.peji.ca</code>) is an open-source evaluation environment showcasing modern survey methodology, DDI-Lifecycle 3.3 standards, complex skip-logic routing, and the Statistics Canada metadata knowledge graph.
              </p>
              <div className="privacy-callout privacy-callout--important">
                <strong>Public Demonstration Guardrail:</strong>
                <p>
                  To prevent unauthorized data harvesting, phishing, or unmonitored human-subjects research, this public sandbox <strong>does not permit arbitrary public multi-respondent data collection to cloud servers</strong>. When creating or customizing a questionnaire, authors are provided with an interactive browser sandbox to test skip patterns and logic. If you require live production data collection for your organization, please contact us for a dedicated deployment.
                </p>
              </div>
            </section>

            {/* Section 2 */}
            <section id="local-first" className="privacy-section">
              <div className="privacy-section__icon-header">
                <Database size={22} className="privacy-section__icon" />
                <h2>2. Local-First Client Architecture (Zero Cloud Storage)</h2>
              </div>
              <p>
                We believe that survey instruments and research questions contain sensitive proprietary and academic intellectual property. Therefore, our authoring and analysis tools operate on a strict <strong>local-first paradigm</strong>:
              </p>
              <div className="privacy-grid">
                <div className="privacy-card">
                  <h4>Questionnaire Workspace</h4>
                  <p>
                    Every survey created or modified in Designer or Collector is serialized directly to your browser's <code>localStorage</code> under <code>mobilesurvey_local_surveys_v1</code>. No draft questions, category labels, or routing scripts are ever transmitted to our servers.
                  </p>
                </div>
                <div className="privacy-card">
                  <h4>Searcher Data Cart</h4>
                  <p>
                    Variables, questions, and concept mappings bookmarked in the Statistics Canada Searcher reside exclusively on your machine in <code>mobilesurvey_data_cart_v1</code>. Your research queries and cart selections remain completely confidential.
                  </p>
                </div>
                <div className="privacy-card">
                  <h4>Full Portability &amp; Erasure</h4>
                  <p>
                    You retain total ownership of your work. You can export complete survey definitions as standardized JSON at any time. Clearing your browser cookies and site data immediately purges all stored surveys from your device.
                  </p>
                </div>
                <div className="privacy-card">
                  <h4>Client-Side Validation</h4>
                  <p>
                    The validation and expression engines execute locally in web workers or client memory without dispatching respondent responses to remote inference endpoints without explicit consent.
                  </p>
                </div>
              </div>
            </section>

            {/* Section 3 */}
            <section id="statutory" className="privacy-section">
              <div className="privacy-section__icon-header">
                <Scale size={22} className="privacy-section__icon" />
                <h2>3. Statutory &amp; Regulatory Compliance</h2>
              </div>
              <p>
                The platform is designed from the ground up to support compliance with major federal, provincial, and international data protection laws:
              </p>

              <h3>Canada — PIPEDA &amp; Substantially Similar Provincial Legislation</h3>
              <p>
                The platform adheres strictly to the 10 Fair Information Principles outlined in the <em>Personal Information Protection and Electronic Documents Act</em> (PIPEDA), as well as Alberta PIPA and British Columbia PIPA:
              </p>
              <ul className="privacy-bullets">
                <li><strong>Accountability:</strong> A designated Privacy Officer oversees all operational and infrastructural security practices.</li>
                <li><strong>Identifying Purposes &amp; Limiting Collection:</strong> In any production installation, questionnaire instruments must explicitly declare the statutory or research purpose of each question before collecting responses.</li>
                <li><strong>Consent:</strong> Affirmative, unbundled consent is required for sensitive fields, secondary research use, or paradata telemetry.</li>
                <li><strong>Safeguards:</strong> Built-in automated PII redaction (<code>redactResponses</code>) shields respondent names, email addresses, phone numbers, and IP addresses from analytical exports.</li>
              </ul>

              <h3>Quebec — Act Respecting the Protection of Personal Information (Law 25)</h3>
              <p>
                In compliance with Quebec Law 25:
              </p>
              <ul className="privacy-bullets">
                <li><strong>Privacy by Default:</strong> All browser features operate under the highest confidentiality setting by default. No cross-site profiling or tracking mechanisms are activated.</li>
                <li><strong>No Biometric or Surveillance Tracking:</strong> We do not conduct automated facial recognition or biometric profiling.</li>
                <li><strong>Right to De-indexation &amp; Portability:</strong> Local storage models empower users with instantaneous, unilateral deletion and portability of all authored assets.</li>
              </ul>

              <h3>European Union &amp; United Kingdom — GDPR</h3>
              <p>
                For European and international researchers under the <em>General Data Protection Regulation</em> (GDPR):
              </p>
              <ul className="privacy-bullets">
                <li><strong>Articles 25 &amp; 32 (Privacy by Design &amp; Security):</strong> System architecture prevents centralized storage of unauthorized survey forms.</li>
                <li><strong>Lawful Basis (Article 6):</strong> The public demo processes only essential technical tokens for HTTP delivery and explicit user-initiated mock sessions.</li>
                <li><strong>Data Subject Rights (Articles 15–20):</strong> Because user-authored surveys are stored locally, respondents and creators have direct, unmediated access to inspect, modify, and delete their records.</li>
              </ul>

              <h3>United States — California Consumer Privacy Act (CCPA / CPRA)</h3>
              <p>
                <strong>We do not sell, rent, or trade personal information.</strong> Modular Survey Tools contains zero commercial advertising networks, zero data broker integrations, and zero behavioral monetization mechanisms.
              </p>
            </section>

            {/* Section 4 */}
            <section id="ethics" className="privacy-section">
              <div className="privacy-section__icon-header">
                <ShieldCheck size={22} className="privacy-section__icon" />
                <h2>4. Research Ethics &amp; TCPS 2 Standards</h2>
              </div>
              <p>
                Survey tools must conform to ethical frameworks governing human participant research. The platform's workflows are informed by the <strong>Tri-Council Policy Statement: Ethical Conduct for Research Involving Humans (TCPS 2)</strong> and the <strong>Statistics Act</strong>:
              </p>
              <div className="privacy-callout">
                <h4>TCPS 2 Chapter 5: Privacy and Confidentiality</h4>
                <p>
                  Institutional research protocols require that researchers maintain participant confidentiality, provide explicit withdrawal pathways, and minimize the risk of deductive re-identification. Modular Survey Tools includes:
                </p>
                <ul className="privacy-bullets">
                  <li><strong>Informed Consent Modules:</strong> Standardized introductory screens providing institutional affiliations, REB/IRB approval numbers, risk/benefit statements, and researcher contact information.</li>
                  <li><strong>Voluntary Exit Logic:</strong> Respondents can withdraw at any stage without forfeiting previous rights or triggering unconsented transmission.</li>
                  <li><strong>Disclosure Control:</strong> Category binning and paradata suppression prevent small-cell re-identification in accordance with Statistics Canada confidentiality conventions.</li>
                </ul>
              </div>
              <div className="privacy-callout">
                <h4>Statistics Canada Metadata &amp; Open Government</h4>
                <p>
                  Metadata indexed in the Searcher module is sourced exclusively from official public documentation releases under the <em>Statistics Canada Open Licence</em> and the <em>Open Government Licence – Canada</em>. No confidential statistical microdata, individual tax records, or census schedules are stored or queried on this platform.
                </p>
              </div>
            </section>

            {/* Section 5 */}
            <section id="sensors" className="privacy-section">
              <div className="privacy-section__icon-header">
                <Cpu size={22} className="privacy-section__icon" />
                <h2>5. Sensors &amp; Paradata Governance</h2>
              </div>
              <p>
                The platform includes an advanced mobile sensor engine supporting location and photo-assisted data collection. To ensure participant autonomy, strict technical constraints are enforced:
              </p>
              <ul className="privacy-bullets">
                <li>
                  <strong>Two-Stage Affirmative Consent:</strong> Sensor questions cannot activate hardware without an explicit, author-declared consent variable (<code>CONSENT_GEOLOCATION</code> or <code>CONSENT_CAMERA</code>). If a respondent declines, the engine automatically routes to manual fallback questions or skips the section without error.
                </li>
                <li>
                  <strong>Client-Side EXIF Metadata Scrubbing:</strong> Whenever photos are captured or selected, the browser immediately strips all embedded EXIF metadata (GPS coordinates, camera model, hardware serial number, and timestamp) in memory before any image data is processed.
                </li>
                <li>
                  <strong>Configurable Coordinate Precision:</strong> Survey authors must specify a precision dial for geolocation. Exact coordinates can be automatically truncated to broad regional or municipal boundaries to protect residential privacy.
                </li>
                <li>
                  <strong>Respondent-Confirmed Machine Learning:</strong> Any computer vision or text recognition model generates provisional labels that the respondent must explicitly review and confirm before submission.
                </li>
              </ul>
            </section>

            {/* Section 6 */}
            <section id="telemetry" className="privacy-section">
              <div className="privacy-section__icon-header">
                <EyeOff size={22} className="privacy-section__icon" />
                <h2>6. Infrastructure, Edge Telemetry &amp; Cookie Policy</h2>
              </div>
              <p>
                We minimize network observability to the greatest extent possible:
              </p>
              <ul className="privacy-bullets">
                <li><strong>No Advertising Cookies:</strong> We do not set marketing, retargeting, or advertising cookies.</li>
                <li><strong>No Third-Party Analytics Trackers:</strong> We do not load Google Analytics, Meta Pixel, or third-party behavioral tracking scripts.</li>
                <li><strong>Essential Edge Logs:</strong> Like all web services, our hosting and content delivery providers (GitHub Pages, Cloudflare DNS) process standard ephemeral HTTP connection logs (IP address, browser user-agent, timestamp) strictly for DDoS mitigation, load balancing, and network security. These logs are automatically rotated and expunged in accordance with provider retention schedules.</li>
              </ul>
            </section>

            {/* Section 7 */}
            <section id="enterprise" className="privacy-section">
              <div className="privacy-section__icon-header">
                <Building size={22} className="privacy-section__icon" />
                <h2>7. Dedicated Enterprise &amp; Sovereign Deployments</h2>
              </div>
              <p>
                For universities, government ministries, public health agencies, and enterprise organizations requiring multi-respondent live collection:
              </p>
              <div className="privacy-enterprise-card">
                <h3>Custom Deployments &amp; Security Certifications</h3>
                <p>
                  Modular Survey Tools is designed to be deployed as an isolated, self-hosted system inside your private infrastructure:
                </p>
                <div className="privacy-enterprise-grid">
                  <div className="privacy-enterprise-feature">
                    <strong>Air-Gapped &amp; On-Premises</strong>
                    <span>Deployable on private AWS GovCloud, Azure Government, or on-premise Kubernetes clusters with zero external API dependencies.</span>
                  </div>
                  <div className="privacy-enterprise-feature">
                    <strong>Canadian Data Residency</strong>
                    <span>Full isolation within Canadian cloud regions (Montreal/Toronto) adhering to Canadian Protected B and Directive on Service and Digital standards.</span>
                  </div>
                  <div className="privacy-enterprise-feature">
                    <strong>Institutional IRB Documentation</strong>
                    <span>We assist research teams in preparing formal Data Protection Assessments (DPIA), Ethics Board (REB/IRB) submissions, and Data Transfer Agreements.</span>
                  </div>
                  <div className="privacy-enterprise-feature">
                    <strong>Enterprise RBAC &amp; Audit Logs</strong>
                    <span>Role-based access control, cryptographic respondent authentication, telephone interviewer (CATI) queues, and tamper-evident audit trails.</span>
                  </div>
                </div>
              </div>
            </section>

            {/* Section 8 */}
            <section id="contact" className="privacy-section">
              <div className="privacy-section__icon-header">
                <Mail size={22} className="privacy-section__icon" />
                <h2>8. Privacy Officer Contact &amp; Inquiries</h2>
              </div>
              <p>
                For questions regarding this policy, to request a Data Processing Agreement, or to discuss custom private deployments for your research study:
              </p>
              <div className="privacy-contact-card">
                <div className="privacy-contact-card__main">
                  <strong>Privacy &amp; Data Governance Office</strong>
                  <p>Modular Survey Tools Project</p>
                  <p>Inquiries: <a href="mailto:contact@peji.ca?subject=Privacy%20and%20Data%20Governance%20Inquiry">contact@peji.ca</a></p>
                </div>
                <div className="privacy-contact-card__action">
                  <a
                    href="mailto:contact@peji.ca?subject=Modular%20Survey%20Tools%20-%20Custom%20Deployment%20Inquiry"
                    className="btn btn--primary"
                  >
                    <Mail size={16} /> Contact Team (contact@peji.ca)
                  </a>
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>

      <footer className="hub__footer">
        <div className="hub__footer-content">
          <div className="hub__footer-brand">
            <span className="hub__footer-title">Modular Survey Tools</span>
            <span className="hub__footer-copy">© 2026 Peji. Open-source under MIT License.</span>
          </div>
          <nav className="hub__footer-links" aria-label="Footer navigation">
            <button
              type="button"
              className="footer-link-btn"
              onClick={onBack}
            >
              Back to Platform Hub
            </button>
            <a href="mailto:contact@peji.ca?subject=Modular%20Survey%20Tools%20Inquiry">
              Contact &amp; Enterprise Deployments (contact@peji.ca)
            </a>
            <a href="https://github.com/p3ji/mobilesurvey" target="_blank" rel="noopener noreferrer">
              GitHub Repository
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
