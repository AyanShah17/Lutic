import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  and,
  asc,
  assets,
  AuthorizationError,
  authorize,
  conversations,
  eq,
  inArray,
  messages,
  userPlants
} from "@kojo/core";
import { getSessionUser } from "@/lib/auth";
import { withWebTenantDb } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default async function SharedConversationPage({
  params: pendingParams
}: {
  params: Promise<{ token: string }>;
}) {
  const params = await pendingParams;
  const user = await getSessionUser();
  if (!user) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12 text-center space-y-4">
        <h1 className="text-xl font-bold">Sign in Required</h1>
        <p className="text-sm text-muted-foreground">
          Shared conversations are restricted to authenticated users in the same tenant.
        </p>
        <Link href="/login" className={buttonVariants()}>
          Sign in
        </Link>
      </div>
    );
  }

  try {
    authorize(user, "docs:read", { tenantId: user.tenantId });
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return (
        <div className="mx-auto max-w-xl px-4 py-12 text-center space-y-3">
          <h1 className="text-xl font-bold">Access Denied</h1>
          <p className="text-sm text-muted-foreground">{err.message}</p>
        </div>
      );
    }
    throw err;
  }

  return withWebTenantDb(user.tenantId, async (db) => {
    const convRows = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.shareToken, params.token),
          eq(conversations.tenantId, user.tenantId)
        )
      )
      .limit(1);

    const conv = convRows[0];
    if (!conv) {
      return (
        <div className="mx-auto max-w-xl px-4 py-12 text-center space-y-3">
          <h1 className="text-xl font-bold">Shared Conversation Not Found</h1>
          <p className="text-sm text-muted-foreground">
            This link is invalid or belongs to another tenant.
          </p>
        </div>
      );
    }

    const msgRows = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conv.id),
          eq(messages.tenantId, user.tenantId)
        )
      )
      .orderBy(asc(messages.createdAt));

    const referencedMachineIds = new Set<string>();
    const requiredPlantIds = new Set<string>();
    if (conv.machineId) referencedMachineIds.add(conv.machineId);

    for (const msg of msgRows) {
      for (const tc of msg.toolCalls ?? []) {
        const args = tc && typeof tc === "object" && tc.args && typeof tc.args === "object"
          ? (tc.args as Record<string, unknown>)
          : null;
        if (!args) continue;
        if (typeof args.machineId === "string" && args.machineId.trim()) {
          referencedMachineIds.add(args.machineId.trim());
        }
        if (typeof args.plantId === "string" && args.plantId.trim()) {
          requiredPlantIds.add(args.plantId.trim());
        }
        if (Array.isArray(args.plantIds)) {
          for (const pid of args.plantIds) {
            if (typeof pid === "string" && pid.trim()) {
              requiredPlantIds.add(pid.trim());
            }
          }
        }
      }
    }

    if (referencedMachineIds.size > 0) {
      const machineIds = [...referencedMachineIds];
      const foundMachines = await db
        .select({ id: assets.id, plantId: assets.plantId })
        .from(assets)
        .where(and(inArray(assets.id, machineIds), eq(assets.tenantId, user.tenantId)));
      if (foundMachines.length !== machineIds.length) {
        return (
          <div className="mx-auto max-w-xl px-4 py-12 text-center space-y-3">
            <h1 className="text-xl font-bold">Shared Conversation Not Found</h1>
            <p className="text-sm text-muted-foreground">
              The machine linked to this conversation is no longer accessible.
            </p>
          </div>
        );
      }
      for (const machine of foundMachines) {
        requiredPlantIds.add(machine.plantId);
      }
    }

    if (!conv.machineId) {
      const creatorPlants = await db
        .select({ plantId: userPlants.plantId })
        .from(userPlants)
        .where(and(eq(userPlants.userId, conv.userId), eq(userPlants.tenantId, user.tenantId)));
      for (const p of creatorPlants) {
        requiredPlantIds.add(p.plantId);
      }
    }

    const plantList = [...requiredPlantIds];
    try {
      if (plantList.length === 0) {
        throw new AuthorizationError("Shared conversation has no verifiable plant scope.");
      }
      authorize(user, conv.machineId ? "machine:read" : "docs:read", {
        tenantId: user.tenantId,
        plantIds: plantList
      });
    } catch (err) {
      if (err instanceof AuthorizationError) {
        return (
          <div className="mx-auto max-w-xl px-4 py-12 text-center space-y-3">
            <h1 className="text-xl font-bold">Plant Access Denied</h1>
            <p className="text-sm text-muted-foreground">
              You are not authorized to view shared conversations outside your assigned plant scope.
            </p>
          </div>
        );
      }
      throw err;
    }

    return (
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 space-y-4">
        <Card className="p-4 flex items-center justify-between gap-3">
          <div className="space-y-1">
            <Badge variant="default" className="uppercase text-[10px]">
              Read-Only Shared Conversation
            </Badge>
            <h1 className="text-lg font-bold tracking-tight">{conv.title}</h1>
          </div>
          <Link href="/chat" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Back to Chat
          </Link>
        </Card>

        <div className="space-y-3">
          {msgRows.map((m) => (
            <Card
              key={m.id}
              className={`p-4 ${
                m.role === "user"
                  ? "bg-primary/5 border-primary/30"
                  : ""
              }`}
            >
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                {m.role}
              </div>
              <div className="prose prose-sm dark:prose-invert max-w-none leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  });
}
