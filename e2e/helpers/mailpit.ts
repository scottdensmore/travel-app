import { APIRequestContext, expect } from '@playwright/test';

const mailpitUrl = process.env.MAILPIT_HTTP_URL ?? 'http://127.0.0.1:8025';

type MailpitSummary = {
  ID: string;
  Subject: string;
  To: Array<{ Address: string }>;
};

export async function authEmailLink(
  request: APIRequestContext,
  email: string,
  subject: string,
  pathname: string
): Promise<string> {
  let message: MailpitSummary | undefined;
  await expect.poll(async () => {
    const response = await request.get(`${mailpitUrl}/api/v1/search`, {
      params: { query: `to:${email}` }
    });
    if (!response.ok()) return false;
    const payload = await response.json() as { messages?: MailpitSummary[] };
    message = payload.messages?.find(candidate =>
      candidate.Subject === subject
      && candidate.To.some(recipient => recipient.Address.toLowerCase() === email.toLowerCase())
    );
    return Boolean(message);
  }, { timeout: 10_000, intervals: [100, 250, 500, 1_000] }).toBe(true);

  const bodyResponse = await request.get(`${mailpitUrl}/view/${message!.ID}.txt`);
  expect(bodyResponse.ok()).toBe(true);
  const body = await bodyResponse.text();
  const urls = body.match(/https?:\/\/[^\s]+/g) ?? [];
  const link = urls.find(candidate => new URL(candidate).pathname === pathname);
  if (!link) throw new Error(`No ${pathname} link found in authentication email.`);
  return link;
}

export async function deleteAuthEmails(request: APIRequestContext, email: string): Promise<void> {
  await request.delete(`${mailpitUrl}/api/v1/search`, {
    params: { query: `to:${email}` }
  });
}
