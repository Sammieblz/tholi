const configuredOrigin = import.meta.env.VITE_THOLI_PUBLIC_ORIGIN;
function publicOrigin(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
}
export const legalOperator = {
  name: "ILUNỌNSEN LLC",
  location: "Ohio, United States",
  email: "info@ilunonsen.com",
  companyUrl: "https://ilunonsen.com",
  publicOrigin: publicOrigin(configuredOrigin),
  reviewed: "October 16, 2026",
};
