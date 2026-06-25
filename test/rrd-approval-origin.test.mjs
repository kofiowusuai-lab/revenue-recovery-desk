import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function loadApprovalModule(root) {
  process.env.RRD_APPROVAL_ROOT = root;
  process.env.RRD_OPERATOR_OPENCLAW = path.join(root, '..', 'openclaw');
  process.env.RRD_APPROVAL_TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.RRD_APPROVAL_TELEGRAM_CHAT_ID = '-10042';
  delete process.env.RRD_APPROVAL_TELEGRAM_ALLOWED_USER_IDS;
  delete process.env.RRD_APPROVAL_TELEGRAM_ADMIN_IDS;
  return import(`../rrd-approval?cache=${Date.now()}-${Math.random()}`);
}

function writeApproval(root, overrides = {}) {
  const item = {
    id: 'appr_origin_001',
    profile: 'rr-test',
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    approvalOnly: true,
    action: { channel: 'Email', approved: false, tool: 'send_via_executor' },
    telegram: { chatId: '-10042', messageId: 77 },
    history: [],
    ...overrides
  };
  const dir = path.join(root, 'items');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(root, 'attachments'), { recursive: true });
  fs.writeFileSync(path.join(dir, `${item.id}.json`), JSON.stringify(item, null, 2));
  return item;
}

function readApproval(root, id = 'appr_origin_001') {
  return JSON.parse(fs.readFileSync(path.join(root, 'items', `${id}.json`), 'utf8'));
}

test('Telegram callback rejects unknown chat before mutating approval', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rrd-approval-origin-'));
  const mod = await loadApprovalModule(root);
  process.env.RRD_APPROVAL_TELEGRAM_ALLOWED_USER_IDS = '111';
  writeApproval(root);

  const res = await mod.handleCallback({
    data: 'rrd:appr_origin_001:approve',
    from: { id: 111 },
    message: { message_id: 77, chat: { id: -999, type: 'supergroup' } }
  });

  assert.equal(res.ok, false);
  assert.equal(res.unauthorized, true);
  assert.match(res.error, /untrusted Telegram chat/);
  assert.equal(readApproval(root).status, 'pending');
});

test('Telegram callback rejects non-allowlisted user before mutating approval', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rrd-approval-user-'));
  const mod = await loadApprovalModule(root);
  process.env.RRD_APPROVAL_TELEGRAM_ALLOWED_USER_IDS = '222,333';
  writeApproval(root);

  const res = await mod.handleCallback({
    data: 'rrd:appr_origin_001:approve',
    from: { id: 111 },
    message: { message_id: 77, chat: { id: -10042, type: 'supergroup' } }
  });

  assert.equal(res.ok, false);
  assert.equal(res.unauthorized, true);
  assert.match(res.error, /untrusted Telegram user/);
  assert.equal(readApproval(root).status, 'pending');
});

test('Telegram callback rejects when no allowlist/admin user policy is configured', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rrd-approval-no-policy-'));
  const mod = await loadApprovalModule(root);
  writeApproval(root);

  const res = await mod.handleCallback({
    data: 'rrd:appr_origin_001:approve',
    from: { id: 111 },
    message: { message_id: 77, chat: { id: -10042, type: 'supergroup' } }
  });

  assert.equal(res.ok, false);
  assert.equal(res.unauthorized, true);
  assert.match(res.error, /untrusted Telegram user/);
  assert.equal(readApproval(root).status, 'pending');
});

test('Telegram callback from configured chat can approve approval-only packet', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rrd-approval-ok-'));
  const mod = await loadApprovalModule(root);
  process.env.RRD_APPROVAL_TELEGRAM_ALLOWED_USER_IDS = '111';
  writeApproval(root);

  const res = await mod.handleCallback({
    data: 'rrd:appr_origin_001:approve',
    from: { id: 111 },
    message: { message_id: 77, chat: { id: -10042, type: 'supergroup' } }
  });

  assert.equal(res.ok, true);
  assert.equal(res.status, 'approved');
  assert.equal(readApproval(root).status, 'approved');
});

test('Telegram callback rejects missing message_id when packet is tied to a Telegram message', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rrd-approval-msg-'));
  const mod = await loadApprovalModule(root);
  process.env.RRD_APPROVAL_TELEGRAM_ALLOWED_USER_IDS = '111';
  writeApproval(root);

  const res = await mod.handleCallback({
    data: 'rrd:appr_origin_001:approve',
    from: { id: 111 },
    message: { chat: { id: -10042, type: 'supergroup' } }
  });

  assert.equal(res.ok, false);
  assert.equal(res.unauthorized, true);
  assert.match(res.error, /message does not match/);
  assert.equal(readApproval(root).status, 'pending');
});

test('Telegram callback rejects approval packets with missing Telegram binding metadata', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rrd-approval-binding-'));
  const mod = await loadApprovalModule(root);
  process.env.RRD_APPROVAL_TELEGRAM_ALLOWED_USER_IDS = '111';
  writeApproval(root, { telegram: null });

  const res = await mod.handleCallback({
    data: 'rrd:appr_origin_001:approve',
    from: { id: 111 },
    message: { message_id: 77, chat: { id: -10042, type: 'supergroup' } }
  });

  assert.equal(res.ok, false);
  assert.equal(res.unauthorized, true);
  assert.match(res.error, /not bound to a Telegram message/);
  assert.equal(readApproval(root).status, 'pending');
});

test('Telegram unauthorized callback answers only and does not remove approval buttons', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rrd-approval-ui-'));
  const mod = await loadApprovalModule(root);
  process.env.RRD_APPROVAL_TELEGRAM_ALLOWED_USER_IDS = '222';
  writeApproval(root);
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? String(init.body) : '' });
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const res = await mod.handleCallback({
      id: 'callback-1',
      data: 'rrd:appr_origin_001:approve',
      from: { id: 111 },
      message: { message_id: 77, chat: { id: -10042, type: 'supergroup' } }
    });
    assert.equal(res.ok, false);
    assert.equal(res.unauthorized, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /answerCallbackQuery$/);
  assert.doesNotMatch(calls.map((c) => c.url).join('\n'), /editMessageReplyMarkup|sendMessage/);
  assert.equal(readApproval(root).status, 'pending');
});

test('Telegram invalid approval callback answers only and does not mutate chat UI', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rrd-approval-invalid-ui-'));
  const mod = await loadApprovalModule(root);
  process.env.RRD_APPROVAL_TELEGRAM_ALLOWED_USER_IDS = '111';
  writeApproval(root);
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? String(init.body) : '' });
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const res = await mod.handleCallback({
      id: 'callback-invalid',
      data: 'rrd:../outside:approve',
      from: { id: 111 },
      message: { message_id: 77, chat: { id: -10042, type: 'supergroup' } }
    });
    assert.equal(res.ok, false);
    assert.match(res.error, /invalid approval id/);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /answerCallbackQuery$/);
  assert.doesNotMatch(calls.map((c) => c.url).join('\n'), /editMessageReplyMarkup|sendMessage/);
  assert.equal(readApproval(root).status, 'pending');
});

test('Telegram missing approval callback answers only and does not mutate chat UI', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rrd-approval-missing-ui-'));
  const mod = await loadApprovalModule(root);
  process.env.RRD_APPROVAL_TELEGRAM_ALLOWED_USER_IDS = '111';
  writeApproval(root);
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? String(init.body) : '' });
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const res = await mod.handleCallback({
      id: 'callback-missing',
      data: 'rrd:appr_missing_001:approve',
      from: { id: 111 },
      message: { message_id: 77, chat: { id: -10042, type: 'supergroup' } }
    });
    assert.equal(res.ok, false);
    assert.match(res.error, /not found/);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /answerCallbackQuery$/);
  assert.doesNotMatch(calls.map((c) => c.url).join('\n'), /editMessageReplyMarkup|sendMessage/);
  assert.equal(readApproval(root).status, 'pending');
});

test('Telegram callback rejects mismatched packet id before mutating approval', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rrd-approval-id-mismatch-'));
  const mod = await loadApprovalModule(root);
  process.env.RRD_APPROVAL_TELEGRAM_ALLOWED_USER_IDS = '111';
  writeApproval(root, { id: 'appr_other_001' });
  fs.renameSync(path.join(root, 'items', 'appr_other_001.json'), path.join(root, 'items', 'appr_origin_001.json'));
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? String(init.body) : '' });
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const res = await mod.handleCallback({
      id: 'callback-mismatch',
      data: 'rrd:appr_origin_001:approve',
      from: { id: 111 },
      message: { message_id: 77, chat: { id: -10042, type: 'supergroup' } }
    });
    assert.equal(res.ok, false);
    assert.match(res.error, /id mismatch/);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /answerCallbackQuery$/);
  assert.doesNotMatch(calls.map((c) => c.url).join('\n'), /editMessageReplyMarkup|sendMessage/);
  assert.equal(fs.existsSync(path.join(root, 'items', 'appr_other_001.json')), false);
});

test('approval ids reject traversal and non-packet names', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rrd-approval-id-'));
  const mod = await loadApprovalModule(root);
  assert.equal(mod.validApprovalId('appr_20260623010101_abcd1234'), 'appr_20260623010101_abcd1234');
  assert.throws(() => mod.validApprovalId('../outside'), /invalid approval id/);
  assert.throws(() => mod.validApprovalId('appr_bad-name'), /invalid approval id/);
});
