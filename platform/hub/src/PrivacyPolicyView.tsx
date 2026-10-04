/**
 * Privacy & Demonstration Notice
 * Plain-language, accurate notice focused on maintainer protection,
 * local-first client storage, and demonstration scope.
 */
import { ArrowLeft, CheckCircle2, Database, EyeOff, FileText, Lock, Mail, ShieldCheck } from 'lucide-react';
import { useUiLanguage, uiText } from '@mobilesurvey/ui-locale';

interface PrivacyPolicyViewProps {
  onBack: () => void;
}

export function PrivacyPolicyView({ onBack }: PrivacyPolicyViewProps) {
  const language = useUiLanguage();
  const l = (en: string, fr: string) => uiText(language, en, fr);
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
              <ShieldCheck size={16} /> Demonstration Notice &amp; Privacy Practices
            </div>
            <h1>Privacy &amp; Demonstration Notice</h1>
            <p className="privacy-meta">
              Effective Date: October 2026 · Maintainer: Peji (<a href="mailto:contact@peji.ca">contact@peji.ca</a>)
            </p>
          </div>
        </div>
      </header>

      <main className="privacy-policy-main" style={{ maxWidth: '820px', margin: '0 auto', width: '100%' }}>
        <div className="privacy-content">
          {/* Executive Summary Card */}
          <div className="privacy-summary-card">
            <div className="privacy-summary-card__header">
              <Lock size={20} className="text-primary" />
              <h2>At a Glance: How Your Privacy is Protected</h2>
            </div>
            <ul className="privacy-summary-points">
              <li>
                <CheckCircle2 size={16} className="text-success" />
                <span><strong>Your surveys stay in your browser:</strong> Any survey you design, edit, or test is stored only on your own device (using <code>localStorage</code>). We do not send your drafts to our servers or store them in a database.</span>
              </li>
              <li>
                <CheckCircle2 size={16} className="text-success" />
                <span><strong>No live public data collection:</strong> This site is an interactive demonstration. We do not host live survey collection for custom user questionnaires here.</span>
              </li>
              <li>
                <CheckCircle2 size={16} className="text-success" />
                <span><strong>No advertising or tracking cookies:</strong> We do not track you across the web, use advertising pixels, or sell any information.</span>
              </li>
              <li>
                <CheckCircle2 size={16} className="text-success" />
                <span><strong>You own your work:</strong> You can export your survey designs as JSON files at any time, or remove them completely by clearing your browser cache.</span>
              </li>
            </ul>
          </div>

          {/* Section 1 */}
          <section className="privacy-section">
            <div className="privacy-section__icon-header">
              <FileText size={20} className="privacy-section__icon" />
              <h2>1. Demonstration Sandbox Notice</h2>
            </div>
            <p>
              Modular Survey Tools (<code>msurvey.peji.ca</code>) is an open-source evaluation and demonstration platform showcasing modern electronic questionnaire authoring, skip-logic validation, and Statistics Canada survey metadata exploration.
            </p>
            <p>
              This website is provided free of charge for evaluation and research demonstration purposes. <strong>We do not conduct or host live multi-respondent data collection for custom user surveys on this website.</strong>
            </p>
            <p>
              If your organization, university, or research team requires a dedicated data collection solution in an isolated or on-premises environment, please contact <a href="mailto:contact@peji.ca">contact@peji.ca</a>.
            </p>
          </section>

          {/* Section 2 */}
          <section className="privacy-section">
            <div className="privacy-section__icon-header">
              <Database size={20} className="privacy-section__icon" />
              <h2>2. Local Storage (Your Work Remains on Your Device)</h2>
            </div>
            <p>
              We prioritize privacy by keeping your authoring and exploration work entirely local to your computer:
            </p>
            <ul className="privacy-bullets">
              <li><strong>Questionnaires &amp; Drafts:</strong> When you create, edit, or test a survey in the Designer or Collector, the survey data is stored exclusively in your web browser's local storage (<code>localStorage</code>). Your draft questions, logic rules, and text are not transmitted to our servers.</li>
              <li><strong>Searcher Data Cart:</strong> Variables and question items you add to your Data Cart while browsing Statistics Canada metadata are saved only on your local device.</li>
              <li><strong>Export &amp; Deletion:</strong> You can download your survey definitions as standard JSON files at any time. You can delete your local surveys by clicking "Delete" in the Collector workspace or by clearing your browser's site data.</li>
            </ul>
          </section>

          {/* Section 3 */}
          <section className="privacy-section">
            <div className="privacy-section__icon-header">
              <EyeOff size={20} className="privacy-section__icon" />
              <h2>3. Cookies and Network Telemetry</h2>
            </div>
            <ul className="privacy-bullets">
              <li><strong>No Advertising or Tracking Cookies:</strong> We do not use third-party analytics trackers, advertising beacons, or tracking cookies.</li>
              <li><strong>Standard Server Logs:</strong> Like virtually all websites, the infrastructure providers hosting this site (GitHub Pages and Cloudflare) process standard, transient HTTP request logs (such as IP addresses, browser user agent, and request timestamps) strictly for security, DDoS defense, and reliable content delivery.</li>
            </ul>
          </section>

          {/* Section 4 */}
          <section className="privacy-section">
            <div className="privacy-section__icon-header">
              <ShieldCheck size={20} className="privacy-section__icon" />
              <h2>4. Demonstration Sensor Questions</h2>
            </div>
            <p>
              The platform includes sample questions demonstrating how sensor inputs (such as location and photo capture) can function in modern mobile questionnaires:
            </p>
            <ul className="privacy-bullets">
              <li>Sensor features are strictly optional and require you to grant browser permission before accessing hardware.</li>
              <li>In photo questions, image EXIF metadata (such as device camera serial numbers and GPS tags) is scrubbed client-side in your browser memory before any image data is processed.</li>
              <li>Any mock responses submitted on bundled demo surveys are used solely to demonstrate aggregate chart and data validation features within the demo.</li>
            </ul>
          </section>

          <section className="privacy-section">
            <div className="privacy-section__icon-header">
              <Mail size={20} className="privacy-section__icon" />
              <h2>{l('5. Updates mailing list', '5. Liste de diffusion des mises à jour')}</h2>
            </div>
            <p>{l('If you sign up for updates, we store your email address, preferred language, the date of signup, and the consent notice version in a private subscriber list hosted by Supabase. We use your address only to send Modular Survey Tools updates. It is not shown to other visitors. To unsubscribe or request deletion, contact contact@peji.ca.', 'Si vous vous inscrivez aux mises à jour, nous conservons votre adresse courriel, votre langue de préférence, la date de l’inscription et la version de l’avis de consentement dans une liste privée hébergée par Supabase. Nous utilisons votre adresse uniquement pour envoyer des nouvelles de Modular Survey Tools. Les autres visiteurs ne peuvent pas la consulter. Pour vous désabonner ou demander la suppression de votre adresse, écrivez à contact@peji.ca.')}</p>
          </section>

          {/* Section 6 */}
          <section className="privacy-section">
            <div className="privacy-section__icon-header">
              <Mail size={20} className="privacy-section__icon" />
              <h2>6. Contact &amp; Custom Deployment Inquiries</h2>
            </div>
            <p>
              If you have any questions about this platform, data handling, or are interested in a dedicated or self-hosted deployment tailored to your organization, please feel free to reach out:
            </p>
            <div className="privacy-contact-card">
              <div className="privacy-contact-card__main">
                <strong>Modular Survey Tools Project</strong>
                <p>Maintained by Peji</p>
                <p>Inquiries: <a href="mailto:contact@peji.ca?subject=Modular%20Survey%20Tools%20Inquiry">contact@peji.ca</a></p>
              </div>
              <div className="privacy-contact-card__action">
                <a
                  href="mailto:contact@peji.ca?subject=Modular%20Survey%20Tools%20-%20Custom%20Deployment%20Inquiry"
                  className="btn btn--primary"
                >
                  <Mail size={16} /> Contact (contact@peji.ca)
                </a>
              </div>
            </div>
          </section>
        </div>
      </main>

      <footer className="hub__footer">
        <div className="hub__footer-content">
          <div className="hub__footer-brand">
            <span className="hub__footer-title">Modular Survey Tools</span>
            <span className="hub__footer-copy">© 2026 Peji. Open-source demonstration under MIT License.</span>
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
              Contact (contact@peji.ca)
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
