import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  and,
  authorize,
  conversations,
  createPostgresRateLimitConsumer,
  desc,
  eq,
  messages
} from "@lutic/core";
import { runAgentTurn } from "@lutic/agent";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import { enforceApiQuota } from "@/lib/quota";
import { readBoundedBody } from "@/lib/request-body";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

const databaseUrl = process.env.DATABASE_URL;
const consumeQuota = databaseUrl && /^postgres(?:ql)?:\/\//.test(databaseUrl)
  ? createPostgresRateLimitConsumer(databaseUrl)
  : undefined;

const AttachmentSchema = z.object({
  attachmentId: z.string().optional(),
  name: z.string().min(1).max(240),
  mimeType: z.string().min(1).max(120).default("text/plain"),
  kind: z.enum(["document", "image", "text"]).default("text"),
  size: z.number().int().nonnegative().optional(),
  extractedText: z.string().max(40000).optional(),
  previewUrl: z.string().max(200000).optional()
});

const ChatRequestSchema = z.object({
  conversationId: z.string().optional(),
  machineId: z.string().optional(),
  serviceId: z
    .enum([
      "overview",
      "board",
      "machines",
      "monitoring",
      "dashboards",
      "workflows",
      "connectors",
      "notifications",
      "queues"
    ])
    .optional(),
  message: z.string().min(1).max(8000),
  attachments: z.array(AttachmentSchema).max(10).optional(),
  stream: z.boolean().optional().default(false)
});

export async function POST(req: Request) {
  try {
    verifyCsrfOrigin(req);
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) {
      return problemResponse(401, "Unauthorized", "Please sign in to chat.");
    }
    authorize(user, "docs:read", { tenantId: user.tenantId });

    const body = ChatRequestSchema.parse(
      await (await readBoundedBody(req, 4 * 1024 * 1024)).json()
    );

    // Transaction 1: enforce AI quota, ensure conversation, fetch latest 20 messages, persist user message.
    const prepared = await withWebTenantDb(user.tenantId, async (db) => {
      const quotaRes = await enforceApiQuota(req, db, user, "ai", { consumeQuota });
      if (quotaRes) {
        return { quotaRes } as const;
      }
      let convId = body.conversationId;
      if (convId) {
        const existing = await db
          .select()
          .from(conversations)
          .where(
            and(
              eq(conversations.id, convId),
              eq(conversations.tenantId, user.tenantId),
              eq(conversations.userId, user.userId)
            )
          )
          .limit(1);
        if (!existing[0]) {
          return null;
        }
      } else {
        convId = `conv-${crypto.randomUUID().slice(0, 10)}`;
        const title = body.message.trim().slice(0, 64);
        await db.insert(conversations).values({
          id: convId,
          tenantId: user.tenantId,
          userId: user.userId,
          machineId: body.machineId ?? null,
          title: title.length < body.message.trim().length ? `${title}...` : title
        });
      }

      const priorMsgs = await db
        .select({ role: messages.role, content: messages.content })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, convId),
            eq(messages.tenantId, user.tenantId)
          )
        )
        .orderBy(desc(messages.createdAt))
        .limit(20);

      const history = priorMsgs
        .reverse()
        .filter((m): m is { role: "user" | "assistant"; content: string } =>
          m.role === "user" || m.role === "assistant"
        );

      const userMsgId = `msg-${crypto.randomUUID().slice(0, 10)}`;
      await db.insert(messages).values({
        id: userMsgId,
        tenantId: user.tenantId,
        conversationId: convId,
        role: "user",
        content: body.message
      });

      return { convId, history };
    });

    if (prepared && "quotaRes" in prepared && prepared.quotaRes) {
      return prepared.quotaRes;
    }
    if (!prepared || !("convId" in prepared)) {
      return problemResponse(404, "Not Found", "Conversation not found.");
    }

    const { convId, history } = prepared;
    const persistAssistantResult = async (result: Awaited<ReturnType<typeof runAgentTurn>>) => {
      const assistantMsgId = `msg-${crypto.randomUUID().slice(0, 10)}`;
      await withWebTenantDb(user.tenantId, async (db) => {
        await db.insert(messages).values({
          id: assistantMsgId,
          tenantId: user.tenantId,
          conversationId: convId,
          role: "assistant",
          content: result.answer,
          toolCalls: result.toolCalls as unknown as Array<Record<string, unknown>>,
          citations: result.citations as unknown as Array<Record<string, unknown>>,
          charts: result.charts as unknown as Array<Record<string, unknown>>,
          safetyWarning: result.safetyWarning ?? null,
          pendingActionId: result.pendingAction?.id ?? null
        });
        await db
          .update(conversations)
          .set({ updatedAt: new Date() })
          .where(eq(conversations.id, convId));
      });
      return {
        conversationId: convId,
        messageId: assistantMsgId,
        ...result
      };
    };

    if (body.stream) {
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          try {
            if (req.signal?.aborted) {
              controller.close();
              return;
            }
            const result = await runAgentTurn({
              runScopedDb: (fn) => withWebTenantDb(user.tenantId, fn),
              consumeQuota,
              user,
              message: body.message,
              conversationId: convId,
              machineId: body.machineId,
              serviceId: body.serviceId,
              attachments: body.attachments,
              history,
              abortSignal: req.signal,
              onTokenDelta: (delta) => {
                if (req.signal?.aborted || !delta) return;
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: "delta", text: delta })}\n\n`)
                );
              }
            });
            const payload = await persistAssistantResult(result);
            if (!req.signal?.aborted) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: "done", payload })}\n\n`)
              );
            }
          } catch (err) {
            const detail =
              err instanceof Error && err.name === "AbortError"
                ? "The client cancelled the request before completion."
                : "Chat stream failed.";
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "error", detail })}\n\n`)
            );
          } finally {
            controller.close();
          }
        }
      });

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache"
        }
      });
    }

    // LLM calls run outside open DB transactions; tool calls use short-lived runScopedDb transactions.
    const result = await runAgentTurn({
      runScopedDb: (fn) => withWebTenantDb(user.tenantId, fn),
      consumeQuota,
      user,
      message: body.message,
      conversationId: convId,
      machineId: body.machineId,
      serviceId: body.serviceId,
      attachments: body.attachments,
      history,
      abortSignal: req.signal
    });
    const payload = await persistAssistantResult(result);
    return NextResponse.json(payload);
  } catch (err) {
    if (req.signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
      return problemResponse(499, "Request Cancelled", "The client cancelled the request before completion.");
    }
    return handleApiError(err);
  }
}
