"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Bell,
  Check,
  Inbox,
  Layers,
  Plus,
  Radio,
  Search,
  Send,
  Trash2,
  X
} from "lucide-react";
import { useAppContext } from "./providers";
import { AuthGate } from "./ui/auth-gate";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Select } from "./ui/select";
import { Textarea } from "./ui/textarea";
import { SpotlightNavbar } from "./vengeance/spotlight-navbar";

interface NotificationRow {
  id: string;
  channel: string;
  severity: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

interface TopicRow {
  id: string;
  name: string;
  description: string;
  subscriptions: Array<{
    id: string;
    protocol: string;
    endpoint: string;
    enabled: boolean;
  }>;
}

interface QueueRow {
  id: string;
  name: string;
  description: string;
  visibilityTimeoutSec: number;
  maxReceiveCount: number;
  readyCount: number;
  inFlightCount: number;
  deadLetterCount: number;
  ackedCount: number;
}

interface LeasedMessage {
  id: string;
  receiptHandle: string;
  body: Record<string, unknown>;
  receiveCount: number;
}

export function QueuesConsole({
  initialTab = "notifications"
}: {
  initialTab?: "notifications" | "topics" | "queues";
}) {
  const { user, demoEnabled } = useAppContext();
  const [activeTab, setActiveTab] = useState<string>(initialTab);
  const [search, setSearch] = useState("");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [severityFilter, setSeverityFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  const [notifs, setNotifs] = useState<NotificationRow[]>([]);
  const [topics, setTopics] = useState<TopicRow[]>([]);
  const [queues, setQueues] = useState<QueueRow[]>([]);
  const [leased, setLeased] = useState<Record<string, LeasedMessage[]>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [topicName, setTopicName] = useState("");
  const [pubTopicId, setPubTopicId] = useState("");
  const [pubSubject, setPubSubject] = useState("");
  const [pubMessage, setPubMessage] = useState("");
  const [subTopicId, setSubTopicId] = useState("");
  const [subProtocol, setSubProtocol] = useState<"in_app" | "queue" | "workflow" | "webhook">("in_app");
  const [subEndpoint, setSubEndpoint] = useState("all");

  const [queueName, setQueueName] = useState("");
  const [enqQueueId, setEnqQueueId] = useState("");
  const [enqPayload, setEnqPayload] = useState('{"task":"inspect"}');

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const canWriteTopics = user?.role === "manager" || user?.role === "admin";
  const canWriteQueues = user?.role === "admin";

  const readErr = async (res: Response, fallback: string) =>
    ((await res.json().catch(() => ({}))) as { detail?: string } | null)?.detail ?? fallback;

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [nRes, tRes, qRes] = await Promise.all([
        fetch("/api/notifications", { cache: "no-store" }),
        fetch("/api/topics", { cache: "no-store" }),
        fetch("/api/queues", { cache: "no-store" })
      ]);
      const errors: string[] = [];
      if (nRes.ok) {
        const nData = (await nRes.json()) as { notifications: NotificationRow[] };
        setNotifs(nData.notifications ?? []);
      } else {
        errors.push(await readErr(nRes, "Failed to load notifications"));
      }
      if (tRes.ok) {
        const tData = (await tRes.json()) as { topics: TopicRow[] };
        const topicList = tData.topics ?? [];
        setTopics(topicList);
        setPubTopicId((prev) =>
          prev && topicList.some((t) => t.id === prev) ? prev : (topicList[0]?.id ?? "")
        );
        setSubTopicId((prev) =>
          prev && topicList.some((t) => t.id === prev) ? prev : (topicList[0]?.id ?? "")
        );
      } else {
        errors.push(await readErr(tRes, "Failed to load Lutic topics"));
      }
      if (qRes.ok) {
        const qData = (await qRes.json()) as { queues: QueueRow[] };
        const queueList = qData.queues ?? [];
        setQueues(queueList);
        setEnqQueueId((prev) =>
          prev && queueList.some((q) => q.id === prev) ? prev : (queueList[0]?.id ?? "")
        );
      } else {
        errors.push(await readErr(qRes, "Failed to load Lutic queues"));
      }
      if (errors.length > 0) {
        setLoadError(errors[0] ?? "Failed to load queues data");
      }
    } catch {
      setLoadError("Failed to load notifications, topics, and queues");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) void load();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.userId, user?.role]);

  const filteredNotifs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return notifs.filter((n) => {
      if (onlyUnread && n.read) return false;
      if (severityFilter === "urgent" && n.severity !== "critical" && n.severity !== "high") {
        return false;
      }
      if (severityFilter === "normal" && (n.severity === "critical" || n.severity === "high")) {
        return false;
      }
      if (!q) return true;
      return (
        n.title.toLowerCase().includes(q) ||
        n.body.toLowerCase().includes(q) ||
        n.severity.toLowerCase().includes(q)
      );
    });
  }, [notifs, onlyUnread, severityFilter, search]);

  const filteredTopics = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return topics;
    return topics.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q)
    );
  }, [topics, search]);

  const filteredQueues = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return queues;
    return queues.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q)
    );
  }, [queues, search]);

  if (!user) {
    return (
      <AuthGate
        title="Sign in to view Notifications & Queues"
        description="Operational notifications, Lutic pub/sub topics, and Lutic dispatch queues require an authenticated session."
      />
    );
  }

  const unreadCount = notifs.filter((n) => !n.read).length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b border-border pb-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Lutic Topics &amp; Dispatch
          </div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            <span>Notifications &amp; Queues</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Real-time notification feed, Lutic pub/sub fan-out topics, and Lutic dispatch queues with visibility timeouts &amp; DLQ.
          </p>
        </div>

        <div className="relative w-full sm:w-auto">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search messages, topics, queues..."
            aria-label="Search notifications, topics, and queues"
            className="pl-8 w-full sm:w-64"
          />
        </div>
      </div>

      {notice && (
        <div className="rounded-md border border-border bg-muted/60 px-3.5 py-2 text-xs font-medium flex items-center justify-between gap-2 min-w-0">
          <span className="min-w-0 break-words">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss messaging notice"
            className="shrink-0"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {!loading && loadError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive flex items-center justify-between gap-3 min-w-0"
        >
          <span className="min-w-0 break-words">{loadError}</span>
          <Button variant="outline" size="sm" onClick={() => void load()} className="shrink-0">
            Retry
          </Button>
        </div>
      )}

      <SpotlightNavbar
        activeId={activeTab}
        onSelect={setActiveTab}
        items={[
          {
            id: "notifications",
            label: "Notification Feed",
            badge: unreadCount,
            icon: <Inbox className="h-3.5 w-3.5" />
          },
          {
            id: "topics",
            label: "Lutic Topics",
            badge: topics.length,
            icon: <Radio className="h-3.5 w-3.5" />
          },
          {
            id: "queues",
            label: "Lutic Queues",
            badge: queues.length,
            icon: <Layers className="h-3.5 w-3.5" />
          }
        ]}
      />

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-lg border border-border bg-muted animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {activeTab === "notifications" && (
            <Card className="p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold">
                    Notification Feed ({unreadCount} unread)
                  </h2>
                  <Button
                    variant={onlyUnread ? "default" : "outline"}
                    size="sm"
                    onClick={() => setOnlyUnread((v) => !v)}
                  >
                    Unread only
                  </Button>
                  <Select
                    aria-label="Filter notification severity"
                    value={severityFilter}
                    onChange={(e) => setSeverityFilter(e.target.value)}
                    className="h-8"
                  >
                    <option value="all">All Severities</option>
                    <option value="urgent">Critical / High</option>
                    <option value="normal">Medium / Info</option>
                  </Select>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      const res = await fetch("/api/notifications", {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ markAll: true, read: true })
                      });
                      if (res.ok) await load();
                      else setNotice(await readErr(res, "Failed to mark notifications read"));
                    } catch {
                      setNotice("Failed to mark notifications read");
                    }
                  }}
                >
                  Mark All Read
                </Button>
              </div>

              <div className="grid gap-2.5 md:grid-cols-2">
                {filteredNotifs.length === 0 ? (
                  <div className="md:col-span-2 text-xs text-muted-foreground py-6 text-center">
                    {notifs.length === 0
                      ? (loadError ?? "No notifications recorded for this tenant yet.")
                      : "No matching notifications."}
                  </div>
                ) : (
                  filteredNotifs.slice(0, 20).map((n) => (
                    <div
                      key={n.id}
                      className={`rounded-md border p-3 text-xs flex items-start justify-between gap-2 min-w-0 ${
                        n.read
                          ? "border-border/60 opacity-75"
                          : "border-primary/40 bg-primary/5"
                      }`}
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge
                            variant={
                              n.severity === "critical" || n.severity === "high"
                                ? "destructive"
                                : "secondary"
                            }
                            className="uppercase text-[10px] shrink-0"
                          >
                            {n.severity}
                          </Badge>
                          <span className="font-semibold truncate">{n.title}</span>
                        </div>
                        <div className="text-muted-foreground break-words">{n.body}</div>
                      </div>
                      {!n.read && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="shrink-0"
                          onClick={async () => {
                            try {
                              const res = await fetch("/api/notifications", {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ id: n.id, read: true })
                              });
                              if (res.ok) await load();
                              else setNotice(await readErr(res, "Failed to mark notification read"));
                            } catch {
                              setNotice("Failed to mark notification read");
                            }
                          }}
                        >
                          Read
                        </Button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </Card>
          )}

          {activeTab === "topics" && (
            <div className={canWriteTopics ? "grid gap-6 lg:grid-cols-3" : "space-y-4"}>
              <Card className={`${canWriteTopics ? "lg:col-span-2" : ""} p-4 space-y-3 min-w-0`}>
                <h2 className="text-sm font-semibold flex items-center gap-1.5">
                  <Radio className="h-4 w-4 text-primary" />
                  <span>Lutic Topics &amp; Subscriptions ({filteredTopics.length})</span>
                </h2>
                {filteredTopics.length === 0 ? (
                  <div className="py-6 text-center text-xs text-muted-foreground">
                    {topics.length === 0
                      ? (loadError ?? "No Lutic topics created for this tenant yet.")
                      : "No Lutic topics match your search."}
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {filteredTopics.map((t) => (
                      <div key={t.id} className="rounded-md border border-border p-3 text-xs space-y-1.5 min-w-0">
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <span className="font-semibold truncate">{t.name}</span>
                          <code className="text-[11px] font-mono text-muted-foreground shrink-0">{t.id}</code>
                        </div>
                        <div className="text-muted-foreground break-words">{t.description}</div>
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {t.subscriptions.map((s) => (
                            <Badge key={s.id} variant="secondary" className="font-mono text-[10px] max-w-full break-all whitespace-normal">
                              {s.protocol} → {s.endpoint}
                              {s.protocol === "webhook" && !demoEnabled ? " (unavailable in prod)" : ""}
                            </Badge>
                          ))}
                          {t.subscriptions.length === 0 && (
                            <span className="text-[11px] text-muted-foreground">No subscriptions</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {canWriteTopics && (
                <div className="space-y-4 min-w-0">
                  <Card className="p-4">
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (!topicName.trim()) return;
                        try {
                          const res = await fetch("/api/topics", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ name: topicName.trim() })
                          });
                          if (res.ok) {
                            setTopicName("");
                            setNotice("Topic created");
                            await load();
                          } else {
                            setNotice(await readErr(res, "Failed to create topic"));
                          }
                        } catch {
                          setNotice("Failed to create topic");
                        }
                      }}
                      className="space-y-2.5"
                    >
                      <div className="text-xs font-semibold flex items-center gap-1">
                        <Plus className="h-3.5 w-3.5 text-primary" />
                        <span>Create Topic</span>
                      </div>
                      <div className="flex gap-2">
                        <Input
                          value={topicName}
                          onChange={(e) => setTopicName(e.target.value)}
                          placeholder="topic-name"
                          aria-label="New topic name"
                          className="flex-1 min-w-0"
                        />
                        <Button type="submit" size="sm">
                          Add
                        </Button>
                      </div>
                    </form>
                  </Card>

                  <Card className="p-4">
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (!pubTopicId || !pubMessage.trim()) return;
                        try {
                          const res = await fetch(`/api/topics/${pubTopicId}/publish`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              subject: pubSubject || "Lutic Broadcast",
                              message: pubMessage
                            })
                          });
                          if (res.ok) {
                            const result = (await res.json()) as { deliveryFailures?: Array<{ reason: string }> };
                            const failures = result.deliveryFailures?.length ?? 0;
                            setPubSubject("");
                            setPubMessage("");
                            setNotice(failures ? `Published with ${failures} unavailable ${failures === 1 ? "delivery" : "deliveries"}` : "Published message to topic");
                            await load();
                          } else {
                            setNotice(await readErr(res, "Failed to publish message"));
                          }
                        } catch {
                          setNotice("Failed to publish message");
                        }
                      }}
                      className="space-y-2.5"
                    >
                      <div className="text-xs font-semibold flex items-center gap-1">
                        <Send className="h-3.5 w-3.5 text-primary" />
                        <span>Publish to Topic</span>
                      </div>
                      <Select
                        aria-label="Select publish topic"
                        value={pubTopicId}
                        onChange={(e) => setPubTopicId(e.target.value)}
                        disabled={topics.length === 0}
                        className="w-full"
                      >
                        {topics.length === 0 ? (
                          <option value="">No topics available</option>
                        ) : (
                          topics.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))
                        )}
                      </Select>
                      <Input
                        value={pubSubject}
                        onChange={(e) => setPubSubject(e.target.value)}
                        placeholder="Subject"
                        aria-label="Message subject"
                      />
                      <Textarea
                        rows={2}
                        value={pubMessage}
                        onChange={(e) => setPubMessage(e.target.value)}
                        placeholder="Notification message"
                        aria-label="Notification message"
                      />
                      <Button type="submit" className="w-full" disabled={topics.length === 0 || !pubTopicId}>
                        Publish Message
                      </Button>
                    </form>
                  </Card>

                  <Card className="p-4">
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (!subTopicId || !subEndpoint.trim()) return;
                        try {
                          const res = await fetch(`/api/topics/${subTopicId}/subscribe`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ protocol: subProtocol, endpoint: subEndpoint.trim() })
                          });
                          if (res.ok) {
                            setNotice("Subscription added");
                            await load();
                          } else {
                            setNotice(await readErr(res, "Subscription failed"));
                          }
                        } catch {
                          setNotice("Subscription failed");
                        }
                      }}
                      className="space-y-2.5"
                    >
                      <div className="text-xs font-semibold">Subscribe Endpoint</div>
                      <Select
                        aria-label="Select subscription topic"
                        value={subTopicId}
                        onChange={(e) => setSubTopicId(e.target.value)}
                        disabled={topics.length === 0}
                        className="w-full"
                      >
                        {topics.length === 0 ? (
                          <option value="">No topics available</option>
                        ) : (
                          topics.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))
                        )}
                      </Select>
                      <div className="grid grid-cols-2 gap-2">
                        <Select
                          aria-label="Subscription protocol"
                          value={subProtocol}
                          onChange={(e) =>
                            setSubProtocol(
                              e.target.value as "in_app" | "queue" | "workflow" | "webhook"
                            )
                          }
                          className="min-w-0"
                        >
                          <option value="in_app">in_app</option>
                          <option value="queue">queue</option>
                          <option value="workflow">workflow</option>
                          <option value="webhook" disabled={!demoEnabled}>
                            {demoEnabled ? "webhook" : "webhook (demo only)"}
                          </option>
                        </Select>
                        <Input
                          value={subEndpoint}
                          onChange={(e) => setSubEndpoint(e.target.value)}
                          placeholder="all or ID"
                          aria-label="Subscription endpoint"
                          className="font-mono min-w-0"
                        />
                      </div>
                      <Button type="submit" variant="outline" className="w-full" disabled={topics.length === 0 || !subTopicId}>
                        Subscribe
                      </Button>
                    </form>
                  </Card>
                </div>
              )}
            </div>
          )}

          {activeTab === "queues" && (
            <div className={canWriteQueues ? "grid gap-6 lg:grid-cols-3" : "space-y-4"}>
              <Card className={`${canWriteQueues ? "lg:col-span-2" : ""} p-4 space-y-3 min-w-0`}>
                <h2 className="text-sm font-semibold flex items-center gap-1.5">
                  <Layers className="h-4 w-4 text-primary" />
                  <span>Lutic Dispatch Queues ({filteredQueues.length})</span>
                </h2>
                {filteredQueues.length === 0 ? (
                  <div className="py-6 text-center text-xs text-muted-foreground">
                    {queues.length === 0
                      ? (loadError ?? "No queues created for this tenant yet.")
                      : "No queues match your search."}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredQueues.map((q) => (
                      <div key={q.id} className="rounded-md border border-border p-3 text-xs space-y-2 min-w-0">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0 break-words">
                            <span className="font-semibold">{q.name}</span>{" "}
                            <code className="font-mono text-muted-foreground">({q.id})</code>
                          </div>
                          <div className="flex gap-1.5 font-mono tabular-nums">
                            <Badge variant="success">ready: {q.readyCount}</Badge>
                            <Badge variant="warning">in-flight: {q.inFlightCount}</Badge>
                            <Badge variant="destructive">DLQ: {q.deadLetterCount}</Badge>
                          </div>
                        </div>

                        {canWriteQueues && (
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={async () => {
                                try {
                                  const res = await fetch(`/api/queues/${q.id}/receive`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ maxMessages: 5 })
                                  });
                                  if (res.ok) {
                                    const d = (await res.json()) as { messages: LeasedMessage[] };
                                    setLeased((prev) => ({ ...prev, [q.id]: d.messages ?? [] }));
                                    await load();
                                  } else {
                                    setNotice(await readErr(res, `Failed to receive from ${q.name}`));
                                  }
                                } catch {
                                  setNotice(`Failed to receive from ${q.name}`);
                                }
                              }}
                            >
                              Receive Messages
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-destructive"
                              onClick={async () => {
                                try {
                                  const res = await fetch(`/api/queues/${q.id}/purge`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({})
                                  });
                                  if (res.ok) {
                                    setLeased((prev) => ({ ...prev, [q.id]: [] }));
                                    setNotice(`Purged queue ${q.name}`);
                                    await load();
                                  } else {
                                    setNotice(await readErr(res, `Failed to purge ${q.name}`));
                                  }
                                } catch {
                                  setNotice(`Failed to purge ${q.name}`);
                                }
                              }}
                            >
                              <Trash2 className="h-3 w-3" />
                              <span>Purge</span>
                            </Button>
                          </div>
                        )}

                        {(leased[q.id] ?? []).length > 0 && (
                          <div className="space-y-1.5 pt-2 border-t border-border/50">
                            {(leased[q.id] ?? []).map((msg) => (
                              <div
                                key={msg.id}
                                className="flex items-center justify-between gap-2 rounded bg-muted/60 p-2 min-w-0"
                              >
                                <code className="truncate font-mono min-w-0 flex-1">{JSON.stringify(msg.body)}</code>
                                <Button
                                  size="sm"
                                  className="bg-emerald-600 hover:bg-emerald-700 text-white h-7 shrink-0"
                                  onClick={async () => {
                                    try {
                                      const res = await fetch(`/api/queues/${q.id}/ack`, {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({
                                          messageId: msg.id,
                                          receiptHandle: msg.receiptHandle
                                        })
                                      });
                                      if (res.ok) {
                                        setLeased((prev) => ({
                                          ...prev,
                                          [q.id]: (prev[q.id] ?? []).filter((x) => x.id !== msg.id)
                                        }));
                                        await load();
                                      } else {
                                        setNotice(await readErr(res, "Failed to ack message"));
                                      }
                                    } catch {
                                      setNotice("Failed to ack message");
                                    }
                                  }}
                                >
                                  <Check className="h-3 w-3" />
                                  <span>Ack</span>
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {canWriteQueues && (
                <div className="space-y-4 min-w-0">
                  <Card className="p-4">
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (!queueName.trim()) return;
                        try {
                          const res = await fetch("/api/queues", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ name: queueName.trim(), maxRetries: 3 })
                          });
                          if (res.ok) {
                            setQueueName("");
                            setNotice("Queue created");
                            await load();
                          } else {
                            setNotice(await readErr(res, "Queue creation failed"));
                          }
                        } catch {
                          setNotice("Queue creation failed");
                        }
                      }}
                      className="space-y-2.5"
                    >
                      <div className="text-xs font-semibold">Create Lutic Queue</div>
                      <div className="flex gap-2">
                        <Input
                          value={queueName}
                          onChange={(e) => setQueueName(e.target.value)}
                          placeholder="queue-name"
                          aria-label="New queue name"
                          className="flex-1 min-w-0"
                        />
                        <Button type="submit" size="sm">
                          Create
                        </Button>
                      </div>
                    </form>
                  </Card>

                  <Card className="p-4">
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (!enqQueueId) return;
                        let payload: Record<string, unknown>;
                        try {
                          payload = JSON.parse(enqPayload || "{}") as Record<string, unknown>;
                        } catch {
                          setNotice("Invalid JSON payload");
                          return;
                        }
                        try {
                          const res = await fetch(`/api/queues/${enqQueueId}/enqueue`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ payload })
                          });
                          if (res.ok) {
                            setNotice("Message enqueued");
                            await load();
                          } else {
                            setNotice(await readErr(res, "Failed to enqueue message"));
                          }
                        } catch {
                          setNotice("Failed to enqueue message");
                        }
                      }}
                      className="space-y-2.5"
                    >
                      <div className="text-xs font-semibold">Enqueue Message</div>
                      <Select
                        aria-label="Select target queue"
                        value={enqQueueId}
                        onChange={(e) => setEnqQueueId(e.target.value)}
                        disabled={queues.length === 0}
                        className="w-full"
                      >
                        {queues.length === 0 ? (
                          <option value="">No queues available</option>
                        ) : (
                          queues.map((q) => (
                            <option key={q.id} value={q.id}>
                              {q.name}
                            </option>
                          ))
                        )}
                      </Select>
                      <Textarea
                        rows={3}
                        value={enqPayload}
                        onChange={(e) => setEnqPayload(e.target.value)}
                        aria-label="Message JSON payload"
                        className="font-mono"
                      />
                      <Button type="submit" className="w-full" disabled={queues.length === 0 || !enqQueueId}>
                        Enqueue
                      </Button>
                    </form>
                  </Card>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
