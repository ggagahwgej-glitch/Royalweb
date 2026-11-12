import 'server-only';
import tls from 'node:tls';
import net from 'node:net';
import { all, get, newId, nowIso, run } from '@/lib/db';
import { readImapPassword, readWarmup } from './warmup';

/**
 * Reply detection over IMAP.
 *
 * A small, purpose-built client: connect (implicit TLS on 993, STARTTLS not
 * attempted), LOGIN, `SELECT INBOX`, `UID SEARCH UNSEEN SINCE <date>`, fetch the
 * headers of a handful of messages, LOGOUT. It does not mark anything as read
 * (`BODY.PEEK`) and never deletes or moves mail — the mailbox stays the user's.
 *
 * A reply pauses the follow-up sequence for that lead: `sendEmail` refuses a
 * `follow_up` template when a reply from that address is on record, and any
 * queued follow-ups are moved to `paused` immediately.
 */

export interface ImapMessage {
  uid: number;
  from: string;
  subject: string;
  date: string | null;
  messageId: string | null;
  snippet: string;
}

class ImapConnection {
  private socket: net.Socket;
  private buffer = '';
  private tag = 0;

  constructor(socket: net.Socket) {
    this.socket = socket;
    this.socket.setEncoding('utf8');
    this.socket.on('data', (chunk: string) => {
      this.buffer += chunk;
    });
  }

  static connect(host: string, port: number, timeoutMs = 15_000): Promise<ImapConnection> {
    return new Promise((resolve, reject) => {
      const options = { host, port, servername: host, timeout: timeoutMs };
      // 993/995 are implicit-TLS ports; anything else is treated as a plain
      // socket so a local relay or test double can be used. STARTTLS upgrade is
      // intentionally not attempted — use 993 for real providers.
      const useTls = port === 993 || port === 995;
      const socket = useTls ? tls.connect(options) : net.connect(options);
      const conn = new ImapConnection(socket);
      const fail = (err: Error) => {
        socket.destroy();
        reject(err);
      };
      socket.once('error', fail);
      socket.once('timeout', () => fail(new Error(`IMAP connection to ${host}:${port} timed out`)));
      socket.once('connect', () => socket.removeListener('error', fail));
      socket.once('secureConnect', () => socket.removeListener('error', fail));
      const waitGreeting = setInterval(() => {
        if (conn.buffer.includes('\r\n')) {
          clearInterval(waitGreeting);
          socket.removeListener('error', fail);
          socket.setTimeout(0);
          socket.setTimeout(timeoutMs);
          if (!/^\* (OK|PREAUTH)/im.test(conn.buffer)) {
            fail(new Error(`IMAP server did not greet: ${conn.buffer.slice(0, 120)}`));
            return;
          }
          resolve(conn);
        }
      }, 25);
    });
  }

  nextTag() {
    this.tag += 1;
    return `a${String(this.tag).padStart(3, '0')}`;
  }

  async command(text: string, timeoutMs = 15_000): Promise<string> {
    const tag = this.nextTag();
    const before = this.buffer.length;
    this.socket.write(`${tag} ${text}\r\n`);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const chunk = this.buffer.slice(before);
      const completion = new RegExp(`^${tag} (OK|NO|BAD)[^\\r\\n]*`, 'im');
      const match = completion.exec(chunk);
      if (match) {
        const response = chunk.slice(0, match.index + match[0].length);
        if (match[1].toUpperCase() !== 'OK') {
          throw new Error(`IMAP ${text.split(' ')[0]} failed: ${match[0].replace(/\r?\n/g, ' ').slice(0, 200)}`);
        }
        return response;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`IMAP ${text.split(' ')[0]} timed out`);
  }

  close() {
    try {
      this.socket.end();
    } catch {
      /* ignore */
    }
  }
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function headerValue(raw: string, name: string): string {
  const re = new RegExp(`^${name}:\\s*(.*(?:\\r?\\n[ \\t].*)*)`, 'im');
  const match = re.exec(raw);
  return match ? match[1].replace(/\r?\n[ \t]+/g, ' ').trim() : '';
}

function addressOf(from: string): string {
  const angle = /<([^>]+)>/.exec(from);
  const candidate = (angle ? angle[1] : from).trim();
  const email = /[^\s<>,;]+@[^\s<>,;]+/.exec(candidate);
  return email ? email[0].toLowerCase() : '';
}

function decodeQuotedPrintable(input: string): string {
  return input.replace(/=([0-9A-F]{2})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function imapDate(days: number): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = new Date(Date.now() - days * 86_400_000);
  return `${String(d.getUTCDate()).padStart(2, '0')}-${months[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

/** Fetch recent unseen messages. Throws with a readable message on any failure. */
export async function fetchRecentMessages(
  config: { host: string; port: number; user: string; pass: string },
  options: { sinceDays?: number; limit?: number } = {}
): Promise<ImapMessage[]> {
  const conn = await ImapConnection.connect(config.host, config.port);
  try {
    await conn.command(`LOGIN ${quote(config.user)} ${quote(config.pass)}`);
    await conn.command('SELECT INBOX');
    const search = await conn.command(
      `UID SEARCH UNSEEN SINCE ${imapDate(options.sinceDays ?? 7)}`,
      20_000
    );
    const ids = (/\* SEARCH([^\r\n]*)/i.exec(search)?.[1] ?? '')
      .trim()
      .split(/\s+/)
      .filter((v) => /^\d+$/.test(v))
      .slice(-Math.max(1, Math.min(options.limit ?? 10, 25)));

    const messages: ImapMessage[] = [];
    for (const uid of ids) {
      const raw = await conn.command(`UID FETCH ${uid} (BODY.PEEK[HEADER] BODY.PEEK[TEXT]<0.0.500>)`);
      // Literal blocks look like: `{123}\r\n<123 bytes>`.
      const literals: string[] = [];
      let index = 0;
      while (index < raw.length) {
        const open = raw.indexOf('{', index);
        if (open === -1) break;
        const close = raw.indexOf('}', open);
        if (close === -1) break;
        const size = Number(raw.slice(open + 1, close));
        if (!Number.isFinite(size)) break;
        const start = raw.indexOf('\r\n', close);
        if (start === -1) break;
        literals.push(raw.slice(start + 2, start + 2 + size));
        index = start + 2 + size;
      }
      const headers = literals[0] ?? '';
      const body = decodeQuotedPrintable(literals[1] ?? '');
      const from = headerValue(headers, 'From');
      messages.push({
        uid: Number(uid),
        from: addressOf(from) || from.slice(0, 200),
        subject: headerValue(headers, 'Subject').slice(0, 300),
        date: headerValue(headers, 'Date') || null,
        messageId: headerValue(headers, 'Message-ID') || null,
        snippet: body.replace(/\s+/g, ' ').trim().slice(0, 400),
      });
    }
    await conn.command('LOGOUT').catch(() => undefined);
    return messages;
  } finally {
    conn.close();
  }
}

export interface ReplyPollResult {
  ok: boolean;
  checked: number;
  newReplies: number;
  pausedFollowups: number;
  error?: string;
}

/**
 * Poll the workspace inbox and record replies. Safe to call repeatedly: replies
 * are deduplicated on (workspace, sender, date, subject).
 */
export async function pollReplies(workspaceId: string): Promise<ReplyPollResult> {
  const settings = readWarmup(workspaceId);
  const password = readImapPassword(workspaceId);
  if (!settings.imapEnabled) return { ok: false, checked: 0, newReplies: 0, pausedFollowups: 0, error: 'IMAP is disabled' };
  if (!settings.imapHost || !settings.imapUser || !password) {
    return {
      ok: false,
      checked: 0,
      newReplies: 0,
      pausedFollowups: 0,
      error: 'IMAP host, username and password are required',
    };
  }

  let messages: ImapMessage[];
  try {
    messages = await fetchRecentMessages({
      host: settings.imapHost,
      port: settings.imapPort,
      user: settings.imapUser,
      pass: password,
    });
  } catch (err) {
    const message = (err as Error).message.slice(0, 400);
    run(
      'UPDATE workspace_email_settings SET imap_last_poll_at = ?, imap_last_error = ? WHERE workspace_id = ?',
      nowIso(),
      message,
      workspaceId
    );
    return { ok: false, checked: 0, newReplies: 0, pausedFollowups: 0, error: message };
  }

  let newReplies = 0;
  let pausedFollowups = 0;
  for (const message of messages) {
    if (!message.from) continue;
    const receivedAt = message.date ? new Date(message.date) : new Date();
    const iso = Number.isNaN(receivedAt.getTime()) ? nowIso() : receivedAt.toISOString();
    const existing = get<{ id: string }>(
      'SELECT id FROM email_replies WHERE workspace_id = ? AND from_address = ? AND subject = ?',
      workspaceId,
      message.from,
      message.subject
    );
    if (existing) continue;

    // Did we email this address from this workspace?
    const sent = get<{ id: string; to_address: string }>(
      `SELECT id, to_address FROM email_messages
        WHERE workspace_id = ? AND lower(to_address) = ? AND status = 'sent'
        ORDER BY created_at DESC LIMIT 1`,
      workspaceId,
      message.from
    );

    const paused = run(
      `UPDATE email_messages SET status = 'paused', error = 'Recipient replied — follow-up sequence paused'
        WHERE workspace_id = ? AND lower(to_address) = ? AND template = 'follow_up'
          AND status IN ('queued','draft')`,
      workspaceId,
      message.from
    );

    run(
      `INSERT INTO email_replies (id, workspace_id, from_address, subject, snippet, received_at, matched_to,
         matched_id, paused_followups, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, from_address, received_at, subject) DO NOTHING`,
      newId(),
      workspaceId,
      message.from,
      message.subject,
      message.snippet,
      iso,
      sent?.to_address ?? null,
      sent?.id ?? null,
      Number(paused.changes),
      nowIso()
    );
    newReplies += 1;
    pausedFollowups += Number(paused.changes);
  }

  run(
    'UPDATE workspace_email_settings SET imap_last_poll_at = ?, imap_last_error = NULL WHERE workspace_id = ?',
    nowIso(),
    workspaceId
  );
  return { ok: true, checked: messages.length, newReplies, pausedFollowups };
}

export function hasReplyFrom(workspaceId: string, email: string): boolean {
  return Boolean(
    get('SELECT 1 FROM email_replies WHERE workspace_id = ? AND lower(from_address) = ?', workspaceId, email.toLowerCase())
  );
}

export function listReplies(workspaceId: string, limit = 20) {
  return all<Record<string, unknown>>(
    'SELECT * FROM email_replies WHERE workspace_id = ? ORDER BY received_at DESC LIMIT ?',
    workspaceId,
    limit
  ).map((r) => ({
    id: String(r.id),
    from: String(r.from_address),
    subject: String(r.subject),
    snippet: String(r.snippet),
    receivedAt: String(r.received_at),
    matched: r.matched_id ? true : false,
    pausedFollowups: Number(r.paused_followups ?? 0),
  }));
}
