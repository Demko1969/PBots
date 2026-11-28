export const providers = {
  openai: { name: "OpenAI", model: "gpt-5-mini", label: "GPT-5 mini" },
  claude: { name: "Claude", model: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  gemini: { name: "Gemini", model: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
};

/** @param {unknown} value @returns {value is keyof typeof providers} */
export function isProvider(value) {
  return typeof value === "string" && Object.hasOwn(providers, value);
}

/** The workflows carry the exact model ID in their existing model field. */
export function providerForModel(/** @type {string} */ model) {
  if (model === providers.claude.model) return "claude";
  if (model === providers.gemini.model) return "gemini";
  return "openai";
}
