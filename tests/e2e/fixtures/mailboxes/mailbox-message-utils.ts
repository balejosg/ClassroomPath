import type { MailTmMessage } from '../mailbox-provider.js';

export function matchesLink(link: string, urlIncludes?: string, urlPattern?: RegExp): boolean {
  if (urlIncludes && !link.includes(urlIncludes)) {
    return false;
  }
  if (urlPattern && !urlPattern.test(link)) {
    return false;
  }
  return true;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getCombinedBody(message: MailTmMessage): string {
  const text = message.text ?? '';
  const html = (message.html ?? []).join('\n');
  const htmlAsText = stripHtml(html);
  return [text, html, htmlAsText].filter(Boolean).join('\n');
}

export function extractLinksFromMessage(message: MailTmMessage): string[] {
  const combined = getCombinedBody(message).replace(/&amp;/g, '&');
  const matches = combined.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  return [...new Set(matches.map((url) => url.replace(/[),.;]+$/g, '')))];
}

export function extractOtpFromMessage(
  message: MailTmMessage,
  pattern: RegExp = /\b\d{6}\b/
): string | null {
  const combined = getCombinedBody(message);
  return combined.match(pattern)?.[0] ?? null;
}
