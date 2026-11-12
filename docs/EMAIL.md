# Email outreach — setup, deliverability and ethics

ROYALWEB sends email **from an address you own and verify**. It does not invent mailboxes, rotate senders,
spoof display names or hide who is writing. Those tricks are what mailbox providers detect, and they are what
makes a legitimate studio look like a scammer.

---

## 1. What you need

| Item | Why | Where |
|---|---|---|
| SMTP host + port | The mail server that accepts your message | Your mail host or transactional provider |
| SMTP username + app password | Authentication. Use an **app password**, never your login password | Provider dashboard |
| From address on your own domain | The strongest inbox-placement signal | DNS / mailbox settings |
| Postal address | Required in commercial email footers in most jurisdictions | Settings → Email |
| Unsubscribe URL | One-click opt-out + `List-Unsubscribe` header | Your website (a simple page is enough) |
| SPF, DKIM, DMARC | Proves the message is authorised and unaltered | DNS |

Useful providers: Google Workspace, Zoho Mail, Fastmail, Migadu, Postmark, Resend, Amazon SES, Mailgun.
Gmail/Yahoo free mailboxes work technically but hurt deliverability and often cap volume — avoid as the sender
for outreach.

### Example configuration

```
SMTP host      smtp.yourdomain.com
Port           587        (STARTTLS)  ·  465 = implicit TLS
Username       hello@yourdomain.com
Password       app password (16 chars, no spaces)
From name      ROYALWEB
From address   hello@yourdomain.com
Reply-to       hello@yourdomain.com
Postal address GS Road, Guwahati, Assam 781005, India
Unsubscribe    https://yourdomain.com/unsubscribe
```

Press **Save & test login** — ROYALWEB performs a real SMTP handshake and reports the server's answer. If it
says "configured" without a successful handshake, it is lying; it does not do that.

---

## 2. DNS records that actually matter

**SPF** (one record per domain, includes every sender):

```
TXT @  "v=spf1 include:_spf.google.com ~all"
```

**DKIM** — copy the selector and public key from your provider:

```
TXT selector._domainkey  "v=DKIM1; k=rsa; p=MIIBIjANBg…"
```

**DMARC** — start with monitoring, then tighten:

```
TXT _dmarc  "v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com; adkim=s; aspf=s"
```

Move to `p=quarantine` once reports are clean. **PTR/rDNS** should resolve to your sending host if you run your
own mail server. No amount of app-side polish compensates for missing SPF/DKIM/DMARC.

---

## 3. What the app enforces

- **Compliance guard:** a message with no unsubscribe URL *and* no "reply stop / opt out" line is rejected
  before any SMTP call.
- **Permanent suppression:** an address added to the opt-out list is blocked forever (checked before sending,
  enforced in the database).
- **Honest status:** `sent` means the SMTP server accepted the message. Rejections and transport errors are
  stored with the provider's own code (`EAUTH`, `ECONNECTION`, `ETIMEDOUT`…). Delivery to the inbox is never
  claimed.
- **No tracking by default:** no pixels, no remote images, no link rewriting.
- **Rate limit:** 20 sends per 10 minutes per admin, so a mistake cannot become a blast.
- **Audit:** every send and suppression is in the audit log; message bodies are stored locally for your records.
- **List-Unsubscribe + List-Unsubscribe-Post** headers when an unsubscribe URL is configured.

---

## 4. Outreach rules (why this is not spam)

1. Email only businesses you can name a reason for contacting — they enquired, you met them, or they publicly
   list themselves as open to suppliers.
2. No purchased or scraped lists. No re-mailing someone who opted out.
3. One follow-up maximum unless they reply. Then stop.
4. Identify yourself, your business and how you got the address.
5. Make opting out one word, and honour it the same day (use **Suppress this address** in History).
6. No false "re:" subjects, no fake invoices, no "URGENT" subject lines, no attachments on a first email.

These are also the practical requirements of anti-spam law in most markets (India: IT Act/SPAM regulations;
EU/UK: GDPR + PECR; US: CAN-SPAM; Canada: CASL). When in doubt, ask for consent in writing.

---

## 5. Testing without touching a real inbox

`npm run acceptance` starts a local SMTP test double on `127.0.0.1:2525`, configures ROYALWEB against it, sends
a real message and asserts:

- SMTP login verification succeeds,
- the draft contains an opt-out line,
- a message without any opt-out is blocked before SMTP,
- the captured message contains the recipient and subject,
- `List-Unsubscribe` headers are present,
- after suppression, further sends are refused with `409`.

That proves the sending path end to end without emailing anyone.

---

## 6. Frequently asked

**Can ROYALWEB create an email account for me?** No — and any tool that offers to is creating an identity you
cannot verify. Buy a domain, create the mailbox at your host, add the DNS records above, then paste the SMTP
credentials here.

**Can it send from `gmail.com`?** Technically yes (app password), but it damages deliverability and breaks
DMARC alignment for your domain. Use your domain.

**Does it read replies?** Not yet. Replies arrive in your normal inbox; use the reply to decide, then suppress
the address if they opt out.

**Will it warm up a new domain?** No. Start with low volume to known contacts, keep bounce rates low, and let
reputation build over weeks. Volume tricks are how domains get blacklisted.
