import { useSyncExternalStore } from 'react';

export type UiLanguage = 'en' | 'fr';

const STORAGE_KEY = 'msurvey:ui-language';
const CHANGE_EVENT = 'msurvey:ui-language-change';

function validLanguage(value: string | null): value is UiLanguage {
  return value === 'en' || value === 'fr';
}

export function getUiLanguage(): UiLanguage {
  if (typeof window === 'undefined') return 'en';
  const fromUrl = new URLSearchParams(window.location.search).get('lang');
  if (validLanguage(fromUrl)) return fromUrl;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (validLanguage(saved)) return saved;
  } catch { /* Private browsing can disable storage. */ }
  return 'en';
}

export function setUiLanguage(language: UiLanguage): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STORAGE_KEY, language); } catch { /* Keep the current tab usable. */ }
  const url = new URL(window.location.href);
  if (url.searchParams.has('lang')) {
    url.searchParams.set('lang', language);
    window.history.replaceState(window.history.state, '', url);
  }
  window.document.documentElement.lang = language === 'fr' ? 'fr-CA' : 'en-CA';
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

export function useUiLanguage(): UiLanguage {
  return useSyncExternalStore(subscribe, getUiLanguage, () => 'en');
}

export function uiText(language: UiLanguage, english: string, french: string): string {
  return language === 'fr' ? french : english;
}

/** Shared site-language control. Survey content controls can offer further languages separately. */
export function LanguageSwitch({ className = '' }: { className?: string }) {
  const language = useUiLanguage();
  return (
    <div className={`ui-language-switch ${className}`} role="group" aria-label={uiText(language, 'Site language', 'Langue du site')}>
      <button type="button" lang="en" aria-pressed={language === 'en'} onClick={() => setUiLanguage('en')}>EN</button>
      <button type="button" lang="fr" aria-pressed={language === 'fr'} onClick={() => setUiLanguage('fr')}>FR</button>
    </div>
  );
}
