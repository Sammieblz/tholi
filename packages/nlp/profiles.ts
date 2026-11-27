import { MODEL, MODEL_REVISION, DIMENSIONS } from "./constants";

/** Curated data profiles, never arbitrary executable code or model endpoints. */
export const LOCAL_RANKING_PROFILES = Object.freeze({
  baseline: {
    model: MODEL,
    revision: MODEL_REVISION,
    dimensions: DIMENSIONS,
    pooling: "mean",
    queryPrefix: "",
    documentPrefix: "",
    qualified: true,
  },
  "bge-small": {
    model: "Xenova/bge-small-en-v1.5",
    revision: "ea104dacec62c0de699686887e3f920caeb4f3e3",
    dimensions: 384,
    pooling: "cls",
    queryPrefix: "Represent this sentence for searching relevant passages: ",
    documentPrefix: "",
    qualified: false,
  },
  "e5-small": {
    model: "Xenova/e5-small-v2",
    revision: "02af79985278377e65c724a76275707cb0333c70",
    dimensions: 384,
    pooling: "mean",
    queryPrefix: "query: ",
    documentPrefix: "passage: ",
    qualified: false,
  },
} as const);
export type LocalRankingProfileId = keyof typeof LOCAL_RANKING_PROFILES;
export type LocalRankingProfile =
  (typeof LOCAL_RANKING_PROFILES)[LocalRankingProfileId];
export function localRankingProfile(
  id: LocalRankingProfileId,
  qualification = false,
): LocalRankingProfile {
  const profile = LOCAL_RANKING_PROFILES[id];
  if (!profile || (!profile.qualified && !qualification))
    throw new Error("The local ranking profile is not qualified.");
  return profile;
}
export function embeddingRevision(profile: LocalRankingProfile) {
  return profile.model === MODEL
    ? MODEL_REVISION
    : `${profile.model}:${profile.revision}:${profile.pooling}:prefix-1`;
}
