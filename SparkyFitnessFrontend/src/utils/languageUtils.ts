import type { Locale } from 'date-fns';
import {
  ar,
  ca,
  cs,
  da,
  de,
  enUS,
  es,
  fi,
  fr,
  he,
  hu,
  id,
  it,
  ja,
  kk,
  ko,
  lv,
  nb,
  nl,
  pl,
  pt,
  ptBR,
  ro,
  ru,
  sk,
  sl,
  sv,
  ta,
  te,
  tr,
  uk,
  zhCN,
  zhHK,
  zhTW,
} from 'date-fns/locale';

const dateLocales: Record<string, Locale> = {
  ar,
  ca,
  cs,
  da,
  de,
  en: enUS,
  es,
  fi,
  fr,
  he,
  hu,
  id,
  it,
  ja,
  kk,
  ko,
  lv,
  'nb-NO': nb,
  nl,
  pl,
  pt,
  'pt-BR': ptBR,
  ro,
  ru,
  sk,
  sl,
  sv,
  ta,
  te,
  tr,
  uk,
  'yue-Hant': zhHK,
  'zh-Hans': zhCN,
  'zh-Hant': zhTW,
};

export const getDateLocale = (language: string): Locale => {
  const baseLanguage = language.split('-')[0];
  return (
    dateLocales[language] ??
    (baseLanguage ? dateLocales[baseLanguage] : undefined) ??
    enUS
  );
};

const languageDisplayNames: Record<string, string> = {
  ar: 'العربية',
  ca: 'Català',
  cs: 'Čeština',
  da: 'Dansk',
  de: 'Deutsch',
  en: 'English',
  es: 'Español',
  fi: 'Suomi',
  fr: 'Français',
  he: 'עברית',
  hu: 'Magyar',
  id: 'Bahasa Indonesia',
  it: 'Italiano',
  ja: '日本語',
  kk: 'Қазақ тілі',
  ko: '한국어',
  lv: 'Latviešu',
  'nb-NO': 'Norsk bokmål',
  nl: 'Nederlands',
  pl: 'Polski',
  pt: 'Português',
  'pt-BR': 'Português (Brasil)',
  ro: 'Română',
  ru: 'Русский',
  sk: 'Slovenčina',
  sl: 'Slovenščina',
  sv: 'Svenska',
  ta: 'தமிழ்',
  te: 'తెలుగు',
  tr: 'Türkçe',
  uk: 'Українська',
  'yue-Hant': '正體粵語',
  'zh-Hans': '简体中文',
  'zh-Hant': '正體中文',
};

// Mirrors the non-empty locale directories under `public/locales`. A Weblate
// directory only belongs here once it actually contains translated strings;
// listing an empty one just offers the user an all-English UI.
export const getSupportedLanguages = (): string[] =>
  Object.keys(languageDisplayNames);

export const getLanguageDisplayName = (langCode: string): string =>
  languageDisplayNames[langCode] ?? langCode;
