import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Configure only a disposable test profile, never an installed Chrome profile. */
export async function prepareChromiumProfile(
  directory: string,
  {
    allowAutomaticDownloads = false,
  }: { allowAutomaticDownloads?: boolean } = {},
) {
  const profilePath = join(directory, "profile");
  const downloadsPath = join(directory, "downloads");
  await mkdir(downloadsPath, { recursive: true });
  if (allowAutomaticDownloads) {
    // Native automatic-download prompts cannot be exercised headlessly. The
    // report cases pregrant this separately from Playwright's acceptDownloads.
    // Browser download events, file contents and privacy assertions remain real.
    await mkdir(join(profilePath, "Default"), { recursive: true });
    await writeFile(
      join(profilePath, "Default", "Preferences"),
      JSON.stringify({
        profile: { default_content_setting_values: { automatic_downloads: 1 } },
      }),
    );
  }
  return { profilePath, downloadsPath };
}
