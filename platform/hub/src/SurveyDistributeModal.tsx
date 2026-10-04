/**
 * SurveyDistributeModal — Comprehensive survey distribution, link sharing, QR codes,
 * email list ingestion, disposition tracking, and email invitation dispatch.
 */
import { useState, useEffect, useRef, useMemo, useCallback, type FormEvent, type ChangeEvent } from 'react';
import QRCode from 'qrcode';
import {
  respondentLink,
  personalizedRespondentLink,
  fetchAccessCodes,
  saveAccessCodes,
  updateAccessCode,
  deleteAccessCode,
  clearAccessCodes,
  setSurveyConfig,
  type SurveySummary,
  type AccessCodeRow,
} from './api.js';
import {
  parseRecipientList,
  interpolateTemplate,
  buildMailMergeCsv,
  loadEmailProviderConfig,
  saveEmailProviderConfig,
  sendEmailMessage,
  type EmailProviderConfig,
  type ParsedRecipient,
} from './distributionUtils.js';

interface SurveyDistributeModalProps {
  survey: SurveySummary;
  isOpen: boolean;
  onClose: () => void;
  onSurveyUpdated: () => void;
  isDemoMode?: boolean;
}

type TabKey = 'share' | 'list' | 'email';

export function SurveyDistributeModal({
  survey,
  isOpen,
  onClose,
  onSurveyUpdated,
  isDemoMode = false,
}: SurveyDistributeModalProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('share');

  // Survey config state
  const [anonymized, setAnonymized] = useState(survey.anonymized ?? false);
  const [requiresCode, setRequiresCode] = useState(survey.requiresAccessCode);
  const [savingConfig, setSavingConfig] = useState(false);

  // Tab 1: Share Link & QR state
  const [channelParam, setChannelParam] = useState<string>('');
  const [langParam, setLangParam] = useState<string>('');
  const [customKey, setCustomKey] = useState<string>('');
  const [customVal, setCustomVal] = useState<string>('');
  const [linkCopied, setLinkCopied] = useState(false);
  const [embedCopied, setEmbedCopied] = useState(false);
  const [qrSize, setQrSize] = useState<number>(240);
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Tab 2: Recipient list state
  const [recipients, setRecipients] = useState<AccessCodeRow[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [showImportForm, setShowImportForm] = useState(false);
  const [importMode, setImportMode] = useState<'csv' | 'paste'>('paste');
  const [pasteText, setPasteText] = useState('');
  const [parsedPreview, setParsedPreview] = useState<{
    recipients: ParsedRecipient[];
    detectedColumns: string[];
    errors: string[];
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set());
  const [copiedTokenCode, setCopiedTokenCode] = useState<string | null>(null);

  // Tab 3: Email templates & dispatch state
  const [emailSubject, setEmailSubject] = useState(
    `Invitation to participate: {{survey_title}}`
  );
  const [emailBody, setEmailBody] = useState(
    `Hello {{name}},\n\nYou are invited to participate in our survey: {{survey_title}}.\n\nPlease click your personalized link below to complete the survey:\n{{survey_link}}\n\nYour personal access code is: {{access_code}}\n\nThank you for sharing your feedback!\n\nBest regards,\nThe Survey Team`
  );
  const [previewIndex, setPreviewIndex] = useState(0);
  const [providerConfig, setProviderConfig] = useState<EmailProviderConfig>(loadEmailProviderConfig());
  const [showProviderSettings, setShowProviderSettings] = useState(false);
  const [dispatchTarget, setDispatchTarget] = useState<'ready' | 'non_responders' | 'selected' | 'test'>('ready');
  const [testEmailAddress, setTestEmailAddress] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendProgress, setSendProgress] = useState<{ current: number; total: number } | null>(null);
  const [sendSuccessMsg, setSendSuccessMsg] = useState<string | null>(null);
  const [sendErrorMsg, setSendErrorMsg] = useState<string | null>(null);

  // Sync survey prop changes
  useEffect(() => {
    setAnonymized(survey.anonymized ?? false);
    setRequiresCode(survey.requiresAccessCode);
  }, [survey]);

  // Load recipient access codes when modal opens or survey changes
  const reloadRecipients = useCallback(async () => {
    setLoadingList(true);
    try {
      const data = await fetchAccessCodes(survey.id);
      setRecipients(data);
    } catch {
      setRecipients([]);
    } finally {
      setLoadingList(false);
    }
  }, [survey.id]);

  useEffect(() => {
    if (isOpen) {
      void reloadRecipients();
    }
  }, [isOpen, reloadRecipients]);

  // Compute the customized public URL
  const publicUrl = useMemo(() => {
    const params: Record<string, string> = {};
    if (channelParam.trim()) params.src = channelParam.trim();
    if (langParam.trim()) params.lang = langParam.trim();
    if (customKey.trim() && customVal.trim()) params[customKey.trim()] = customVal.trim();
    return respondentLink(survey.id, Object.keys(params).length > 0 ? params : undefined);
  }, [survey.id, channelParam, langParam, customKey, customVal]);

  // Draw QR code whenever publicUrl changes or Tab 1 is active
  useEffect(() => {
    if (activeTab === 'share' && qrCanvasRef.current) {
      void QRCode.toCanvas(qrCanvasRef.current, publicUrl, {
        width: qrSize,
        margin: 2,
        color: { dark: '#1b2733', light: '#ffffff' },
      });
    }
  }, [publicUrl, activeTab, qrSize]);

  if (!isOpen) return null;

  // ── Handlers: Link Sharing ──────────────────────────────────────────────────

  const copyPublicLink = () => {
    navigator.clipboard.writeText(publicUrl).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  };

  const copyEmbedSnippet = () => {
    const snippet = `<iframe src="${publicUrl}" width="100%" height="700" frameborder="0" allow="geolocation; camera" title="${survey.title}"></iframe>`;
    navigator.clipboard.writeText(snippet).then(() => {
      setEmbedCopied(true);
      setTimeout(() => setEmbedCopied(false), 2000);
    });
  };

  const downloadQrPng = () => {
    if (!qrCanvasRef.current) return;
    const url = qrCanvasRef.current.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `qrcode-${survey.id}.png`;
    a.click();
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: survey.title,
          text: `Please participate in our survey: ${survey.title}`,
          url: publicUrl,
        });
      } catch {
        /* user cancelled */
      }
    }
  };

  // ── Handlers: Recipient Ingestion ───────────────────────────────────────────

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = String(event.target?.result ?? '');
      setPasteText(text);
      const parsed = parseRecipientList(text);
      setParsedPreview(parsed);
    };
    reader.readAsText(file);
  };

  const handlePreviewParse = () => {
    if (!pasteText.trim()) return;
    const parsed = parseRecipientList(pasteText);
    setParsedPreview(parsed);
  };

  const handleConfirmImport = async () => {
    if (!parsedPreview || parsedPreview.recipients.length === 0) return;
    setImporting(true);
    try {
      await saveAccessCodes(
        survey.id,
        parsedPreview.recipients.map((r) => ({
          code: r.code,
          email: r.email,
          respondentName: r.name || null,
          respondentFieldsJson: r.customFields,
          status: 'ready',
        }))
      );
      setParsedPreview(null);
      setPasteText('');
      setShowImportForm(false);
      await reloadRecipients();
    } catch {
      alert('Failed to import recipients. Please check your network connection.');
    } finally {
      setImporting(false);
    }
  };

  const handleClearList = async () => {
    if (!confirm(`Are you sure you want to remove all ${recipients.length} recipients for this survey?`)) return;
    try {
      await clearAccessCodes(survey.id);
      setSelectedCodes(new Set());
      await reloadRecipients();
    } catch {
      alert('Failed to clear recipients.');
    }
  };

  const handleDeleteRecipient = async (code: string) => {
    try {
      await deleteAccessCode(code);
      setSelectedCodes((prev) => {
        const next = new Set(prev);
        next.delete(code);
        return next;
      });
      await reloadRecipients();
    } catch {
      alert('Could not delete recipient.');
    }
  };

  const copyRecipientLink = (code: string) => {
    const link = personalizedRespondentLink(survey.id, code);
    navigator.clipboard.writeText(link).then(() => {
      setCopiedTokenCode(code);
      setTimeout(() => setCopiedTokenCode(null), 2000);
    });
  };

  // ── Handlers: Mail-Merge CSV Export ─────────────────────────────────────────

  const exportMailMerge = (onlyNonResponders = false) => {
    const pool = onlyNonResponders
      ? recipients.filter((r) => r.status !== 'completed')
      : recipients;
    if (pool.length === 0) {
      alert(onlyNonResponders ? 'No non-responders to export.' : 'No recipients to export.');
      return;
    }
    const csv = buildMailMergeCsv(survey.id, pool);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mail-merge-${survey.id}${onlyNonResponders ? '-reminders' : ''}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Handlers: Template & Email Dispatch ─────────────────────────────────────

  const customFieldKeys = useMemo(() => {
    const set = new Set<string>();
    for (const r of recipients) {
      if (r.respondentFieldsJson) {
        for (const k of Object.keys(r.respondentFieldsJson)) {
          set.add(k);
        }
      }
    }
    return [...set].sort();
  }, [recipients]);

  const insertVariable = (varName: string) => {
    const token = `{{${varName}}}`;
    setEmailBody((prev) => `${prev} ${token} `);
  };

  const currentPreviewRecipient = recipients[previewIndex] ?? null;

  const interpolatedPreview = useMemo(() => {
    const sampleRecip = currentPreviewRecipient ?? {
      code: 'sample-token',
      email: 'alex.smith@example.org',
      respondentName: 'Alex Smith',
      respondentFieldsJson: { department: 'Research & Data', location: 'Ottawa' },
    };
    const vars: Record<string, string> = {
      survey_title: survey.title,
      name: sampleRecip.respondentName || sampleRecip.email?.split('@')[0] || 'Participant',
      email: sampleRecip.email || '',
      access_code: sampleRecip.code,
      survey_link: personalizedRespondentLink(survey.id, sampleRecip.code),
    };
    if (sampleRecip.respondentFieldsJson) {
      for (const [k, v] of Object.entries(sampleRecip.respondentFieldsJson)) {
        vars[k] = String(v ?? '');
      }
    }
    return {
      subject: interpolateTemplate(emailSubject, vars),
      body: interpolateTemplate(emailBody, vars),
      link: vars.survey_link,
    };
  }, [emailSubject, emailBody, currentPreviewRecipient, survey.title, survey.id]);

  const handleSaveProviderConfig = (e: FormEvent) => {
    e.preventDefault();
    saveEmailProviderConfig(providerConfig);
    setShowProviderSettings(false);
  };

  const handleSendDispatch = async () => {
    setSendSuccessMsg(null);
    setSendErrorMsg(null);

    let targets: AccessCodeRow[] = [];
    if (dispatchTarget === 'ready') {
      targets = recipients.filter((r) => r.status === 'ready');
    } else if (dispatchTarget === 'non_responders') {
      targets = recipients.filter((r) => r.status !== 'completed');
    } else if (dispatchTarget === 'selected') {
      targets = recipients.filter((r) => selectedCodes.has(r.code));
    } else if (dispatchTarget === 'test') {
      if (!testEmailAddress || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmailAddress)) {
        alert('Please enter a valid test email address.');
        return;
      }
      targets = [
        {
          code: 'test-preview',
          surveyId: survey.id,
          email: testEmailAddress,
          respondentName: 'Test Recipient',
          respondentFieldsJson: {},
          status: 'ready',
          sentAt: null,
          startedAt: null,
          completedAt: null,
          usedAt: null,
        },
      ];
    }

    if (targets.length === 0) {
      alert('No recipients match the selected dispatch filter.');
      return;
    }

    if (
      dispatchTarget !== 'test' &&
      !confirm(`Send invitation emails to ${targets.length} recipient(s) via ${providerConfig.type}?`)
    ) {
      return;
    }

    setIsSending(true);
    setSendProgress({ current: 0, total: targets.length });

    let sentCount = 0;
    let failCount = 0;

    for (let i = 0; i < targets.length; i++) {
      const recip = targets[i]!;
      const vars: Record<string, string> = {
        survey_title: survey.title,
        name: recip.respondentName || recip.email?.split('@')[0] || 'Participant',
        email: recip.email || '',
        access_code: recip.code,
        survey_link: personalizedRespondentLink(survey.id, recip.code),
      };
      if (recip.respondentFieldsJson) {
        for (const [k, v] of Object.entries(recip.respondentFieldsJson)) {
          vars[k] = String(v ?? '');
        }
      }

      const subject = interpolateTemplate(emailSubject, vars);
      const body = interpolateTemplate(emailBody, vars);

      const result = await sendEmailMessage(providerConfig, {
        to: recip.email ?? '',
        toName: recip.respondentName ?? undefined,
        subject,
        bodyText: body,
      });

      if (result.ok) {
        sentCount++;
        if (recip.code !== 'test-preview') {
          await updateAccessCode(recip.code, {
            status: 'sent',
            sentAt: new Date().toISOString(),
          });
        }
      } else {
        failCount++;
      }

      setSendProgress({ current: i + 1, total: targets.length });
      // Minor rate limit delay
      await new Promise((r) => setTimeout(r, 60));
    }

    setIsSending(false);
    setSendProgress(null);

    if (dispatchTarget !== 'test') {
      await reloadRecipients();
    }

    if (failCount === 0) {
      setSendSuccessMsg(`Successfully sent ${sentCount} invitation email(s)!`);
    } else {
      setSendErrorMsg(`Sent ${sentCount} email(s), but ${failCount} failed to deliver.`);
    }
  };

  // ── Handlers: Survey Settings ───────────────────────────────────────────────

  const toggleAnonymized = async (val: boolean) => {
    setAnonymized(val);
    setSavingConfig(true);
    try {
      await setSurveyConfig(survey.id, { anonymized: val });
      onSurveyUpdated();
    } finally {
      setSavingConfig(false);
    }
  };

  const toggleRequiresCode = async (val: boolean) => {
    setRequiresCode(val);
    setSavingConfig(true);
    try {
      await setSurveyConfig(survey.id, { requiresAccessCode: val });
      onSurveyUpdated();
    } finally {
      setSavingConfig(false);
    }
  };

  // ── Metrics Calculation ─────────────────────────────────────────────────────

  const totalCount = recipients.length;
  const readyCount = recipients.filter((r) => r.status === 'ready').length;
  const sentCount = recipients.filter((r) => r.status === 'sent').length;
  const startedCount = recipients.filter((r) => r.status === 'started').length;
  const completedCount = recipients.filter((r) => r.status === 'completed').length;
  const responseRate = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  // Filtered recipient list
  const filteredRecipients = useMemo(() => {
    return recipients.filter((r) => {
      if (statusFilter === 'ready' && r.status !== 'ready') return false;
      if (statusFilter === 'sent' && r.status !== 'sent') return false;
      if (statusFilter === 'started' && r.status !== 'started') return false;
      if (statusFilter === 'completed' && r.status !== 'completed') return false;
      if (statusFilter === 'non_responders' && r.status === 'completed') return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesEmail = r.email?.toLowerCase().includes(q);
        const matchesName = r.respondentName?.toLowerCase().includes(q);
        const matchesCode = r.code.toLowerCase().includes(q);
        if (!matchesEmail && !matchesName && !matchesCode) return false;
      }
      return true;
    });
  }, [recipients, statusFilter, searchQuery]);

  return (
    <div className="distribute-modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="distribute-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="distribute-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <header className="distribute-modal__header">
          <div className="distribute-modal__title-group">
            <h2 id="distribute-modal-title" className="distribute-modal__title">
              Share &amp; Distribute
            </h2>
            <span className="distribute-modal__survey-badge">{survey.title}</span>
            {anonymized ? (
              <span className="badge badge--neutral" title="Responses are saved anonymously without personal identifiers">
                🛡 Anonymized
              </span>
            ) : (
              <span className="badge badge--live" title="Responses are linked to recipient identities">
                👤 Identified
              </span>
            )}
            {isDemoMode && (
              <span className="badge badge--neutral" title="Demo mode: recipients and invitations are stored locally in browser storage">
                ● Demo Mode
              </span>
            )}
          </div>
          <button
            type="button"
            className="distribute-modal__close-btn"
            onClick={onClose}
            aria-label="Close distribution dialog"
          >
            ✕
          </button>
        </header>

        {/* Navigation Tabs */}
        <nav className="distribute-modal__tabs" aria-label="Distribution channels">
          <button
            type="button"
            className={`distribute-tab ${activeTab === 'share' ? 'distribute-tab--active' : ''}`}
            onClick={() => setActiveTab('share')}
          >
            🔗 Public Link &amp; QR
          </button>
          <button
            type="button"
            className={`distribute-tab ${activeTab === 'list' ? 'distribute-tab--active' : ''}`}
            onClick={() => setActiveTab('list')}
          >
            📋 Email List &amp; Dispositions {totalCount > 0 && <span className="tab-counter">({totalCount})</span>}
          </button>
          <button
            type="button"
            className={`distribute-tab ${activeTab === 'email' ? 'distribute-tab--active' : ''}`}
            onClick={() => setActiveTab('email')}
          >
            ✉ Email Templates &amp; Dispatch
          </button>
        </nav>

        {/* Modal Body */}
        <div className="distribute-modal__body">
          {/* ══════════════════════════════════════════════════════════════════════
              TAB 1: SHARE LINK & QR
             ══════════════════════════════════════════════════════════════════════ */}
          {activeTab === 'share' && (
            <div className="distribute-share-tab">
              <section className="distribute-section">
                <h3 className="distribute-section__title">Public Survey Link</h3>
                <p className="distribute-section__desc">
                  Share this open link anywhere. Anyone who clicks will begin the survey. Responses are stored in real-time.
                </p>

                {/* Campaign Channel Preset Chips */}
                <div className="channel-presets">
                  <span className="channel-presets__label">Add campaign tag:</span>
                  {[
                    { label: 'None', val: '' },
                    { label: 'Newsletter', val: 'newsletter' },
                    { label: 'Social Media', val: 'social' },
                    { label: 'Print Poster', val: 'poster' },
                    { label: 'Kiosk', val: 'kiosk' },
                  ].map((p) => (
                    <button
                      key={p.val}
                      type="button"
                      className={`pill-chip ${channelParam === p.val ? 'pill-chip--selected' : ''}`}
                      onClick={() => setChannelParam(p.val)}
                    >
                      {p.label}
                    </button>
                  ))}
                  <div className="channel-presets__lang">
                    <label htmlFor="lang-preset" className="sr-only">Language</label>
                    <select
                      id="lang-preset"
                      value={langParam}
                      onChange={(e) => setLangParam(e.target.value)}
                      className="distribute-select"
                    >
                      <option value="">Default Language</option>
                      <option value="en">English (?lang=en)</option>
                      <option value="fr">French (?lang=fr)</option>
                    </select>
                  </div>
                  <div className="channel-presets__custom" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <input
                      type="text"
                      placeholder="Param"
                      value={customKey}
                      onChange={(e) => setCustomKey(e.target.value)}
                      className="distribute-select"
                      style={{ width: '85px' }}
                    />
                    <span style={{ color: 'var(--ink-soft)' }}>=</span>
                    <input
                      type="text"
                      placeholder="Value"
                      value={customVal}
                      onChange={(e) => setCustomVal(e.target.value)}
                      className="distribute-select"
                      style={{ width: '85px' }}
                    />
                  </div>
                </div>

                {/* Link Display Box */}
                <div className="link-box">
                  <input
                    type="text"
                    readOnly
                    value={publicUrl}
                    className="link-box__input"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button type="button" className="btn btn--primary" onClick={copyPublicLink}>
                    {linkCopied ? '✓ Copied' : '⎘ Copy Link'}
                  </button>
                  <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="btn">
                    Launch ↗
                  </a>
                  {typeof navigator !== 'undefined' && 'share' in navigator && (
                    <button type="button" className="btn" onClick={handleNativeShare}>
                      Share…
                    </button>
                  )}
                </div>
              </section>

              <div className="distribute-grid-two">
                {/* QR Code Card */}
                <section className="distribute-card">
                  <h4 className="distribute-card__title">Downloadable QR Code</h4>
                  <p className="distribute-card__desc">
                    Print on physical flyers, posters, letters, or display on presentation slides for scan-to-fill.
                  </p>
                  <div className="qr-container">
                    <canvas ref={qrCanvasRef} className="qr-canvas" />
                  </div>
                  <div className="qr-actions">
                    <button type="button" className="btn btn--primary" onClick={downloadQrPng}>
                      ↓ Download QR Code (.png)
                    </button>
                    <div className="qr-size-picker">
                      <span>Size:</span>
                      <button
                        type="button"
                        className={`size-btn ${qrSize === 180 ? 'size-btn--active' : ''}`}
                        onClick={() => setQrSize(180)}
                      >
                        S
                      </button>
                      <button
                        type="button"
                        className={`size-btn ${qrSize === 240 ? 'size-btn--active' : ''}`}
                        onClick={() => setQrSize(240)}
                      >
                        M
                      </button>
                      <button
                        type="button"
                        className={`size-btn ${qrSize === 360 ? 'size-btn--active' : ''}`}
                        onClick={() => setQrSize(360)}
                      >
                        L
                      </button>
                    </div>
                  </div>
                </section>

                {/* Embed Snippet Card */}
                <section className="distribute-card">
                  <h4 className="distribute-card__title">Embed in Web Page / Portal</h4>
                  <p className="distribute-card__desc">
                    Paste this responsive iframe code into any intranet, web application, or blog.
                  </p>
                  <div className="embed-box">
                    <pre className="embed-code">
                      {`<iframe\n  src="${publicUrl}"\n  width="100%"\n  height="700"\n  frameborder="0"\n  allow="geolocation; camera"\n  title="${survey.title}">\n</iframe>`}
                    </pre>
                  </div>
                  <button type="button" className="btn" onClick={copyEmbedSnippet}>
                    {embedCopied ? '✓ Copied Embed Code' : '⎘ Copy Embed HTML'}
                  </button>
                </section>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════════
              TAB 2: EMAIL LIST & DISPOSITIONS
             ══════════════════════════════════════════════════════════════════════ */}
          {activeTab === 'list' && (
            <div className="distribute-list-tab">
              {/* Funnel KPI Summary */}
              <div className="funnel-metrics">
                <div className="funnel-stat">
                  <span className="funnel-stat__label">Total Invited</span>
                  <strong className="funnel-stat__val">{totalCount}</strong>
                </div>
                <div className="funnel-stat">
                  <span className="funnel-stat__label">Ready (Pending)</span>
                  <strong className="funnel-stat__val funnel-stat--ready">{readyCount}</strong>
                </div>
                <div className="funnel-stat">
                  <span className="funnel-stat__label">Sent</span>
                  <strong className="funnel-stat__val funnel-stat--sent">{sentCount}</strong>
                </div>
                <div className="funnel-stat">
                  <span className="funnel-stat__label">In Progress</span>
                  <strong className="funnel-stat__val funnel-stat--started">{startedCount}</strong>
                </div>
                <div className="funnel-stat">
                  <span className="funnel-stat__label">Completed</span>
                  <strong className="funnel-stat__val funnel-stat--completed">{completedCount}</strong>
                </div>
                <div className="funnel-stat funnel-stat--rate">
                  <span className="funnel-stat__label">Response Rate</span>
                  <strong className="funnel-stat__val">{responseRate}%</strong>
                  <div className="funnel-progress">
                    <div className="funnel-progress__bar" style={{ width: `${responseRate}%` }} />
                  </div>
                </div>
              </div>

              {/* Roster Controls Bar */}
              <div className="roster-toolbar">
                <div className="roster-toolbar__left">
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => setShowImportForm((v) => !v)}
                  >
                    {showImportForm ? '✕ Close Import' : '+ Load Email List / CSV'}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => exportMailMerge(false)}
                    disabled={totalCount === 0}
                    title="Export ready-to-mail CSV with personalized links for Outlook/Mailchimp"
                  >
                    📥 Export Mail-Merge CSV
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => exportMailMerge(true)}
                    disabled={completedCount === totalCount}
                    title="Export only non-responders for follow-up reminders"
                  >
                    📥 Export Reminders CSV ({totalCount - completedCount})
                  </button>
                  {totalCount > 0 && (
                    <button
                      type="button"
                      className="btn btn--danger"
                      onClick={handleClearList}
                    >
                      Clear List
                    </button>
                  )}
                </div>

                <div className="roster-toolbar__right">
                  <input
                    type="search"
                    placeholder="Search by email, name..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="roster-search"
                  />
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="roster-filter-select"
                  >
                    <option value="all">All Dispositions ({totalCount})</option>
                    <option value="ready">Ready ({readyCount})</option>
                    <option value="sent">Sent ({sentCount})</option>
                    <option value="started">In Progress ({startedCount})</option>
                    <option value="completed">Completed ({completedCount})</option>
                    <option value="non_responders">Non-Responders ({totalCount - completedCount})</option>
                  </select>
                </div>
              </div>

              {/* Collapsible Import Form */}
              {showImportForm && (
                <div className="import-box">
                  <div className="import-box__tabs">
                    <button
                      type="button"
                      className={`import-subtab ${importMode === 'paste' ? 'import-subtab--active' : ''}`}
                      onClick={() => setImportMode('paste')}
                    >
                      Paste Text
                    </button>
                    <button
                      type="button"
                      className={`import-subtab ${importMode === 'csv' ? 'import-subtab--active' : ''}`}
                      onClick={() => setImportMode('csv')}
                    >
                      Upload CSV File
                    </button>
                  </div>

                  {importMode === 'paste' ? (
                    <div className="import-paste-area">
                      <p className="import-box__hint">
                        Paste email addresses, comma/tab separated rows, or full CSV text. Any extra columns (e.g. <code>department</code>, <code>role</code>) will be saved and can be piped into survey questions.
                      </p>
                      <textarea
                        rows={6}
                        className="import-textarea"
                        placeholder="email,name,department&#10;alice@example.com,Alice Smith,Research&#10;bob@example.com,Bob Jones,Policy"
                        value={pasteText}
                        onChange={(e) => setPasteText(e.target.value)}
                      />
                      <div className="import-box__footer">
                        <button type="button" className="btn btn--primary" onClick={handlePreviewParse}>
                          Parse &amp; Preview
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="import-file-area">
                      <p className="import-box__hint">
                        Upload a <code>.csv</code> file containing recipient email addresses and optional custom attributes.
                      </p>
                      <input type="file" accept=".csv,.txt" onChange={handleFileUpload} className="import-file-input" />
                    </div>
                  )}

                  {/* Preview Banner */}
                  {parsedPreview && (
                    <div className="import-preview">
                      <div className="import-preview__head">
                        <strong>Preview:</strong> {parsedPreview.recipients.length} valid recipient(s) found
                        {parsedPreview.detectedColumns.length > 0 && (
                          <span className="import-preview__cols">
                            · Custom attributes: {parsedPreview.detectedColumns.map((c) => (
                              <code key={c} className="preview-chip">{c}</code>
                            ))}
                          </span>
                        )}
                        {parsedPreview.errors.length > 0 && (
                          <span className="import-preview__warn">({parsedPreview.errors.length} rows skipped)</span>
                        )}
                      </div>

                      {/* Sample Rows Table */}
                      <table className="import-preview__table">
                        <thead>
                          <tr>
                            <th>Email</th>
                            <th>Name</th>
                            <th>Generated Token</th>
                            <th>Custom Attributes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parsedPreview.recipients.slice(0, 4).map((r, i) => (
                            <tr key={i}>
                              <td>{r.email}</td>
                              <td>{r.name || '—'}</td>
                              <td><code>{r.code}</code></td>
                              <td>
                                {Object.keys(r.customFields).length > 0
                                  ? JSON.stringify(r.customFields)
                                  : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      <div className="import-preview__actions">
                        <button
                          type="button"
                          className="btn btn--primary"
                          onClick={handleConfirmImport}
                          disabled={importing}
                        >
                          {importing ? 'Importing…' : `Confirm & Import ${parsedPreview.recipients.length} Recipients`}
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => setParsedPreview(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Recipient Disposition Table */}
              <div className="roster-table-wrapper">
                {loadingList ? (
                  <p className="roster-empty">Loading recipients…</p>
                ) : filteredRecipients.length === 0 ? (
                  <div className="roster-empty-state">
                    <p className="roster-empty">
                      {totalCount === 0
                        ? 'No recipients loaded yet. Click "+ Load Email List / CSV" above to import your sample.'
                        : 'No recipients match the current filter.'}
                    </p>
                  </div>
                ) : (
                  <table className="roster-table">
                    <thead>
                      <tr>
                        <th style={{ width: 36 }}>
                          <input
                            type="checkbox"
                            aria-label="Select all rows"
                            checked={
                              filteredRecipients.length > 0 &&
                              filteredRecipients.every((r) => selectedCodes.has(r.code))
                            }
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedCodes(new Set(filteredRecipients.map((r) => r.code)));
                              } else {
                                setSelectedCodes(new Set());
                              }
                            }}
                          />
                        </th>
                        <th>Email &amp; Recipient</th>
                        <th>Custom Attributes</th>
                        <th>Disposition</th>
                        <th>Timestamps</th>
                        <th>Personalized Link</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRecipients.map((r) => (
                        <tr key={r.code} className={selectedCodes.has(r.code) ? 'row-selected' : ''}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Select ${r.email}`}
                              checked={selectedCodes.has(r.code)}
                              onChange={(e) => {
                                const next = new Set(selectedCodes);
                                if (e.target.checked) next.add(r.code);
                                else next.delete(r.code);
                                setSelectedCodes(next);
                              }}
                            />
                          </td>
                          <td>
                            <div className="recipient-cell">
                              <span className="recipient-cell__email">{r.email ?? '—'}</span>
                              {r.respondentName && (
                                <span className="recipient-cell__name">{r.respondentName}</span>
                              )}
                            </div>
                          </td>
                          <td>
                            <div className="custom-fields-cell">
                              {r.respondentFieldsJson && Object.keys(r.respondentFieldsJson).length > 0 ? (
                                Object.entries(r.respondentFieldsJson).map(([k, v]) => (
                                  <span key={k} className="field-tag" title={`${k}: ${String(v)}`}>
                                    <strong>{k}:</strong> {String(v)}
                                  </span>
                                ))
                              ) : (
                                <span className="field-tag-empty">—</span>
                              )}
                            </div>
                          </td>
                          <td>
                            <span className={`disposition-badge disposition-badge--${r.status}`}>
                              {r.status === 'ready' && '● Ready'}
                              {r.status === 'sent' && '✉ Sent'}
                              {r.status === 'started' && '◐ In Progress'}
                              {r.status === 'completed' && '✓ Completed'}
                            </span>
                          </td>
                          <td>
                            <div className="timestamps-cell">
                              {r.completedAt ? (
                                <span title="Completed at">
                                  ✓ {new Date(r.completedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </span>
                              ) : r.startedAt ? (
                                <span title="Started at">
                                  ◐ {new Date(r.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </span>
                              ) : r.sentAt ? (
                                <span title="Sent at">
                                  ✉ {new Date(r.sentAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </span>
                              ) : (
                                <span className="timestamps-cell--none">—</span>
                              )}
                            </div>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn btn--small"
                              onClick={() => copyRecipientLink(r.code)}
                            >
                              {copiedTokenCode === r.code ? '✓ Copied' : '⎘ Copy Token Link'}
                            </button>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn btn--danger btn--small"
                              onClick={() => handleDeleteRecipient(r.code)}
                              title="Delete recipient"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════════
              TAB 3: EMAIL TEMPLATES & DISPATCH
             ══════════════════════════════════════════════════════════════════════ */}
          {activeTab === 'email' && (
            <div className="distribute-email-tab">
              {/* Alert Feedback */}
              {sendSuccessMsg && (
                <div className="distribute-alert distribute-alert--ok">
                  {sendSuccessMsg}
                </div>
              )}
              {sendErrorMsg && (
                <div className="distribute-alert distribute-alert--err">
                  {sendErrorMsg}
                </div>
              )}

              <div className="email-builder-grid">
                {/* Left Column: Template Editor */}
                <div className="email-editor-panel">
                  <div className="email-editor-header">
                    <h3 className="distribute-section__title">Invitation Template</h3>
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={() => setShowProviderSettings((v) => !v)}
                    >
                      ⚙ Provider Settings ({providerConfig.type})
                    </button>
                  </div>

                  {/* Provider Settings Drawer */}
                  {showProviderSettings && (
                    <form onSubmit={handleSaveProviderConfig} className="provider-settings-box">
                      <h4 className="provider-settings-box__title">Email Dispatch Provider</h4>
                      <div className="form-group">
                        <label className="form-label" htmlFor="provider-type-select">Delivery Engine</label>
                        <select
                          id="provider-type-select"
                          value={providerConfig.type}
                          onChange={(e) =>
                            setProviderConfig({ ...providerConfig, type: e.target.value as any })
                          }
                          className="distribute-select"
                        >
                          <option value="simulated">Simulated / Demo Mode (Logs to console, updates status)</option>
                          <option value="resend">Resend API (Direct REST)</option>
                          <option value="sendgrid">SendGrid API (Direct REST)</option>
                          <option value="webhook">Custom Webhook / Supabase Edge Function</option>
                        </select>
                      </div>

                      {providerConfig.type !== 'simulated' && providerConfig.type !== 'webhook' && (
                        <div className="form-group">
                          <label className="form-label" htmlFor="provider-api-key">API Key</label>
                          <input
                            id="provider-api-key"
                            type="password"
                            value={providerConfig.apiKey ?? ''}
                            onChange={(e) =>
                              setProviderConfig({ ...providerConfig, apiKey: e.target.value })
                            }
                            placeholder={providerConfig.type === 'resend' ? 're_...' : 'SG....'}
                            className="distribute-input"
                          />
                        </div>
                      )}

                      {providerConfig.type === 'webhook' && (
                        <div className="form-group">
                          <label className="form-label" htmlFor="provider-webhook-url">Webhook / Function URL</label>
                          <input
                            id="provider-webhook-url"
                            type="url"
                            value={providerConfig.webhookUrl ?? ''}
                            onChange={(e) =>
                              setProviderConfig({ ...providerConfig, webhookUrl: e.target.value })
                            }
                            placeholder="https://...supabase.co/functions/v1/send-invites"
                            className="distribute-input"
                          />
                        </div>
                      )}

                      <div className="form-row">
                        <div className="form-group">
                          <label className="form-label" htmlFor="provider-from-address">From Email</label>
                          <input
                            id="provider-from-address"
                            type="email"
                            value={providerConfig.fromAddress ?? ''}
                            onChange={(e) =>
                              setProviderConfig({ ...providerConfig, fromAddress: e.target.value })
                            }
                            placeholder="surveys@example.org"
                            className="distribute-input"
                          />
                        </div>
                        <div className="form-group">
                          <label className="form-label" htmlFor="provider-from-name">From Name</label>
                          <input
                            id="provider-from-name"
                            type="text"
                            value={providerConfig.fromName ?? ''}
                            onChange={(e) =>
                              setProviderConfig({ ...providerConfig, fromName: e.target.value })
                            }
                            placeholder="Statistics Survey Team"
                            className="distribute-input"
                          />
                        </div>
                      </div>

                      <div className="form-actions">
                        <button type="submit" className="btn btn--primary btn--small">
                          Save Settings
                        </button>
                      </div>
                    </form>
                  )}

                  <div className="form-group">
                    <label className="form-label" htmlFor="email-subject-input">Subject Line</label>
                    <input
                      id="email-subject-input"
                      type="text"
                      value={emailSubject}
                      onChange={(e) => setEmailSubject(e.target.value)}
                      className="distribute-input"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="email-body-input">Body Text</label>
                    <div className="variable-chips">
                      <span className="variable-chips__label">Insert variable:</span>
                      {['name', 'survey_title', 'survey_link', 'access_code', ...customFieldKeys].map((v) => (
                        <button
                          key={v}
                          type="button"
                          className="var-chip"
                          onClick={() => insertVariable(v)}
                        >
                          + {`{{${v}}}`}
                        </button>
                      ))}
                    </div>
                    <textarea
                      id="email-body-input"
                      rows={11}
                      value={emailBody}
                      onChange={(e) => setEmailBody(e.target.value)}
                      className="distribute-textarea"
                    />
                  </div>
                </div>

                {/* Right Column: Live Email Preview & Send Controls */}
                <div className="email-preview-panel">
                  <div className="email-preview-header">
                    <h3 className="distribute-section__title">Live Email Preview</h3>
                    {recipients.length > 0 && (
                      <div className="preview-nav">
                        <button
                          type="button"
                          className="btn btn--small"
                          disabled={previewIndex <= 0}
                          onClick={() => setPreviewIndex((i) => Math.max(0, i - 1))}
                        >
                          ◀
                        </button>
                        <span className="preview-nav__counter">
                          Recipient {previewIndex + 1} of {recipients.length}
                        </span>
                        <button
                          type="button"
                          className="btn btn--small"
                          disabled={previewIndex >= recipients.length - 1}
                          onClick={() => setPreviewIndex((i) => Math.min(recipients.length - 1, i + 1))}
                        >
                          ▶
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Rendered Email Envelope Card */}
                  <div className="mock-email-envelope">
                    <div className="mock-email-envelope__meta">
                      <div className="meta-row">
                        <span className="meta-label">From:</span>
                        <span className="meta-val">
                          {providerConfig.fromName || 'Survey Team'} &lt;{providerConfig.fromAddress || 'surveys@msurvey.peji.ca'}&gt;
                        </span>
                      </div>
                      <div className="meta-row">
                        <span className="meta-label">To:</span>
                        <span className="meta-val">
                          {currentPreviewRecipient
                            ? `${currentPreviewRecipient.respondentName || ''} <${currentPreviewRecipient.email}>`
                            : 'Recipient <alex.smith@example.org>'}
                        </span>
                      </div>
                      <div className="meta-row">
                        <span className="meta-label">Subject:</span>
                        <strong className="meta-val">{interpolatedPreview.subject}</strong>
                      </div>
                    </div>

                    <div className="mock-email-envelope__body">
                      <div className="mock-email-prose">
                        {interpolatedPreview.body.split('\n\n').map((paragraph, idx) => (
                          <p key={idx} style={{ margin: '0 0 12px' }}>
                            {paragraph.split('\n').map((line, lidx) => (
                              <span key={lidx}>
                                {line}
                                <br />
                              </span>
                            ))}
                          </p>
                        ))}
                      </div>

                      <div className="mock-email-cta">
                        <a
                          href={interpolatedPreview.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn--primary"
                        >
                          Start Survey →
                        </a>
                      </div>
                    </div>
                  </div>

                  {/* Dispatch Controls */}
                  <div className="dispatch-controls">
                    <h4 className="dispatch-controls__title">Dispatch Invitations</h4>
                    <div className="dispatch-targets">
                      <label className="radio-label">
                        <input
                          type="radio"
                          name="dispatch_target"
                          value="ready"
                          checked={dispatchTarget === 'ready'}
                          onChange={() => setDispatchTarget('ready')}
                        />
                        Ready (Not Sent) only: <strong>{readyCount}</strong>
                      </label>
                      <label className="radio-label">
                        <input
                          type="radio"
                          name="dispatch_target"
                          value="non_responders"
                          checked={dispatchTarget === 'non_responders'}
                          onChange={() => setDispatchTarget('non_responders')}
                        />
                        All Non-Responders: <strong>{totalCount - completedCount}</strong>
                      </label>
                      <label className="radio-label">
                        <input
                          type="radio"
                          name="dispatch_target"
                          value="selected"
                          checked={dispatchTarget === 'selected'}
                          onChange={() => setDispatchTarget('selected')}
                          disabled={selectedCodes.size === 0}
                        />
                        Selected in table: <strong>{selectedCodes.size}</strong>
                      </label>
                      <label className="radio-label">
                        <input
                          type="radio"
                          name="dispatch_target"
                          value="test"
                          checked={dispatchTarget === 'test'}
                          onChange={() => setDispatchTarget('test')}
                        />
                        Send Single Test Email
                      </label>
                    </div>

                    {dispatchTarget === 'test' && (
                      <div className="test-email-row">
                        <input
                          type="email"
                          placeholder="your-email@example.com"
                          value={testEmailAddress}
                          onChange={(e) => setTestEmailAddress(e.target.value)}
                          className="distribute-input"
                        />
                      </div>
                    )}

                    {isSending && sendProgress && (
                      <div className="dispatch-progress">
                        <div className="dispatch-progress__text">
                          Sending invitation {sendProgress.current} of {sendProgress.total}…
                        </div>
                        <div className="funnel-progress">
                          <div
                            className="funnel-progress__bar"
                            style={{ width: `${(sendProgress.current / sendProgress.total) * 100}%` }}
                          />
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={handleSendDispatch}
                      disabled={isSending || (dispatchTarget !== 'test' && totalCount === 0)}
                    >
                      {isSending ? 'Sending…' : `Send Invitations via ${providerConfig.type}`}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer / Survey Settings */}
        <footer className="distribute-modal__footer">
          <div className="distribute-modal__settings">
            <label className="toggle">
              <input
                type="checkbox"
                checked={anonymized}
                disabled={savingConfig}
                onChange={(e) => toggleAnonymized(e.target.checked)}
              />
              <span>
                <strong>Anonymized responses:</strong> Record submitted answers without personal identity (completion is tracked to prevent re-submissions and suppress reminders).
              </span>
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={requiresCode}
                disabled={savingConfig}
                onChange={(e) => toggleRequiresCode(e.target.checked)}
              />
              <span>
                <strong>Require access code:</strong> Gate entry for respondents who visit the root URL directly.
              </span>
            </label>
          </div>

          <div className="distribute-modal__footer-actions">
            <button type="button" className="btn btn--primary" onClick={onClose}>
              Done
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
