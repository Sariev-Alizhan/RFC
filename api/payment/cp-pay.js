import { sb } from '../_lib/supabase.js';
import crypto from 'crypto';

// Webhook от CloudPayments "Pay" — успешная оплата.
// Verifies HMAC-SHA256 of raw body using NotificationPassword.
// Returns {code: 0} = success, anything else = retry from CP side.

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
  if (!sb) return res.status(500).json({ code: 13, message: 'supabase not configured' });

  const password = process.env.CLOUDPAYMENTS_NOTIFY_PASSWORD;
  if (!password) {
    console.warn('[cp-pay] CLOUDPAYMENTS_NOTIFY_PASSWORD not set — webhook rejected');
    return res.status(500).json({ code: 13, message: 'notify password not configured' });
  }

  const rawBody = await readRawBody(req);
  const signatureHeader = req.headers['content-hmac'] || req.headers['Content-HMAC'] || '';
  const expected = crypto.createHmac('sha256', password).update(rawBody).digest('base64');

  if (signatureHeader !== expected) {
    console.warn('[cp-pay] HMAC mismatch — rejected');
    return res.status(200).json({ code: 13, message: 'invalid signature' });
  }

  const data = parseFormUrlEncoded(rawBody);
  const { InvoiceId, TransactionId, Amount, CardFirstSix, CardLastFour, CardType, Email, AccountId, Status } = data;

  if (!InvoiceId) return res.status(200).json({ code: 10, message: 'missing InvoiceId' });

  const update = await sb.from('rfc_orders').update({
    status: 'Оплачен',
    payment_status: 'paid',
    payment_provider: 'cloudpayments',
    payment_id: TransactionId || null,
    payment_meta: {
      amount: Number(Amount) || null,
      cardFirstSix: CardFirstSix || null,
      cardLastFour: CardLastFour || null,
      cardType: CardType || null,
      email: Email || null,
      accountId: AccountId || null,
      status: Status || 'Completed',
      paidAt: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  }).eq('id', InvoiceId).select('id').single();

  if (update.error) {
    console.error('[cp-pay] DB update failed:', update.error.message);
    return res.status(200).json({ code: 13, message: 'db update failed' });
  }

  return res.status(200).json({ code: 0 });
}
