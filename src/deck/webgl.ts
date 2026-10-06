// The WebGL context options the page's probe and the scene's renderer share, so they agree on what counts as WebGL.
// Production refuses a context that only software can draw (Chrome's failIfMajorPerformanceCaveat): the poster stays,
// as with no WebGL at all (ADR-0019). Test builds accept it, so CI's software WebGL still runs the scene
export function contextOptions(testBuild: boolean): WebGLContextAttributes {
  return testBuild ? {} : { failIfMajorPerformanceCaveat: true };
}
