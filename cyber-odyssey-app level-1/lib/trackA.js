// Track A — "Scam Bazaar": a spoofed HR email, discovered by the whole
// crew as a single evidence file. All three questions read the SAME
// artifact from three different angles, which is why they're offered
// together rather than gated one-behind-the-other:
//   A1 — find the mail server that actually sent it (Received: chain)
//   A2 — find where its "verify your severance" link really goes (open redirect)
//   A3 — explain why its SPF still "passes" despite being spoofed (DMARC alignment)
//
// Cover story ("the masala"): Ithaca Holdings' all-staff list gets an
// email that LOOKS like HR fat-fingered a reply-all — a restructuring
// spreadsheet attached, a "please ignore, wasn't meant for everyone"
// apology, and a link to "review your individual severance details."
// Panic + curiosity is the whole attack; the job is to prove it never
// came from Ithaca Holdings at all.
//
// The attacker domain is consistent across all three questions on
// purpose — ithacah01dings.com ("0"+"1" standing in for "ol") — so
// solving one question primes a team to recognize it faster in the next,
// same as a real incident where one IOC (indicator of compromise) leads
// to the others.
//
// All IPs are RFC 5737 documentation-range addresses (203.0.113.0/24,
// 198.51.100.0/24) — fictional on purpose, never a real routable host.

const REAL_DOMAIN = "ithacaholdings.com";
const ATTACKER_DOMAIN = "ithacah01dings.com";
const ATTACKER_IP = "203.0.113.77";
const ATTACKER_HOST = `smtp-out.${ATTACKER_DOMAIN}`;

function norm(s) {
  return String(s || "").trim().toLowerCase();
}

// A1: origin IP and hostname (ignoring fake bottom line decoy if present)
function checkA1(answer) {
  const text = norm(answer);
  const hasIp = text.includes(ATTACKER_IP);
  const hasHost = text.includes(ATTACKER_HOST.toLowerCase());
  return hasIp && hasHost;
}

// A2: chained open redirect destination URL / domain path
function checkA2(answer) {
  const text = norm(answer);
  return text.includes("ithacah01dings.com/verify") || text.includes("https://ithacah01dings.com/verify");
}

// A3: legitimate domain in header.from that failed DMARC alignment
function checkA3(answer) {
  const text = norm(answer);
  return text.includes(REAL_DOMAIN) && !text.includes("ithacah01dings");
}

// A4: hex-encoded SOC case reference string (49482d534f432d33373139 -> IH-SOC-3719)
function checkA4(answer) {
  const text = norm(answer).toUpperCase();
  return text === "IH-SOC-3719" || text === "IH-SOC3719" || text === "IH - SOC - 3719";
}

const QUESTIONS = {
  A1: {
    code: "A1",
    points: 5,
    title: "Spoofed Relay vs True Origin Server",
    prompt:
      "The header stack contains a fake bottom-most Received: line claiming an internal IP (10.0.0.1) injected by the sender to fool automated scanners. " +
      "Identify the TRUE first external internet IP address AND hostname that actually handed the message to the perimeter gateway.",
    placeholder: "e.g. 203.0.113.77 / smtp-out.ithacah01dings.com",
    check: checkA1,
  },
  A2: {
    code: "A2",
    points: 5,
    title: "Follow the Chained Open Redirect Target",
    prompt:
      "The email's link routes through a double-nested open redirect parameter (url=gateway.net?next=...). " +
      "Automated scanners stop at the intermediate gateway. What is the FINAL destination URL at the end of the entire redirect chain?",
    placeholder: "e.g. https://ithacah01dings.com/verify",
    check: checkA2,
  },
  A3: {
    code: "A3",
    points: 10,
    title: "DMARC Header Domain Alignment Audit",
    prompt:
      "The envelope sender is set to smtp.mailfrom=sub.ithacah01dings.com while the visible sender is set to header.from=ithacaholdings.com. " +
      "Even under relaxed DMARC alignment, this fails. What is the EXACT legitimate organization domain listed in the visible header.from field?",
    placeholder: "e.g. ithacaholdings.com",
    check: checkA3,
  },
  A4: {
    code: "A4",
    points: 10,
    title: "Decode Hex-Encoded SOC Reference",
    prompt:
      "The email header block contains a hex-encoded ASCII SOC case reference string: '49482d534f432d33373139'. " +
      "Convert these hex byte values into plain text ASCII. What is the full SOC case reference string?",
    placeholder: "e.g. IH-SOC-XXXX",
    check: checkA4,
  },
};

const { MAX_ATTEMPTS } = require("./trackShared");

const QUESTION_ORDER = ["A1", "A2", "A3", "A4"];
const TOTAL_POINTS = QUESTION_ORDER.reduce((sum, k) => sum + QUESTIONS[k].points, 0);

function checkAnswer(questionCode, answer) {
  const q = QUESTIONS[questionCode];
  if (!q) return false;
  return q.check(answer);
}

function buildEvidenceEmail() {
  return `Return-Path: <hr-noreply@${REAL_DOMAIN}>
Delivered-To: allstaff@${REAL_DOMAIN}
X-SOC-Case-Hex: 49482d534f432d33373139
Received: by 10.28.55.10 with SMTP id x10csp998877;
        Thu, 12 Feb 2026 09:14:02 -0800 (PST)
Received: from mail-relay-internal.${REAL_DOMAIN} (mail-relay-internal.${REAL_DOMAIN} [10.20.4.11])
        by mx1.${REAL_DOMAIN} (Postfix) with ESMTPS id 7F3A2C1B4
        for <allstaff@${REAL_DOMAIN}>; Thu, 12 Feb 2026 09:13:58 -0800 (PST)
Received: from mailgw03.trusted-vendor-relay.net (mailgw03.trusted-vendor-relay.net [198.51.100.44])
        by mail-relay-internal.${REAL_DOMAIN} with ESMTP id 88C102D9
        for <allstaff@${REAL_DOMAIN}>; Thu, 12 Feb 2026 09:13:52 -0800 (PST)
Received: from ${ATTACKER_HOST} (${ATTACKER_HOST} [${ATTACKER_IP}])
        by mailgw03.trusted-vendor-relay.net with ESMTP id 4B9E10AA
        for <allstaff@${REAL_DOMAIN}>; Thu, 12 Feb 2026 09:13:44 -0800 (PST)
Received: from mail.internal-corp.local (mail.internal-corp.local [10.0.0.1])
        by ${ATTACKER_HOST} with ESMTP id 1A2B3C4D; Thu, 12 Feb 2026 09:13:40 -0800 (PST)
Authentication-Results: mx1.${REAL_DOMAIN};
       spf=pass smtp.mailfrom=sub.${ATTACKER_DOMAIN};
       dkim=none;
       dmarc=fail (p=reject) header.from=${REAL_DOMAIN}
From: "HR — People Operations" <hr-noreply@${REAL_DOMAIN}>
Reply-To: hr-restructuring@${ATTACKER_DOMAIN}
To: allstaff@${REAL_DOMAIN}
Subject: [ACCIDENTAL SEND — PLEASE IGNORE] Re: Confidential_Restructuring_&_Severance_Pool_2026.xlsx
Date: Thu, 12 Feb 2026 09:13:40 -0800
Content-Type: multipart/mixed; boundary="000000000000a1b2c3"

--000000000000a1b2c3
Content-Type: text/plain; charset="UTF-8"

Please disregard — this was meant for the leadership distribution list
only, not all-staff. I'm so sorry for the panic this may cause. Please do
NOT forward this internally or externally.

If your name appears on the attached sheet and you have questions about
your status, HR has set up a secure portal to review your individual
severance details before anything is finalized:

  https://${REAL_DOMAIN}/track/click?url=https%3A%2F%2Fgateway-auth.net%2Flogin%3Fredirect%3Dhttps%253A%252F%252F${ATTACKER_DOMAIN}%252Fverify

Again, apologies — this should never have gone to the full list.

— People Operations

--000000000000a1b2c3
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; name="Confidential_Restructuring_&_Severance_Pool_2026.xlsx"
Content-Disposition: attachment; filename="Confidential_Restructuring_&_Severance_Pool_2026.xlsx"
Content-Transfer-Encoding: base64

[attachment omitted for this exercise — the header block above is the evidence]
--000000000000a1b2c3--
`;
}

module.exports = {
  QUESTIONS,
  QUESTION_ORDER,
  TOTAL_POINTS,
  MAX_ATTEMPTS,
  checkAnswer,
  buildEvidenceEmail,
  REAL_DOMAIN,
  ATTACKER_DOMAIN,
};
