/** Nonprivileged DOM fixtures inject their planner and use an explicit inert transport. */
export default {
  runtime: {
    id: "tholi-dom-fixture",
    getURL: (path: string) => new URL(path, location.href).href,
    sendMessage: async () => ({}),
  },
};
