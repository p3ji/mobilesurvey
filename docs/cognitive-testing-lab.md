# Cognitive Testing Lab (`@mobilesurvey/cognitive-lab`) — Architecture & Design Specification

*Documented 2026-10-20.*

## 1. Executive Summary & Problem Statement

Traditional pre-collection questionnaire testing (cognitive interviewing and usability testing) relies heavily on manual note-taking or basic text transcripts. However, when a respondent encounters a confusing, burdensome, or sensitive survey question, **the most reliable indicators of cognitive friction are paralinguistic and behavioral rather than purely lexical**:
- A respondent says *"Um... yeah, sure, I guess $45,000?"* — a plain text transcript records a valid numeric answer, hiding the **3.1-second pre-response silent pause**, **two filled pauses**, a **+3.8-semitone rising pitch contour (uptalk)** signaling uncertainty, and **three cursor hover oscillations** between two income brackets.
- On a sensitive question, a respondent may answer *"No"* while exhibiting a **sudden -6.5 dB volume drop (withdrawal)**, **elevated vocal pitch/jitter**, and hovering near *"Prefer not to answer"* before clicking *"No"*.

**Cognitive Testing Lab (`@mobilesurvey/cognitive-lab`)** pairs a **downloadable/local companion daemon** (running on-device audio DSP, local Whisper ASR with word-level timestamps, local speech affect classification, and a Playwright/CDP instrumented browser observer) with a **Live Moderator Console & Post-Session Diagnostic UI** in the Hub (`#coglab` / `#tester`).

---

## 2. System Architecture: Local Companion Daemon + Hub Web UI

Because high-precision acoustic prosody extraction ($F_0$ pitch contours, RMS energy, sub-second pause gaps), local speech-to-text/emotion models, and cross-origin browser instrumentation require native capabilities and strict privacy for raw participant voice recordings, the system uses a **Local Companion Daemon + Browser Hub UI** architecture:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                 LOCAL COMPANION DAEMON (127.0.0.1:8792)                          │
│         npx @mobilesurvey/cognitive-lab start --survey <url-or-id>               │
│                                                                                  │
│  ┌──────────────────────────────┐      ┌──────────────────────────────────────┐  │
│  │ 1. Audio Capture & Hybrid AI │      │ 2. Instrumented Browser (Playwright) │  │
│  │ • 16kHz PCM Ring Buffer      │      │ • Injects DOM/Cursor/Scroll observer │  │
│  │ • Deterministic DSP Engine:  │      │ • Native @mobilesurvey question IDs  │  │
│  │   - YIN/Autocorr F0 (Hz/st)  │      │ • External Web Survey DOM Heuristics │  │
│  │   - RMS Volume (dBFS / ΔdB)  │      │   (fieldset/legend/heading/URL)      │  │
│  │   - VAD & Silent Pause Gaps  │      │ • Tracks: Answer switches, hover     │  │
│  │   - Pitch Slope (Uptalk)     │      │   oscillation, path tortuosity,      │  │
│  │ • Local Whisper ASR (words + │      │   scroll regressions, dwell time     │  │
│  │   filled pauses um/uh/euh)   │      └──────────────────┬───────────────────┘  │
│  │ • Local Speech Affect Model  │                         │                      │
│  │   (arousal/valence + lexical │                         ▼                      │
│  │   incongruence detector)     │      ┌──────────────────────────────────────┐  │
│  └──────────────┬───────────────┘      │ 3. Question Synchronizer &           │  │
│                 │                      │    4-Construct Diagnostic Fusion     │  │
│                 └─────────────────────►│ • Aligns voice + UI to Question ID   │  │
│                                        │ • Scores Tourangeau 4 Constructs     │  │
│                                        │ • Emits Live Moderator Probes        │  │
│                                        │ • PII Sanitizer (Zero-Cloud-Leakage) │  │
│                                        └──────────────────┬───────────────────┘  │
└───────────────────────────────────────────────────────────┼──────────────────────┘
                                                            │ HTTP REST + SSE Stream
                                                            ▼ (localhost only)
┌──────────────────────────────────────────────────────────────────────────────────┐
│                 MOBILESURVEY HUB UI (#coglab / #tester)                          │
│  • Live Moderator Console: Multi-track Pitch/Volume/Pause/UI timeline, diarized  │
│    transcript, real-time Moderator Probe suggestions, "Mark Question" override   │
│  • Post-Session Diagnostic Report: 4-Construct Question Matrix, evidence trails, │
│    cross-participant heatmap, PII-redacted JSON export, Designer deep links      │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Hybrid Audio & Paralinguistic Pipeline (`prosody.ts`, `transcriber.ts`)

### 3.1 Speaker Diarization & Baseline Normalization
- **Speaker Separation (`moderator` vs. `participant`):** Supports dual-channel audio (e.g., mic vs. system loopback in Zoom/Teams) or turn-level diarization. **All cognitive friction, prosody, and sentiment metrics are computed exclusively on `participant` speech turns** and the silent latency immediately preceding them (from the end of the moderator's prompt or the moment the question renders on screen).
- **Speaker-Normalized Prosody:** Raw pitch in Hz varies by vocal tract physiology ($85\text{–}180\text{ Hz}$ typical male, $165\text{–}255\text{ Hz}$ typical female). During the first 15 seconds of participant speech (or rolling session median), the engine establishes a per-participant baseline $(F_{0,\text{base}}, \text{RMS}_{\text{base}}, \text{WPM}_{\text{base}})$ and converts pitch variations to **semitones ($\text{st}$)** relative to baseline:
  $$\Delta F_0 (\text{st}) = 12 \log_2 \left(\frac{F_0}{F_{0,\text{base}}}\right)$$

### 3.2 Deterministic Acoustic Features (`prosody.ts`)
1. **Fundamental Frequency ($F_0$) & Pitch Dynamics:**
   - Extracted over $40\text{ ms}$ Hann-windowed frames ($20\text{ ms}$ hop) via normalized autocorrelation / YIN pitch tracking ($65\text{ Hz} \le F_0 \le 450\text{ Hz}$).
   - **Pitch Shift ($\Delta F_0$):** Mean and peak semitone deviation from participant baseline.
   - **Declarative Uptalk Slope ($\text{st/sec}$):** Measures terminal pitch rise over the final $350\text{ ms}$ of a voiced utterance. A rising terminal slope ($\ge +2.5\text{ st}$) when stating a factual answer indicates respondent uncertainty (*"I think I worked 35 hours?"*).
   - **Vocal Jitter (%):** Cycle-to-cycle period perturbation indicating vocal tension or stress.
2. **Volume / Energy Envelope ($\text{dBFS}$ & $\Delta\text{dB}$):**
   - Short-term RMS amplitude converted to decibels relative to full scale:
     $$\text{dBFS} = 20 \log_{10}(\text{RMS} + \varepsilon)$$
   - Detects **vocal withdrawal / stage-whisper drops** ($\Delta\text{dB} \le -4.5\text{ dB}$ below baseline, common on sensitive financial, health, or demographic items) and **frustration spikes** ($\Delta\text{dB} \ge +5.0\text{ dB}$).
3. **Pause Taxonomy:**
   - **Pre-Response Silent Latency ($L_{\text{pre}}$):** Silence duration between question presentation (or moderator prompt completion) and the participant's first vocalization or input interaction.
   - **Mid-Utterance Hesitation Pauses ($P_{\text{mid}}$):** Intra-turn silent gaps $\ge 450\text{ ms}$ while formulating an answer.
   - **Filled Pauses & Disfluencies (`transcriber.ts`):** Bilingual detection of non-lexical vocalizations (`um`, `uh`, `er`, `ah`, `hmm`, `euh`, `ben`, `tsé`), word repetitions, false starts, and epistemic hedges (*"I guess"*, *"maybe"*, *"sort of"*, *"probably"*, *"je pense"*, *"peut-être"*, *"genre"*).

### 3.3 Paralinguistic Sentiment & Lexical-Prosodic Incongruence
- Combines acoustic arousal (energy + pitch height + pitch variability) and acoustic valence/tension with transcript polarity.
- **Lexical-Prosodic Incongruence Flag:** Fires when the participant's words express compliance or certainty (e.g., *"Yes, that's clear"*, *"No problem"*, *"Oui, ça va"*) while the acoustic envelope shows high cognitive load or discomfort ($|\Delta F_0| \ge 3.0\text{ st}$, $\Delta\text{dB} \le -4.0\text{ dB}$, or $L_{\text{pre}} \ge 2.2\text{ s}$).

---

## 4. Behavioral UI Telemetry & Question Synchronization (`telemetry.ts`)

### 4.1 Universal Question Segmentation (Native `@mobilesurvey` + External Web Surveys)
- **Mode A — Native `@mobilesurvey` Instruments:** Reads exact `data-question-id` / `data-variable-ref` DOM attributes and listens to `@mobilesurvey/runtime-engine` step transitions.
- **Mode B — External Web Questionnaires (StatCan EQ, Qualtrics, Legacy Forms):**
  1. **DOM Heuristic Detector:** Monitors URL/hash changes, `MutationObserver` swaps on `<main>` / `<form>`, active focus transitions across `<fieldset>`/`<legend>`, `[role="radiogroup"]`, `[role="group"]`, `aria-labelledby` containers, and visible `<h1>`–`<h3>` / `.question-text` nodes.
  2. **Moderator One-Click Override:** The Moderator Console provides a **"Mark Next Question / Tag Question ID"** control (and keyboard shortcut) that immediately splits the timeline if an external SPA form uses non-standard markup.

### 4.2 High-Frequency Interaction Friction Signals
Within each active question window, the injected Playwright observer records:
- **Answer Switching (`answerChanges`):** Number of times the respondent selects one category/value and then changes it to another before advancing (e.g., ` Full-time ` $\rightarrow$ ` Part-time ` $\rightarrow$ ` Full-time `).
- **Option Hover Oscillation (`hoverOscillations`):** Alternating pointer hover dwell ($\ge 180\text{ ms}$) back and forth between two or more competing response options ($A \leftrightarrow B \leftrightarrow A$), a classic behavioral signature of **Response Mapping Confusion**.
- **Cursor Path Tortuosity (`cursorTortuosity`):** Ratio of total pointer distance traveled to the Euclidean distance between entry point, selected input, and Next button. High tortuosity ($> 3.5\times$) with rapid direction changes indicates visual search friction or layout confusion.
- **Scroll Regressions (`scrollRegressions`):** Upward scroll reversals back to the question stem or instructions after the respondent has already scrolled down to the response categories.
- **Post-Selection Verification Delay (`postSelectDelayMs`):** Hesitation time between selecting an answer and clicking "Next" (respondent second-guessing their choice).

---

## 5. Multimodal 4-Construct Cognitive Diagnostic Engine (`diagnostics.ts`)

Grounded in Tourangeau's (1984) 4-stage cognitive response model and Willis's (2005) cognitive interviewing taxonomy, the engine synthesizes voice prosody, transcript disfluencies, and UI movement into **four diagnostic constructs** (each scored $0\text{–}100$ with severity levels `low` | `moderate` | `high` and explicit evidence clauses):

| Construct | Acoustic / Prosodic Signals | Transcript Signals | UI Behavioral Signals |
| :--- | :--- | :--- | :--- |
| **1. Comprehension Difficulty**<br>*(Unclear terminology, complex syntax, ambiguous definitions)* | • Slow speech rate ($< 0.75\times$ baseline)<br>• Flat/compressed pitch contour or sudden re-reading cadence<br>• Long initial silent pause before any action | • Clarification questions (*"What does X mean?"*, *"Does this include..."*)<br>• Re-reading the question stem aloud | • **Scroll regressions** back to question stem/instructions<br>• Long **time-to-first-interaction** ($> 6\text{ s}$)<br>• High cursor tortuosity over stem text |
| **2. Retrieval Burden**<br>*(Hard-to-recall reference period, exact dollar/hour counts)* | • Extended mid-utterance silent pauses ($P_{\text{mid}} \ge 2.0\text{ s}$)<br>• High pause-to-speech ratio ($> 35\%$)<br>• Sustained level or slowly drifting pitch | • High rate of **filled pauses** (`um`, `uh`, `euh`)<br>• **Epistemic hedges** (*"roughly"*, *"around"*, *"maybe"*, *"je pense"*)<br>• Mental math verbalization | • Idle cursor drift / circular parking away from inputs while thinking<br>• Focus blur/refocus on numeric inputs |
| **3. Sensitivity / Discomfort**<br>*(Social desirability bias, intrusive financial/personal items)* | • **Volume drop** ($\Delta\text{dB} \le -4.5\text{ dB}$, withdrawal)<br>• **Pitch elevation** ($\Delta F_0 \ge +3.0\text{ st}$) or elevated vocal jitter<br>• **Lexical-prosodic incongruence** | • Abrupt 1-word answers after long latency<br>• Nervous laughter / sigh markers<br>• Explicit privacy remarks | • Hover dwell near *"Prefer not to answer"* / *"Skip"*<br>• Rapid exit click to Next after answering |
| **4. Response Mapping Confusion**<br>*(Overlapping categories, missing option, scale mismatch)* | • **Declarative uptalk slope** ($\ge +2.5\text{ st}$ rising pitch when stating chosen option)<br>• Contrastive stress on category words | • Verbalizing category comparisons (*"Neither of these really fits"*, *"Between A and B..."*) | • **Answer switching** ($\ge 1$ change)<br>• **Hover oscillation** ($A \leftrightarrow B \leftrightarrow A$)<br>• Long **post-selection delay** before clicking Next |

### Real-Time Bilingual Moderator Probe Generator
Whenever any construct score crosses $\ge 55$ during a live session (or post-hoc), the engine synthesizes a context-aware, non-leading **Suggested Moderator Probe** (in English and French) citing the exact observed signal:
- *Example (Mapping Confusion):* `"Participant hovered between 'Self-employed' and 'Fixed-term contract' 4 times with a +3.4 st rising pitch. Suggested probe: 'I noticed you looked at both Self-employed and Fixed-term contract—how did you decide which category best fits your work?'"`

---

## 6. Zero-Cloud-Leakage Privacy & PII Sanitization (`privacy.ts`)

Cognitive interviews routinely capture unredacted respondent voices discussing personal finances, health conditions, household members, or business operations.
1. **Local-Only Audio Guarantee:** Raw audio buffers (`Float32Array` / `.wav`) are processed strictly in-memory or in local temporary storage on `127.0.0.1` and are **never** included in exported reports (`rawAudioIncluded: false` enforced by schema).
2. **Automated PII Surrogate Sanitization:** Before saving or exporting any `CognitiveSessionReport`, `sanitizeSessionReport()` scans all transcript segments and moderator notes to replace names, email addresses, telephone numbers, Social Insurance Numbers (SIN), postal codes, and street addresses with deterministic surrogates (`[NAME_1]`, `[EMAIL_1]`, `[PHONE_1]`, `[ID_1]`, `[POSTAL_1]`) while leaving prosodic feature curves ($F_0$, $\text{dB}$, pause durations) and Tourangeau construct scores intact.
