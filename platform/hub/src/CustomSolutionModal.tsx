import { useEffect, useRef } from 'react';
import { Mail, ShieldCheck, Sparkles, X, Play } from 'lucide-react';

interface CustomSolutionModalProps {
  isOpen: boolean;
  onClose: () => void;
  surveyTitle?: string;
  onTestSandbox?: () => void;
  onOpenPrivacy?: () => void;
}

export function CustomSolutionModal({
  isOpen,
  onClose,
  surveyTitle,
  onTestSandbox,
  onOpenPrivacy,
}: CustomSolutionModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const subject = encodeURIComponent(`Inquiry: Custom Survey Deployment & Data Collection${surveyTitle ? ` - ${surveyTitle}` : ''}`);
  const body = encodeURIComponent(
    `Hello Peji Team,\n\nI am interested in discussing a dedicated survey deployment / data collection solution.\n\n` +
    (surveyTitle ? `Survey project: ${surveyTitle}\n` : '') +
    `Expected number of respondents:\n` +
    `Hosting requirements (Cloud / On-premises):\n\n` +
    `Thank you!`
  );
  const mailtoUrl = `mailto:contact@peji.ca?subject=${subject}&body=${body}`;

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal-content modal-content--solution"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="custom-solution-title"
      >
        <div className="modal-header">
          <div className="modal-header__badge">
            <span className="badge badge--notice">ℹ Interactive Demonstration</span>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <h2 id="custom-solution-title" className="modal-title">
            Survey Collection & Custom Deployment
          </h2>

          <p className="modal-lead">
            The questionnaire designer, logic validator, and preview tools on this platform are provided as an interactive demonstration.
          </p>

          <div className="modal-callout modal-callout--privacy">
            <ShieldCheck className="modal-callout__icon" size={20} />
            <div>
              <strong>Privacy & Security Standards</strong>
              <p>
                To uphold data privacy regulations (PIPEDA/GDPR) and protect our public demo infrastructure, live multi-respondent cloud data collection is restricted in this public sandbox. Any surveys you build remain 100% private to your browser.
              </p>
            </div>
          </div>

          <div className="modal-solution-box">
            <div className="modal-solution-box__header">
              <Sparkles size={18} className="modal-solution-box__icon" />
              <h3>Need to collect real data for your organization?</h3>
            </div>
            <p>
              We provide dedicated, production-ready survey installations tailored to research institutes, public agencies, and enterprises:
            </p>
            <ul className="modal-features-list">
              <li><strong>Dedicated Cloud or On-Premises:</strong> Air-gapped self-hosting with zero external dependencies.</li>
              <li><strong>Regulatory PII Security:</strong> Role-based access control, cryptographic respondent codes, and automated PII redaction.</li>
              <li><strong>Statistical Metadata Alignment:</strong> DDI-Lifecycle 3.3 standards, Statistics Canada knowledge graph integration, and audit logging.</li>
              <li><strong>Unlimited Scale:</strong> High-concurrency electronic questionnaires and CATI phone interviewer workflows.</li>
            </ul>
          </div>
        </div>

        <div className="modal-footer">
          <a
            href={mailtoUrl}
            className="btn btn--primary btn--lg"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Mail size={16} /> Contact for Custom Solution (contact@peji.ca)
          </a>
          {onTestSandbox && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                onClose();
                onTestSandbox();
              }}
            >
              <Play size={16} /> Test in Local Sandbox (Preview)
            </button>
          )}
          <button type="button" className="btn btn--subtle" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-footer-note">
          <span>Read our full </span>
          <a
            href="#privacy"
            onClick={(e) => {
              e.preventDefault();
              onClose();
              if (onOpenPrivacy) {
                onOpenPrivacy();
              } else if (typeof window !== 'undefined') {
                window.location.hash = 'privacy';
              }
            }}
          >
            Privacy, Security &amp; Research Ethics Policy
          </a>
          <span> for institutional standards and compliance details.</span>
        </div>
      </div>
    </div>
  );
}
