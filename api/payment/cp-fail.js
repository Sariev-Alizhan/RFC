import { sb } from '../_lib/supabase.js';
import crypto from 'crypto';

export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseFormUrlEncoded(s) {
  const out = {};
  for (const pair of s.split('&')) {
    if (!pair) continue;
    const [k, v] = pair.split('=');
    out[decodeURIComponent(k)] = decodeURIComponent((v || '').replace(/\+/g, ' '));
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!sb) return res.status(500).json({ code: 13 });

  const password = process.env.CLOUDPAYMENTS_NOTIFY_PASSWORD;
  if (!password) return res.status(500).json({ code: 13 });

  const rawBody = await readRawBody(req);
  const sig = req.headers['content-hmac'] || req.headers['Content-HMAC'] || '';
  const expected = crypto.createHmac('sha256', password).update(rawBody).digest('base64');
  if (sig !== expected) return res.status(200).json({ code: 13 });

  const data = parseFormUrlEncoded(rawBody);
  const { InvoiceId, Reason, ReasonCode, TransactionId } = data;
  if (!InvoiceId) return res.status(200).json({ code: 10 });

  await sb.from('rfc_orders').update({
    status: 'Отказ оплаты',
    payment_status: 'failed',
    payment_id: TransactionId || null,
    payment_meta: { reason: Reason, reasonCode: ReasonCode, failedAt: new Date().toISOString() },
    updated_at: new Date().toISOString(),
  }).eq('id', InvoiceId);

  return res.status(200).json({ code: 0 });
}
