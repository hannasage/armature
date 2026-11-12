// The value layer: kinds, a spring over a vector, and the value controller. It holds no flavor and reads no environment.
// The kinds are the number kind, the vector kind, and the color, path, and 3D transform kinds.
export * from "./kind";
export * from "./vector";
export * from "./value";
export { colorKind } from "./color";
export { pathKind } from "./path";
export { transform3dKind, transform3dStyles } from "./transform3d";
export type { Transform3D, Transform3DStyles } from "./transform3d";
