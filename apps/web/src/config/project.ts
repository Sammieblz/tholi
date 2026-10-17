import metadata from "../../../../package.json";

/** Canonical repository links come from the root package metadata. */
export const repositoryUrl = metadata.repository.url.replace(/\.git$/, "");
export const repositorySourceUrl = `${repositoryUrl}/blob/main/`;
