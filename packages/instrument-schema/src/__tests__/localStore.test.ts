import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  listLocalSurveys,
  getLocalSurvey,
  saveLocalSurvey,
  createLocalSurvey,
  deleteLocalSurvey,
  cloneLocalSurvey,
  countQuestions,
  isLocalSurvey,
  updateLocalSurveyConfig,
  saveLocalResponse,
  listLocalResponses,
  countLocalResponses,
  deleteLocalResponses,
  saveLocalParadata,
  listLocalParadata,
  LOCAL_SURVEYS_STORAGE_KEY,
  LOCAL_SURVEYS_CHANGE_EVENT,
} from '../localStore.js';
import { lfsInstrument } from '../examples/lfs.instrument.js';

describe('localStore', () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, val: string) => { mockStorage[key] = val; },
      removeItem: (key: string) => { delete mockStorage[key]; },
      clear: () => { mockStorage = {}; },
    });
  });

  it('lists empty array when nothing is stored', () => {
    expect(LOCAL_SURVEYS_STORAGE_KEY).toBe('mobilesurvey_local_surveys_v1');
    expect(LOCAL_SURVEYS_CHANGE_EVENT).toBe('mobilesurvey:local-surveys-change');
    expect(listLocalSurveys()).toEqual([]);
  });

  it('creates, saves, and retrieves a new local survey', () => {
    const survey = createLocalSurvey('Test Survey');
    expect(survey.id).toMatch(/^s-/);
    expect(survey.title).toBe('Test Survey');
    expect(survey.questionCount).toBe(0);

    // Test explicit saveLocalSurvey update
    saveLocalSurvey({ ...survey, title: 'Updated Title' });
    const list = listLocalSurveys();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(survey.id);
    expect(list[0]?.title).toBe('Updated Title');

    const retrieved = getLocalSurvey(survey.id);
    expect(retrieved?.title).toBe('Updated Title');
  });

  it('counts questions accurately', () => {
    const qCount = countQuestions(lfsInstrument);
    expect(qCount).toBeGreaterThan(5);
  });

  it('clones an existing bundled survey into a local survey', () => {
    const cloned = cloneLocalSurvey('lfs', 'My Custom LFS');
    expect(cloned).not.toBeNull();
    expect(cloned?.title).toBe('My Custom LFS');
    expect(cloned?.id).toMatch(/^s-/);
    expect(cloned?.questionCount).toBe(countQuestions(lfsInstrument));

    const retrieved = getLocalSurvey(cloned!.id);
    expect(retrieved?.title).toBe('My Custom LFS');
  });

  it('deletes a local survey', () => {
    const survey = createLocalSurvey('To Delete');
    expect(listLocalSurveys()).toHaveLength(1);

    const deleted = deleteLocalSurvey(survey.id);
    expect(deleted).toBe(true);
    expect(listLocalSurveys()).toHaveLength(0);
  });

  it('dispatches change events on write', () => {
    const dispatchSpy = vi.fn();
    vi.stubGlobal('dispatchEvent', dispatchSpy);

    createLocalSurvey('Event Test');
    expect(dispatchSpy).toHaveBeenCalled();
  });

  it('detects local survey IDs correctly', () => {
    expect(isLocalSurvey(null)).toBe(false);
    expect(isLocalSurvey(undefined)).toBe(false);
    expect(isLocalSurvey('')).toBe(false);
    expect(isLocalSurvey('lfs')).toBe(false);
    expect(isLocalSurvey('s-test123')).toBe(true);

    const s = createLocalSurvey('Custom');
    expect(isLocalSurvey(s.id)).toBe(true);
  });

  it('updates local survey configuration', () => {
    const s = createLocalSurvey('Config Test');
    expect(s.requiresAccessCode).toBe(false);
    expect(s.status).toBe('draft');

    const ok = updateLocalSurveyConfig(s.id, {
      requiresAccessCode: true,
      status: 'published',
      anonymized: true,
      title: 'Config Test Renamed',
    });
    expect(ok).toBe(true);

    const updated = getLocalSurvey(s.id);
    expect(updated?.requiresAccessCode).toBe(true);
    expect(updated?.status).toBe('published');
    expect(updated?.anonymized).toBe(true);
    expect(updated?.title).toBe('Config Test Renamed');

    // Updating non-existent survey returns false
    expect(updateLocalSurveyConfig('non-existent', { status: 'published' })).toBe(false);
  });

  it('manages local survey responses', () => {
    const s = createLocalSurvey('Response Test');
    expect(listLocalResponses(s.id)).toHaveLength(0);
    expect(countLocalResponses(s.id)).toBe(0);

    saveLocalResponse({
      id: 'resp-1',
      surveyId: s.id,
      respondentId: 'user-1',
      submittedAt: new Date().toISOString(),
      durationMs: 45000,
      completed: true,
      answersJson: { Q1: 'Yes' },
    });

    expect(countLocalResponses(s.id)).toBe(1);
    const respList = listLocalResponses(s.id);
    expect(respList).toHaveLength(1);
    expect(respList[0]?.respondentId).toBe('user-1');
    expect(respList[0]?.answersJson).toEqual({ Q1: 'Yes' });

    deleteLocalResponses(s.id);
    expect(countLocalResponses(s.id)).toBe(0);
  });

  it('manages local paradata events', () => {
    const s = createLocalSurvey('Paradata Test');
    expect(listLocalParadata(s.id)).toHaveLength(0);

    saveLocalParadata(s.id, {
      sessionKey: `${s.id}::anon-1`,
      respondentId: 'anon-1',
      ts: Date.now(),
      type: 'page.rendered',
      payload: { pageIndex: 0 },
    });

    const events = listLocalParadata(s.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('page.rendered');
    expect(events[0]?.surveyId).toBe(s.id);
  });
});

