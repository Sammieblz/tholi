export function artifactFiles(
  directory: string,
): Promise<Record<string, string>>;
export function websiteArtifactDirectory(
  root?: string,
  environment?: Record<string, string | undefined>,
): string;
