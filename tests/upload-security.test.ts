import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { extractTextFromDocumentFile, getEmbeddingProvider, scanUploadForViruses } from "../packages/agent/src/rag/index";
import { makeTextPdf } from "./fixtures/text-pdf";

afterEach(() => vi.unstubAllEnvs());

describe("Upload scanning", () => {
  it("extracts page text from a valid PDF fixture", async () => {
    const text = "Press maintenance manual (revision 1)";
    await expect(extractTextFromDocumentFile("manual.pdf", Buffer.from(makeTextPdf(text))))
      .resolves.toBe(`<!-- PAGE 1 -->\n${text}`);
  });

  it("does not silently substitute local embeddings for a configured external provider", () => {
    vi.stubEnv("EMBEDDING_PROVIDER", "openai");
    expect(() => getEmbeddingProvider()).toThrow("Only local deterministic embeddings");
  });
  it("extracts bounded DOCX text", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", "<w:document><w:p><w:t>Safe manual</w:t></w:p></w:document>");
    const file = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    expect(await extractTextFromDocumentFile("manual.docx", file)).toBe("Safe manual");
  });
  it("rejects malformed PDF content instead of indexing it as a manual", async () => {
    await expect(extractTextFromDocumentFile("manual.pdf", Buffer.from("This is not a PDF file")))
      .rejects.toThrow("Unable to extract");
  });
  it("limits expanded DOCX contents before they are stored in memory", async () => {
    vi.stubEnv("MAX_UPLOAD_BYTES", "1024");
    const zip = new JSZip();
    zip.file("word/document.xml", "x".repeat(100_000));
    const file = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    expect(file.length).toBeLessThan(1024);
    await expect(extractTextFromDocumentFile("manual.docx", file)).rejects.toThrow("Expanded DOCX");
  });
  it("rejects the EICAR test signature beyond the first 4096 bytes", async () => {
    const file = Buffer.from(" ".repeat(5000) + "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
    expect((await scanUploadForViruses(file, "manual.txt")).clean).toBe(false);
  });

  it("fails closed in production without a configured scanner", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CLAMAV_HOST", "");
    await expect(scanUploadForViruses(Buffer.from("manual"), "manual.txt"))
      .rejects.toThrow(/scanner/i);
  });

  it.each([
    ["stream: OK\0", true],
    ["stream: Example-Malware FOUND\0", false],
    ["INSTREAM size limit exceeded. ERROR\0", null],
    ["", null]
  ])("requires a complete clean scanner reply: %s", async (reply, clean) => {
    const file = Buffer.from("machine manual");
    let received = Buffer.alloc(0);
    const server = net.createServer((socket) => {
      socket.on("data", (chunk) => {
        received = Buffer.concat([received, chunk]);
        if (received.length >= 10 + 4 + file.length + 4) socket.end(reply);
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    vi.stubEnv("CLAMAV_HOST", "127.0.0.1");
    vi.stubEnv("CLAMAV_PORT", String((server.address() as net.AddressInfo).port));
    try {
      const scan = scanUploadForViruses(file, "manual.txt");
      if (clean === null) await expect(scan).rejects.toThrow(/scan/i);
      else expect((await scan).clean).toBe(clean);
      expect(received.subarray(0, 10).toString()).toBe("zINSTREAM\0");
      expect(received.readUInt32BE(10)).toBe(file.length);
      expect(received.subarray(14, -4)).toEqual(file);
      expect(received.readUInt32BE(received.length - 4)).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    }
  });
});
