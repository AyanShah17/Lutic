export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body exceeds the upload limit.");
    this.name = "RequestBodyTooLargeError";
  }
}

/** Enforce the actual stream size; Content-Length alone is untrusted. */
export async function readBoundedBody(req: Request, maxBytes: number): Promise<Response> {
  const length = Number(req.headers.get("content-length"));
  if (length > maxBytes) throw new RequestBodyTooLargeError();
  const reader = req.body?.getReader();
  if (!reader) return new Response(null, { headers: req.headers });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Response(Buffer.concat(chunks), { headers: req.headers });
}
