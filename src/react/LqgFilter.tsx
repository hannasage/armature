import type { GlassFilter } from "../glass/filter";

/**
 * Puts a glass filter's hidden `<svg>` in the page, so `backdrop-filter: url(#id)` can find it. Render it once
 * per filter. It works in a server component. The markup comes from `createGlassFilter`, which accepts only a
 * safe id and writes only numbers and a base64 image, so it holds nothing a caller typed.
 */
export function LqgFilter({ filter }: { filter: GlassFilter }) {
  return <div style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: filter.markup }} />;
}
