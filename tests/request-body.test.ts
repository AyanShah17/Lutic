import { describe, expect, it } from "vitest";
import { readBoundedBody } from "../apps/web/src/lib/request-body";

describe("Upload request limits", () => {
  it("rejects oversized content even when Content-Length lies", async () => {
    const req = new Request("http://localhost/upload", {
      method: "POST", headers: { "content-length": "1" }, body: "too much data"
    });
    await expect(readBoundedBody(req, 4)).rejects.toThrow("upload limit");
  });
  it("preserves a body at the exact byte limit", async () => {
    const req = new Request("http://localhost/upload", { method: "POST", body: "é" });
    expect(await (await readBoundedBody(req, 2)).text()).toBe("é");
  });
});
