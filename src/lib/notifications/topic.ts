// ntfy accepts topic names of 1–64 characters from [-_A-Za-z0-9].
// Validated on save so a typo surfaces in the settings form rather than
// as a 400 from the server at 3am.
export const TOPIC_PATTERN = /^[-_A-Za-z0-9]{1,64}$/;

export function isValidTopic(topic: string): boolean {
  return TOPIC_PATTERN.test(topic);
}

/**
 * The topic a user's notifications go to: their own override, else the
 * deployment default, else none. Atlas never invents a topic name — on a
 * deny-by-default server the operator has to grant write access to it.
 */
export function resolveTopic(
  userTopic: string | null | undefined,
  deploymentTopic: string | null | undefined,
): string | null {
  const own = userTopic?.trim();
  if (own) return own;
  const fallback = deploymentTopic?.trim();
  return fallback ? fallback : null;
}
