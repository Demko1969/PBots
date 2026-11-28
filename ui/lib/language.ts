export const languageNames = { en: "English", fr: "Français", tr: "Türkçe" } as const;
export type Language = keyof typeof languageNames;

export function browserLanguage(preferences: readonly string[]): Language {
  for (const preference of preferences) {
    const code = preference.toLowerCase().split("-")[0];
    if (Object.hasOwn(languageNames, code)) return code as Language;
  }
  return "en";
}
