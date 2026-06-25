#!/usr/bin/env node
/**
 * rrd-email-security.mjs — inbound email safety helpers for Revenue Recovery Desk.
 *
 * Treat every inbound email as untrusted data. These helpers strip transport/HTML
 * noise, detect prompt-injection/social-engineering attempts, and provide a safe
 * string for deterministic parsers. They do NOT make any email authoritative.
 */

const MAX_INBOUND_CHARS = 12000;

export const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions|rules|prompts|messages)/i,
  /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions|rules|prompts|messages)/i,
  /forget\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions|rules|prompts|messages)/i,
  /system\s*prompt/i,
  /developer\s*(message|prompt|instructions?)/i,
  /you\s+are\s+now\s+(in|a|an)\s*/i,
  /act\s+as\s+(system|developer|admin|operator|root)/i,
  /reveal\s+(your\s+)?(prompt|instructions|secrets|api\s*keys?|tokens?)/i,
  /print\s+(your\s+)?(prompt|instructions|secrets|api\s*keys?|tokens?)/i,
  /exfiltrat(e|ion)|data\s*exfil/i,
  /run\s+(this\s+)?(command|shell|terminal|bash|python|script)/i,
  /curl\s+https?:|wget\s+https?:|rm\s+-rf|sudo\s+/i,
  /approve\s+all|auto[-\s]?approve|bypass\s+(approval|guardrails?|security)/i,
  /send\s+(all|every)\s+(emails?|messages?)\s+(now|immediately)/i,
  /change\s+(bank|payment|wire|sort\s*code|account)\s+(details|instructions)/i,
  /update\s+(bank|payment|wire|sort\s*code|account)\s+(details|instructions)/i,
];

const QUOTED_REPLY_MARKERS = [
  /^On .+ wrote:$/im,
  /^From:\s.+$/im,
  /^Sent:\s.+$/im,
  /^-----Original Message-----$/im,
  /^> /m,
];

export function stripHtml(input = '') {
  return String(input)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function stripQuotedReplies(text = '') {
  let out = String(text || '');
  let cut = out.length;
  for (const marker of QUOTED_REPLY_MARKERS) {
    const m = marker.exec(out);
    if (m && m.index > 0) cut = Math.min(cut, m.index);
  }
  return out.slice(0, cut);
}

export function normalizeInboundEmailText(message = {}) {
  const parts = [
    message.subject ? `Subject: ${message.subject}` : '',
    message.text || message.extracted_text || message.body || '',
    message.html ? stripHtml(message.html) : '',
    message.snippet || '',
  ].filter(Boolean);
  const joined = stripQuotedReplies(parts.join('\n'))
    .replace(/\r/g, '\n')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/\n{4,}/g, '\n\n')
    .trim();
  return joined.slice(0, MAX_INBOUND_CHARS);
}

export function detectPromptInjection(text = '') {
  const s = String(text || '');
  const matches = [];
  for (const re of PROMPT_INJECTION_PATTERNS) {
    if (re.test(s)) matches.push(String(re));
  }
  return {
    suspicious: matches.length > 0,
    matches,
  };
}

export function securityScanInboundEmail(message = {}) {
  const safeText = normalizeInboundEmailText(message);
  const injection = detectPromptInjection(safeText);
  return {
    safeText,
    lowerText: safeText.toLowerCase(),
    suspicious: injection.suspicious,
    promptInjectionMatches: injection.matches,
    labels: injection.suspicious ? ['rrd_security_review', 'rrd_prompt_injection_suspected'] : [],
  };
}

export function assertInboundSafeForAutomation(message = {}) {
  const scan = securityScanInboundEmail(message);
  if (scan.suspicious) {
    const err = new Error('Inbound email contains prompt-injection/social-engineering indicators; automation blocked pending human review');
    err.code = 'INBOUND_PROMPT_INJECTION_SUSPECTED';
    err.scan = scan;
    throw err;
  }
  return scan;
}
