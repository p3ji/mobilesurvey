/**
 * @mobilesurvey/cognitive-lab/daemon — Local Companion HTTP + SSE Daemon
 * & Playwright Instrumented Browser Observer.
 *
 * Runs strictly on 127.0.0.1 (default port 8792) so raw audio stays on-device
 * while streaming real-time prosodic contours, diarized transcripts, UI movement
 * telemetry, and Tourangeau 4-construct moderator probes to the Hub Web UI.
 */

import http from 'node:http';
import { BUNDLED_COGNITIVE_SESSIONS } from './fixtures.js';
import { evaluateQuestionDiagnostics } from './diagnostics.js';
import { sanitizeSessionReport } from './privacy.js';
import { extractProsodicContourFromPcm } from './prosody.js';
import { resolveActiveQuestionFromDomSnapshot, type DomQuestionSnapshot } from './telemetry.js';
import { buildTranscriptTurn } from './transcriber.js';
import type {
  CognitiveSessionReport,
  SpeakerRole,
  UiTelemetryEvent,
} from './types.js';

export interface DaemonOptions {
  port?: number;
  host?: string;
}

export interface RunningDaemon {
  server: http.Server;
  port: number;
  url: string;
  close: () => Promise<void>;
}

/**
 * Browser-injected script for Playwright `page.addInitScript` that observes:
 * - Native `@mobilesurvey` `data-question-id` or external DOM question landmarks
 * - Option hover dwell & oscillations
 * - Input value changes (answer switching)
 * - Scroll regressions (upward scroll > 45px)
 * - Cursor path tortuosity
 */
export function buildPlaywrightObserverInitScript(daemonUrl: string): string {
  return `
(() => {
  const DAEMON = ${JSON.stringify(daemonUrl)};
  let currentQuestionId = 'q_init';
  let hoverStart = 0;
  let lastHoverLabel = '';
  let maxScrollY = 0;
  let pointerPoints = [];

  function postEvent(payload) {
    fetch(DAEMON + '/session/ui-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }

  function detectQuestion() {
    const msNode = document.querySelector('[data-question-id]');
    const legend = document.querySelector('fieldset legend, [role="radiogroup"] [id], [role="group"] legend');
    const heading = document.querySelector('main h1, main h2, main h3, .question-title, .q-title');
    postEvent({
      type: 'dom_snapshot',
      snapshot: {
        url: window.location.href,
        dataQuestionId: msNode ? msNode.getAttribute('data-question-id') : null,
        dataVariableRef: msNode ? msNode.getAttribute('data-variable-ref') : null,
        fieldsetLegend: legend ? (legend.textContent || '').trim() : null,
        visibleHeading: heading ? (heading.textContent || '').trim() : null,
      }
    });
  }

  window.addEventListener('mousemove', (e) => {
    pointerPoints.push({ x: e.clientX, y: e.clientY });
    if (pointerPoints.length > 60) pointerPoints.shift();
  }, { passive: true });

  window.addEventListener('mouseover', (e) => {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    let labelEl = null;
    for (const node of path) {
      if (node && node.nodeType === 1 && typeof node.matches === 'function') {
        if (node.matches('label, [role="radio"], [role="checkbox"], button, .choice-btn, .option-card')) {
          labelEl = node;
          break;
        }
      }
    }
    if (!labelEl && e.target && e.target.closest) {
      labelEl = e.target.closest('label, [role="radio"], [role="checkbox"], button');
    }
    if (!labelEl) return;
    const text = (labelEl.textContent || '').trim().slice(0, 80);
    if (text && text !== lastHoverLabel) {
      const now = Date.now();
      if (lastHoverLabel && now - hoverStart >= 160) {
        postEvent({ kind: 'option_hover', targetLabel: lastHoverLabel, dwellMs: now - hoverStart });
      }
      lastHoverLabel = text;
      hoverStart = now;
    }
  }, { passive: true });

  window.addEventListener('change', (e) => {
    const target = e.target;
    if (!target) return;
    const val = String(target.value || '').slice(0, 80);
    postEvent({ kind: 'answer_select', targetLabel: val, newValue: val });
  });

  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    if (y > maxScrollY) {
      maxScrollY = y;
    } else if (maxScrollY - y > 45) {
      postEvent({ kind: 'scroll_regression', scrollDeltaY: y - maxScrollY });
      maxScrollY = y;
    }
  }, { passive: true });

  setInterval(detectQuestion, 1200);
})();
`;
}

/**
 * Start the local companion HTTP + SSE daemon on `127.0.0.1`.
 */
export async function startCognitiveLabDaemon(
  options: DaemonOptions = {},
): Promise<RunningDaemon> {
  const host = options.host ?? '127.0.0.1';
  const requestedPort = options.port ?? 8792;

  const sessions = new Map<string, CognitiveSessionReport>();
  for (const s of BUNDLED_COGNITIVE_SESSIONS) {
    sessions.set(s.sessionId, s);
  }

  let activeSessionId = BUNDLED_COGNITIVE_SESSIONS[0]!.sessionId;
  let activeQuestionId = 'q_age';
  const sseClients = new Set<http.ServerResponse>();

  function broadcastSse(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
      client.write(payload);
    }
  }

  function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8').trim();
          resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
        } catch (err) {
          reject(err);
        }
      });
      req.on('error', reject);
    });
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const reqUrl = new URL(req.url ?? '/', `http://${host}`);

    if (req.method === 'GET' && reqUrl.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          version: '0.1.0',
          host,
          activeSessionId,
          activeQuestionId,
          models: {
            dsp: 'yin-autocorr-16khz',
            asr: 'whisper-local-disfluency-v1',
            affect: 'prosodic-lexical-fusion-v1',
            privacy: 'local-pii-surrogate-airgap',
          },
        }),
      );
      return;
    }

    if (req.method === 'GET' && reqUrl.pathname === '/sessions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          sessions: [...sessions.values()].map((s) => sanitizeSessionReport(s)),
        }),
      );
      return;
    }

    if (req.method === 'GET' && reqUrl.pathname === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(`event: connected\ndata: ${JSON.stringify({ activeSessionId, activeQuestionId })}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/session/mark-question') {
      const body = await readJsonBody(req);
      const qId = typeof body.questionId === 'string' && body.questionId ? body.questionId : `q_manual_${Date.now()}`;
      const qLabel = typeof body.questionTextEn === 'string' && body.questionTextEn ? body.questionTextEn : qId;
      activeQuestionId = qId;
      const active = sessions.get(activeSessionId);
      if (active) {
        const nowMs = active.durationMs + 500;
        const bookmarkEvent: UiTelemetryEvent = {
          id: `ev_mark_${Date.now()}`,
          timestampMs: nowMs,
          questionId: qId,
          kind: 'moderator_bookmark',
          targetLabel: qLabel,
          note: `Moderator manually marked question transition: ${qLabel}`,
        };
        active.uiEvents.push(bookmarkEvent);
        broadcastSse('question_marked', { questionId: qId, questionLabel: qLabel, event: bookmarkEvent });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, activeQuestionId: qId, questionLabel: qLabel }));
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/session/ui-event') {
      const body = await readJsonBody(req);
      const active = sessions.get(activeSessionId);
      if (!active) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No active session' }));
        return;
      }

      if (body.type === 'dom_snapshot' && body.snapshot) {
        const resolved = resolveActiveQuestionFromDomSnapshot(body.snapshot as DomQuestionSnapshot);
        activeQuestionId = resolved.questionId;
        broadcastSse('dom_question_resolved', resolved);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, resolved }));
        return;
      }

      const ev: UiTelemetryEvent = {
        id: `ev_${Date.now()}`,
        timestampMs: typeof body.timestampMs === 'number' ? body.timestampMs : active.durationMs + 250,
        questionId: typeof body.questionId === 'string' ? body.questionId : activeQuestionId,
        kind: (body.kind as UiTelemetryEvent['kind']) ?? 'option_hover',
        targetLabel: typeof body.targetLabel === 'string' ? body.targetLabel : undefined,
        newValue: typeof body.newValue === 'string' ? body.newValue : undefined,
        dwellMs: typeof body.dwellMs === 'number' ? body.dwellMs : undefined,
        scrollDeltaY: typeof body.scrollDeltaY === 'number' ? body.scrollDeltaY : undefined,
      };
      active.uiEvents.push(ev);
      broadcastSse('ui_event', ev);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, event: ev }));
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/session/audio-chunk') {
      const body = await readJsonBody(req);
      const active = sessions.get(activeSessionId);
      if (!active) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No active session' }));
        return;
      }

      const rawSamples = Array.isArray(body.samples) ? (body.samples as number[]) : [];
      const sampleRate = typeof body.sampleRate === 'number' ? body.sampleRate : 16000;
      const speaker: SpeakerRole = body.speaker === 'moderator' ? 'moderator' : 'participant';
      const transcriptText = typeof body.transcriptText === 'string' ? body.transcriptText : '';
      const questionId = typeof body.questionId === 'string' ? body.questionId : activeQuestionId;

      const pcm = new Float32Array(rawSamples);
      const { contour } = extractProsodicContourFromPcm(
        pcm,
        sampleRate,
        active.speakerBaseline,
        100,
        speaker,
      );

      const startMs = active.durationMs;
      const offsetContour = contour.map((pt) => ({
        ...pt,
        timestampMs: startMs + pt.timestampMs,
      }));
      const endMs =
        offsetContour.length > 0
          ? offsetContour[offsetContour.length - 1]!.timestampMs + 100
          : startMs + 500;

      active.prosodicContour.push(...offsetContour);
      active.durationMs = endMs;

      let turn = null;
      if (transcriptText.trim()) {
        turn = buildTranscriptTurn({
          id: `turn_${Date.now()}`,
          speaker,
          questionId,
          startMs,
          endMs,
          text: transcriptText,
          contour: active.prosodicContour,
          baseline: active.speakerBaseline,
        });
        active.transcript.push(turn);
      }

      // Recompute question diagnostic if question exists
      const qIdx = active.questions.findIndex((q) => q.questionId === questionId);
      let updatedDiagnostic = null;
      if (qIdx >= 0) {
        const existingQ = active.questions[qIdx]!;
        updatedDiagnostic = evaluateQuestionDiagnostics({
          questionId: existingQ.questionId,
          variableName: existingQ.variableName,
          questionNumber: existingQ.questionNumber,
          questionTextEn: existingQ.questionTextEn,
          questionTextFr: existingQ.questionTextFr,
          detectionSource: existingQ.detectionSource,
          enteredAtMs: existingQ.enteredAtMs,
          exitedAtMs: Math.max(existingQ.exitedAtMs, endMs),
          turns: active.transcript,
          uiEvents: active.uiEvents,
        });
        active.questions[qIdx] = updatedDiagnostic;
      }

      const sanitized = sanitizeSessionReport(active);
      sessions.set(activeSessionId, sanitized);

      broadcastSse('audio_processed', {
        contourPointsAdded: offsetContour.length,
        turn: turn ? sanitized.transcript[sanitized.transcript.length - 1] : null,
        updatedDiagnostic,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          contourPointsAdded: offsetContour.length,
          turn: turn ? sanitized.transcript[sanitized.transcript.length - 1] : null,
          updatedDiagnostic,
        }),
      );
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, host, () => resolve());
  });

  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : requestedPort;
  const url = `http://${host}:${actualPort}`;

  return {
    server,
    port: actualPort,
    url,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const client of sseClients) {
          client.end();
        }
        sseClients.clear();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
