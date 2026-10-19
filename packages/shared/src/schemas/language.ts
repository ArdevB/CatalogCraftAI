import { z } from 'zod';

/**
 * Languages a client's catalogue content can be written in. A fixed list
 * (rather than free text) means the AI prompt always receives a language it
 * understands, and the UI can offer a simple dropdown.
 */
export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'en-US', label: 'English (US)' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'sv', label: 'Swedish' },
  { code: 'da', label: 'Danish' },
  { code: 'pl', label: 'Polish' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ne', label: 'Nepali' },
  { code: 'ja', label: 'Japanese' },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];
const LANGUAGE_CODES = LANGUAGES.map((language) => language.code) as [LanguageCode, ...LanguageCode[]];
export const languageCodeSchema = z.enum(LANGUAGE_CODES, { error: 'Choose a supported language.' });
