import crypto from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authorize } from "@kojo/core";
import {
  extractTextFromDocumentFile,
  getMaxUploadBytes,
  scanUploadForViruses
} from "@kojo/agent";
import { requireWebLicense } from "@/lib/db";
import { readBoundedBody } from "@/lib/request-body";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const DOC_EXTS = new Set([".md", ".markdown", ".txt", ".pdf", ".docx"]);

const JsonUploadSchema = z.object({
  name: z.string().min(1).max(200).default("snippet.txt"),
  text: z.string().min(1).max(100_000),
  mimeType: z.string().optional().default("text/plain")
});

export async function POST(req: Request) {
  try {
    verifyCsrfOrigin(req);
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "docs:read", { tenantId: user.tenantId });

    const contentType = req.headers.get("content-type") ?? "";
    const boundedBody = await readBoundedBody(req, getMaxUploadBytes() + 64 * 1024);
    const attachmentId = `att-${crypto.randomUUID().slice(0, 12)}`;

    if (contentType.includes("multipart/form-data")) {
      const formData = await boundedBody.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) {
        return problemResponse(400, "Validation Error", "Missing uploaded file.");
      }

      const buf = Buffer.from(await file.arrayBuffer());
      const maxBytes = getMaxUploadBytes();
      if (buf.byteLength <= 0 || buf.byteLength > maxBytes) {
        return problemResponse(
          400,
          "Invalid Upload",
          `File size (${buf.byteLength} bytes) exceeds allowed limit of ${maxBytes} bytes.`
        );
      }

      const ext = path.extname(file.name).toLowerCase();
      const mimeType =
        file.type ||
        (ext === ".png"
          ? "image/png"
          : ext === ".jpg" || ext === ".jpeg"
            ? "image/jpeg"
            : ext === ".webp"
              ? "image/webp"
              : ext === ".gif"
                ? "image/gif"
                : ext === ".pdf"
                  ? "application/pdf"
                  : ext === ".md" || ext === ".markdown"
                    ? "text/markdown"
                    : "text/plain");

      const isImage = IMAGE_EXTS.has(ext);
      const isDoc = DOC_EXTS.has(ext);

      if (!isImage && !isDoc) {
        return problemResponse(
          400,
          "Unsupported File Type",
          `Unsupported file type '${ext || mimeType}'. Allowed: .md, .txt, .pdf, .docx, .png, .jpg, .webp, .gif.`
        );
      }

      const virusRes = await scanUploadForViruses(buf, file.name);
      if (!virusRes.clean) {
        return problemResponse(
          422,
          "Security Scan Blocked Upload",
          `Malware signature detected: ${virusRes.threat}`
        );
      }

      if (isImage) {
        const expected = ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif"
          : ext === ".webp" ? "image/webp" : "image/jpeg";
        const signatureOk = expected === "image/png" ? buf.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
          : expected === "image/jpeg" ? buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
          : expected === "image/gif" ? /^GIF8[79]a$/.test(buf.subarray(0, 6).toString())
          : buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP";
        if (!signatureOk || (file.type && file.type !== expected)) {
          return problemResponse(400, "Invalid Image", "Image contents do not match the file type.");
        }
        const previewUrl =
          buf.byteLength <= 512 * 1024
            ? `data:${expected};base64,${buf.toString("base64")}`
            : undefined;
        return NextResponse.json(
          {
            attachmentId,
            name: file.name,
            mimeType: expected,
            kind: "image" as const,
            size: buf.byteLength,
            extractedText: `Image uploaded: ${file.name} (${mimeType}, ${buf.byteLength} bytes)`,
            ...(previewUrl ? { previewUrl } : {})
          },
          { status: 201 }
        );
      }

      let extractedText = "";
      try {
        extractedText = await extractTextFromDocumentFile(file.name, buf);
      } catch {
        return problemResponse(422, "Unreadable Document", "Could not extract document text. Upload a valid text-based document.");
      }

      return NextResponse.json(
        {
          attachmentId,
          name: file.name,
          mimeType,
          kind: "document" as const,
          size: buf.byteLength,
          extractedText: extractedText.slice(0, 20_000)
        },
        { status: 201 }
      );
    }

    const jsonBody = JsonUploadSchema.parse(await boundedBody.json());
    const size = Buffer.byteLength(jsonBody.text, "utf8");
    const virusRes = await scanUploadForViruses(
      Buffer.from(jsonBody.text, "utf8"),
      jsonBody.name
    );
    if (!virusRes.clean) {
      return problemResponse(
        422,
        "Security Scan Blocked Upload",
        `Malware signature detected: ${virusRes.threat}`
      );
    }

    return NextResponse.json(
      {
        attachmentId,
        name: jsonBody.name,
        mimeType: jsonBody.mimeType,
        kind: "text" as const,
        size,
        extractedText: jsonBody.text.slice(0, 20_000)
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
}
