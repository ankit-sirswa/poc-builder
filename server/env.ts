/**
 * Env values pasted into a hosting dashboard often arrive wrapped in quotes or with a trailing
 * space or newline (a .env file's quotes are stripped by its parser, a dashboard field's are not).
 * Providers then reject a key that looks right. Clean what we can safely clean, and say so in the
 * server log (the variable's name only, never its value).
 *
 * Not used for passwords or encryption secrets: changing how those are read would change what
 * they mean (and make already-encrypted data unreadable).
 */
export function cleanEnv(name: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let cleaned = value.trim();
  const quoted = /^(["'`])([\s\S]*)\1$/.exec(cleaned);
  if (quoted) cleaned = quoted[2].trim();
  if (cleaned !== value) console.warn(`[config] ${name} had surrounding quotes or whitespace; using the cleaned value.`);
  return cleaned || undefined;
}
