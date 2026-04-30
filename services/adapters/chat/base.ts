// ChatAdapter — conversational support / community channels.
// Per Doc 6 §14. Wraps Chatwoot / Discord / Telegram / Intercom-style products.

export interface ChatThread {
  id: string;
  channel: string;
  status: "open" | "pending" | "resolved" | "spam";
  customerId?: string;
  assigneeId?: string;
  lastMessageAt?: string;   // ISO-8601
  unreadCount?: number;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  authorId: string;
  authorKind: "customer" | "agent" | "bot";
  body: string;
  attachments?: Array<{ url: string; contentType: string; filename?: string }>;
  createdAt: string;
}

export interface ChatAdapter {
  readonly vendor: string;
  readonly workspaceId: string;

  listThreads(filters?: { status?: ChatThread["status"]; assigneeId?: string; limit?: number }):
    Promise<ChatThread[]>;
  getThread(id: string): Promise<ChatThread | null>;
  listMessages(threadId: string, opts?: { cursor?: string; limit?: number }):
    Promise<{ messages: ChatMessage[]; nextCursor?: string }>;
  reply(threadId: string, body: string, opts?: { isPrivateNote?: boolean }): Promise<string>;
  setStatus(threadId: string, status: ChatThread["status"]): Promise<void>;
  assign(threadId: string, assigneeId: string): Promise<void>;
  healthCheck(): Promise<{ ok: boolean; error?: { code: string; message: string } }>;
}
