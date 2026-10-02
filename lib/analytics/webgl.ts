/**
 * Whether this browser can open a WebGL context, as the 3D table needs.
 * The probe's context is handed straight back; the table opens its own.
 */
export function webglAvailable(doc: Pick<Document, "createElement"> = document): boolean {
  try {
    const canvas = doc.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}
