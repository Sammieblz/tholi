import metadata from "../../../../package.json";

/** The source repository keeps its existing address after the product rename. */
export const repositoryUrl = metadata.repository.url.replace(/\.git$/, "");
export const repositorySourceUrl = `${repositoryUrl}/blob/main/`;
