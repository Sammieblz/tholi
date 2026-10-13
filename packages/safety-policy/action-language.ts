// Shared consequence vocabulary. A heading can locate an action, but cannot
// prove that a payment, deletion, submission or publication succeeded.
export const commitLanguage =
  /\b(delete|purchase|pay|checkout|transfer|send|publish|deploy|upload|unsubscribe|authorize|confirm cancellation|finish cancellation|end membership|confirm change|submit|save(?: changes)?)\b/i;
export const hasCommitLanguage = (text: string) => commitLanguage.test(text);
