/**
 * Privacy & Demonstration Notice
 * Plain-language, accurate notice focused on maintainer protection,
 * local-first client storage, and demonstration scope.
 */
import { ArrowLeft, CheckCircle2, Database, EyeOff, FileText, Lock, Mail, ShieldCheck } from 'lucide-react';
import { useUiLanguage, uiText } from '@mobilesurvey/ui-locale';
import { UpdatesSignup } from './UpdatesSignup.js';

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
            aria-label={l('Back to Platform Hub', 'Retour à l’accueil des outils')}
          >
            <ArrowLeft size={16} /> {l('Back to Hub', 'Retour à l’accueil')}
          </button>
          <div className="privacy-policy-header__title-block">
            <div className="privacy-badge">
              <ShieldCheck size={16} /> {l('Demonstration Notice & Privacy Practices', 'Avis de démonstration et pratiques de confidentialité')}
            </div>
            <h1>{l('Privacy & Demonstration Notice', 'Avis de confidentialité et de démonstration')}</h1>
            <p className="privacy-meta">
              {l('Effective Date: October 2026 · Maintainer: Peji', 'Date d’entrée en vigueur : octobre 2026 · Responsable : Peji')} (<a href="mailto:contact@peji.ca">contact@peji.ca</a>)
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
              <h2>{l('At a Glance: How Your Privacy is Protected', 'En bref : comment votre vie privée est protégée')}</h2>
            </div>
            <ul className="privacy-summary-points">
              <li>
                <CheckCircle2 size={16} className="text-success" />
                <span><strong>{l('Your surveys stay in your browser:', 'Vos enquêtes restent dans votre navigateur :')}</strong> {l('Any survey you design, edit, or test is stored only on your own device (using', 'Toute enquête que vous concevez, modifiez ou testez est stockée sur votre appareil (avec')} <code>localStorage</code>). {l('We do not send your drafts to our servers or store them in a database.', 'Nous n’envoyons pas vos brouillons à nos serveurs et ne les conservons pas dans une base de données.')}</span>
              </li>
              <li>
                <CheckCircle2 size={16} className="text-success" />
                <span><strong>{l('No live public data collection:', 'Pas de collecte publique de données réelles :')}</strong> {l('This site is an interactive demonstration. We do not host live survey collection for custom user questionnaires here.', 'Ce site est une démonstration interactive. Nous n’hébergeons pas ici la collecte réelle pour les questionnaires personnalisés des visiteurs.')}</span>
              </li>
              <li>
                <CheckCircle2 size={16} className="text-success" />
                <span><strong>{l('No advertising or tracking cookies:', 'Aucun témoin publicitaire ou de suivi :')}</strong> {l('We do not track you across the web, use advertising pixels, or sell any information.', 'Nous ne vous suivons pas sur le Web, n’utilisons pas de pixels publicitaires et ne vendons aucune information.')}</span>
              </li>
              <li>
                <CheckCircle2 size={16} className="text-success" />
                <span><strong>{l('You own your work:', 'Votre travail vous appartient :')}</strong> {l('You can export your survey designs as JSON files at any time, or remove them completely by clearing your browser cache.', 'Vous pouvez exporter vos questionnaires en JSON à tout moment ou les supprimer en effaçant les données du site dans votre navigateur.')}</span>
              </li>
            </ul>
          </div>

          {/* Section 1 */}
          <section className="privacy-section">
            <div className="privacy-section__icon-header">
              <FileText size={20} className="privacy-section__icon" />
              <h2>{l('1. Demonstration Sandbox Notice', '1. Avis sur l’environnement de démonstration')}</h2>
            </div>
            <p>
              {l('Modular Survey Tools', 'Modular Survey Tools')} (<code>msurvey.peji.ca</code>) {l('is an open-source evaluation and demonstration platform showcasing modern electronic questionnaire authoring, skip-logic validation, and Statistics Canada survey metadata exploration.', 'est une plateforme à code source ouvert qui permet d’évaluer la conception de questionnaires électroniques, la validation du cheminement et l’exploration des métadonnées d’enquête de Statistique Canada.')}
            </p>
            <p>
              {l('This website is provided free of charge for evaluation and research demonstration purposes.', 'Ce site est offert gratuitement à des fins d’évaluation et de démonstration pour la recherche.')} <strong>{l('We do not conduct or host live multi-respondent data collection for custom user surveys on this website.', 'Nous ne réalisons ni n’hébergeons de collecte réelle auprès de plusieurs répondants pour les enquêtes personnalisées des visiteurs.')}</strong>
            </p>
            <p>
              {l('If your organization, university, or research team requires a dedicated data collection solution in an isolated or on-premises environment, please contact', 'Si votre organisme, université ou équipe de recherche a besoin d’une solution de collecte dédiée, isolée ou installée localement, écrivez à')} <a href="mailto:contact@peji.ca">contact@peji.ca</a>.
            </p>
          </section>

          {/* Section 2 */}
          <section className="privacy-section">
            <div className="privacy-section__icon-header">
              <Database size={20} className="privacy-section__icon" />
              <h2>{l('2. Local Storage (Your Work Remains on Your Device)', '2. Stockage local (votre travail reste sur votre appareil)')}</h2>
            </div>
            <p>
              {l('We prioritize privacy by keeping your authoring and exploration work entirely local to your computer:', 'Nous protégeons votre vie privée en conservant votre travail de conception et d’exploration sur votre appareil :')}
            </p>
            <ul className="privacy-bullets">
              <li><strong>{l('Questionnaires & Drafts:', 'Questionnaires et brouillons :')}</strong> {l("When you create, edit, or test a survey in the Designer or Collector, the survey data is stored exclusively in your web browser's local storage", 'Quand vous créez, modifiez ou testez une enquête dans Designer ou Collector, ses données sont conservées uniquement dans le stockage local de votre navigateur')} (<code>localStorage</code>). {l('Your draft questions, logic rules, and text are not transmitted to our servers.', 'Vos questions, règles et textes provisoires ne sont pas transmis à nos serveurs.')}</li>
              <li><strong>{l('Searcher Data Cart:', 'Panier de données de Searcher :')}</strong> {l('Variables and question items you add to your Data Cart while browsing Statistics Canada metadata are saved only on your local device.', 'Les variables et les questions ajoutées au panier pendant l’exploration des métadonnées de Statistique Canada sont conservées sur votre appareil.')}</li>
              <li><strong>{l('Export & Deletion:', 'Exportation et suppression :')}</strong> {l('You can download your survey definitions as standard JSON files at any time. You can delete your local surveys by clicking "Delete" in the Collector workspace or by clearing your browser\'s site data.', 'Vous pouvez télécharger vos définitions d’enquête en JSON à tout moment. Pour supprimer vos enquêtes locales, utilisez la commande de suppression dans Collector ou effacez les données du site dans votre navigateur.')}</li>
            </ul>
          </section>

          {/* Section 3 */}
          <section className="privacy-section">
            <div className="privacy-section__icon-header">
              <EyeOff size={20} className="privacy-section__icon" />
              <h2>{l('3. Cookies and Network Telemetry', '3. Témoins et journaux de connexion')}</h2>
            </div>
            <ul className="privacy-bullets">
              <li><strong>{l('No Advertising or Tracking Cookies:', 'Aucun témoin publicitaire ou de suivi :')}</strong> {l('We do not use third-party analytics trackers, advertising beacons, or tracking cookies.', 'Nous n’utilisons ni outils d’analyse tiers, ni balises publicitaires, ni témoins de suivi.')}</li>
              <li><strong>{l('Standard Server Logs:', 'Journaux de serveur habituels :')}</strong> {l('Like virtually all websites, the infrastructure providers hosting this site (GitHub Pages and Cloudflare) process standard, transient HTTP request logs (such as IP addresses, browser user agent, and request timestamps) strictly for security, DDoS defense, and reliable content delivery.', 'Comme sur la plupart des sites Web, les fournisseurs d’hébergement (GitHub Pages et Cloudflare) traitent temporairement les journaux de requêtes HTTP, notamment les adresses IP, l’agent utilisateur et l’heure des requêtes, pour la sécurité, la protection contre les attaques et la diffusion fiable du contenu.')}</li>
            </ul>
          </section>

          {/* Section 4 */}
          <section className="privacy-section">
            <div className="privacy-section__icon-header">
              <ShieldCheck size={20} className="privacy-section__icon" />
              <h2>{l('4. Demonstration Sensor Questions', '4. Questions de démonstration utilisant les capteurs')}</h2>
            </div>
            <p>
              {l('The platform includes sample questions demonstrating how sensor inputs (such as location and photo capture) can function in modern mobile questionnaires:', 'La plateforme comprend des exemples de questions montrant l’utilisation de capteurs, comme la localisation et l’appareil photo, dans les questionnaires mobiles :')}
            </p>
            <ul className="privacy-bullets">
              <li>{l('Sensor features are strictly optional and require you to grant browser permission before accessing hardware.', 'Les fonctions de capteur sont facultatives et exigent votre autorisation dans le navigateur avant l’accès au matériel.')}</li>
              <li>{l('In photo questions, image EXIF metadata (such as device camera serial numbers and GPS tags) is scrubbed client-side in your browser memory before any image data is processed.', 'Pour les questions avec photo, les métadonnées EXIF, comme les numéros de série de l’appareil et les coordonnées GPS, sont retirées dans votre navigateur avant le traitement de l’image.')}</li>
              <li>{l('Any mock responses submitted on bundled demo surveys are used solely to demonstrate aggregate chart and data validation features within the demo.', 'Les réponses fictives soumises aux enquêtes de démonstration servent uniquement à illustrer les graphiques agrégés et la validation des données.')}</li>
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
              <h2>{l('6. Contact & Custom Deployment Inquiries', '6. Nous joindre et demander un déploiement personnalisé')}</h2>
            </div>
            <p>
              {l('If you have any questions about this platform, data handling, or are interested in a dedicated or self-hosted deployment tailored to your organization, please feel free to reach out:', 'Pour toute question sur la plateforme ou le traitement des données, ou pour discuter d’un déploiement dédié adapté à votre organisme, communiquez avec nous :')}
            </p>
            <div className="privacy-contact-card">
              <div className="privacy-contact-card__main">
                <strong>{l('Modular Survey Tools Project', 'Projet Modular Survey Tools')}</strong>
                <p>{l('Maintained by Peji', 'Maintenu par Peji')}</p>
                <p>{l('Inquiries:', 'Demandes :')} <a href="mailto:contact@peji.ca?subject=Modular%20Survey%20Tools%20Inquiry">contact@peji.ca</a></p>
              </div>
              <div className="privacy-contact-card__action">
                <a
                  href="mailto:contact@peji.ca?subject=Modular%20Survey%20Tools%20-%20Custom%20Deployment%20Inquiry"
                  className="btn btn--primary"
                >
                  <Mail size={16} /> {l('Contact', 'Nous joindre')} (contact@peji.ca)
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
            <span className="hub__footer-copy">© 2026 Peji. {l('Open-source demonstration under MIT License.', 'Démonstration à code source ouvert sous licence MIT.')}</span>
          </div>
          <nav className="hub__footer-links" aria-label={l('Footer navigation', 'Navigation de bas de page')}>
            <button
              type="button"
              className="footer-link-btn"
              onClick={onBack}
            >
              {l('Back to Platform Hub', 'Retour à l’accueil des outils')}
            </button>
            <a href="mailto:contact@peji.ca?subject=Modular%20Survey%20Tools%20Inquiry">
              {l('Contact', 'Nous joindre')} (contact@peji.ca)
            </a>
            <UpdatesSignup />
          </nav>
        </div>
      </footer>
    </div>
  );
}
