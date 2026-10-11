import { useEffect, useRef } from 'react';
import { Mail, ShieldCheck, Sparkles, X, Play } from 'lucide-react';
import { useUiLanguage, uiText } from '@mobilesurvey/ui-locale';

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
  const language = useUiLanguage();
  const l = (en: string, fr: string) => uiText(language, en, fr);
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

  const subject = encodeURIComponent(`${l('Inquiry: Custom Survey Deployment & Data Collection', 'Demande : déploiement et collecte de données pour une enquête personnalisée')}${surveyTitle ? ` - ${surveyTitle}` : ''}`);
  const body = encodeURIComponent(
    l('Hello Peji Team,\n\nI am interested in discussing a dedicated survey deployment / data collection solution.\n\n', 'Bonjour à l’équipe Peji,\n\nJe souhaite discuter d’une solution de déploiement et de collecte de données pour une enquête.\n\n') +
    (surveyTitle ? `${l('Survey project', 'Projet d’enquête')} : ${surveyTitle}\n` : '') +
    l('Expected number of respondents:\n', 'Nombre prévu de répondants :\n') +
    l('Hosting requirements (Cloud / On-premises):\n\n', 'Besoins d’hébergement (infonuagique / sur place) :\n\n') +
    l('Thank you!', 'Merci!')
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
            <span className="badge badge--notice">ℹ {l('Interactive Demonstration', 'Démonstration interactive')}</span>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label={l('Close dialog', 'Fermer la boîte de dialogue')}
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <h2 id="custom-solution-title" className="modal-title">
            {l('Survey Collection & Custom Deployment', 'Collecte d’enquête et déploiement personnalisé')}
          </h2>

          <p className="modal-lead">
            {l('The questionnaire designer, logic validator, and preview tools on this platform are provided as an interactive demonstration.', 'L’outil de conception de questionnaires, le validateur de logique et les outils d’aperçu de cette plateforme sont offerts à titre de démonstration interactive.')}
          </p>

          <div className="modal-callout modal-callout--privacy">
            <ShieldCheck className="modal-callout__icon" size={20} />
            <div>
              <strong>{l('Privacy & Security Standards', 'Normes de protection des renseignements personnels et de sécurité')}</strong>
              <p>
                {l('To uphold data privacy regulations (PIPEDA/GDPR) and protect our public demo infrastructure, live multi-respondent cloud data collection is restricted in this public sandbox. Any surveys you build remain 100% private to your browser.', 'Pour respecter les lois sur la protection des renseignements personnels (LPRPDE et RGPD) et protéger notre infrastructure de démonstration, la collecte infonuagique auprès de plusieurs répondants est limitée dans cet environnement public. Les enquêtes que vous créez restent dans votre navigateur.')}
              </p>
            </div>
          </div>

          <div className="modal-solution-box">
            <div className="modal-solution-box__header">
              <Sparkles size={18} className="modal-solution-box__icon" />
              <h3>{l('Need to collect real data for your organization?', 'Votre organisation doit-elle recueillir des données réelles?')}</h3>
            </div>
            <p>
              {l('We provide dedicated, production-ready survey installations tailored to research institutes, public agencies, and enterprises:', 'Nous proposons des installations d’enquête dédiées, prêtes pour la production et adaptées aux établissements de recherche, aux organismes publics et aux entreprises :')}
            </p>
            <ul className="modal-features-list">
              <li><strong>{l('Dedicated Cloud or On-Premises:', 'Infonuagique dédiée ou hébergement sur place :')}</strong> {l('Air-gapped self-hosting with zero external dependencies.', 'Auto-hébergement isolé sans dépendances externes.')}</li>
              <li><strong>{l('Regulatory PII Security:', 'Protection des renseignements personnels :')}</strong> {l('Role-based access control, cryptographic respondent codes, and automated PII redaction.', 'Contrôle d’accès selon les rôles, codes cryptographiques pour les répondants et caviardage automatisé.')}</li>
              <li><strong>{l('Statistical Metadata Alignment:', 'Conformité des métadonnées statistiques :')}</strong> {l('DDI-Lifecycle 3.3 standards, Statistics Canada knowledge graph integration, and audit logging.', 'Norme DDI-Lifecycle 3.3, intégration du graphe de connaissances de Statistique Canada et journal d’audit.')}</li>
              <li><strong>{l('Unlimited Scale:', 'Capacité évolutive :')}</strong> {l('High-concurrency electronic questionnaires and CATI phone interviewer workflows.', 'Questionnaires électroniques à forte utilisation et flux d’entrevue téléphonique assistée par ordinateur (ITAO).')}</li>
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
            <Mail size={16} /> {l('Contact for Custom Solution', 'Demander une solution personnalisée')} (contact@peji.ca)
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
              <Play size={16} /> {l('Test in Local Sandbox (Preview)', 'Tester dans l’environnement local (aperçu)')}
            </button>
          )}
          <button type="button" className="btn btn--subtle" onClick={onClose}>
            {l('Close', 'Fermer')}
          </button>
        </div>
        <div className="modal-footer-note">
          <span>{l('Read our ', 'Consultez notre ')}</span>
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
            {l('Privacy & Demonstration Notice', 'avis sur la confidentialité et la démonstration')}
          </a>
          <span>{l(' for details on local storage and data handling.', ' pour en savoir plus sur le stockage local et le traitement des données.')}</span>
        </div>
      </div>
    </div>
  );
}
