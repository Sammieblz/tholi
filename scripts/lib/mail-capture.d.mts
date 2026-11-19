export function findCapturedMail(
  options: { origin: string; needle: string; expected: 1 | 2 },
  readJson: (url: string) => Promise<unknown>,
): Promise<{ ID: string; Subject: string }[]>;
