export function assetPath(path, base = "/") {
  return path.startsWith("/assets/") ? base.replace(/\/$/, "") + path : path;
}
export function imageBasePlugin(base = "/") {
  return () => (tree) => {
    const visit = (node) => {
      if (node.tagName === "img" && typeof node.properties?.src === "string")
        node.properties.src = assetPath(node.properties.src, base);
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
