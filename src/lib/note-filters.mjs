export const normalizeTags = (value) => [
  ...new Set(
    String(value)
      .split(",")
      .map((tag) => tag.trim().replace(/^#+/, ""))
      .filter(Boolean),
  ),
];
export function matchesRecord({ tags, search }, { tag = "", query = "" }) {
  return (
    (!tag || tags.includes(tag)) &&
    (!query.trim() ||
      search
        .toLocaleLowerCase("ko")
        .includes(query.trim().toLocaleLowerCase("ko")))
  );
}
