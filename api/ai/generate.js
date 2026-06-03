import { higgsfield, config } from '@higgsfield/client/v2';
import { sb, verifyAuth } from '../_lib/supabase.js';

const KEY_ID = process.env.HIGGSFIELD_KEY_ID;
const KEY_SECRET = process.env.HIGGSFIELD_KEY_SECRET;

if (KEY_ID && KEY_SECRET) {
  config({ credentials: `${KEY_ID}:${KEY_SECRET}` });
}

const ELEMENT_DESC = {
  'rfc-navy-cap': 'wearing a navy blue baseball cap with a small embroidered red pennant flag patch on the front',
  'rfc-flag-tee': 'wearing a black cotton t-shirt with a large red pennant flag printed across the chest',
  'rfc-camo-cap': 'wearing a camouflage baseball cap with a small embroidered red pennant flag patch on the front'
};

const VALID_ASPECTS = new Set(['1:1', '4:5', '9:16', '16:9', '3:4', '21:9']);
const MODEL = 'flux-pro/kontext/max/text-to-image';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await verifyAuth(req);
  if (!auth.ok) return res.status(401).json({ error: 'Unauthorized: ' + auth.error });

  if (!KEY_ID || !KEY_SECRET) {
    return res.status(500).json({ error: 'Server config: HIGGSFIELD_KEY_ID and HIGGSFIELD_KEY_SECRET must be set' });
  }

  const body = req.body || {};
  const prompt = (body.prompt || '').trim();
  const aspect = VALID_ASPECTS.has(body.aspect) ? body.aspect : '4:5';
  const elements = Array.isArray(body.elements) ? body.elements : [];

  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
  if (prompt.length > 4000) return res.status(400).json({ error: 'Prompt too long (max 4000 chars)' });

  const elText = elements.map(n => ELEMENT_DESC[n]).filter(Boolean).join(', ');
  const fullPrompt = elText ? `${prompt}. Subject ${elText}.` : prompt;

  let rowId = null;
  if (sb) {
    const { data: row, error: insertErr } = await sb.from('ai_generations').insert({
      user_id: auth.user.id,
      prompt: prompt,
      prompt_used: fullPrompt,
      model: MODEL,
      aspect,
      elements,
      status: 'submitting'
    }).select('id').single();
    if (insertErr) {
      console.error('ai_generations insert failed:', insertErr.message);
    } else {
      rowId = row?.id || null;
    }
  }

  try {
    const jobSet = await higgsfield.subscribe(MODEL, {
      input: { prompt: fullPrompt, aspect_ratio: aspect, safety_tolerance: 2 },
      withPolling: false
    });

    const immediateUrl = jobSet.isCompleted ? jobSet.jobs?.[0]?.results?.raw?.url : null;
    const finalStatus = immediateUrl ? 'completed' : (jobSet.isFailed ? 'error' : (jobSet.isNsfw ? 'error' : 'pending'));
    const finalError = jobSet.isFailed ? 'submit failed' : (jobSet.isNsfw ? 'nsfw' : null);

    if (sb && rowId) {
      await sb.from('ai_generations').update({
        job_id: jobSet.id,
        status: finalStatus,
        result_url: immediateUrl,
        error: finalError
      }).eq('id', rowId);
    }

    if (immediateUrl) {
      return res.status(200).json({
        row_id: rowId, job_id: jobSet.id, status: 'completed',
        result_url: immediateUrl, prompt_used: fullPrompt
      });
    }
    if (jobSet.isFailed) {
      return res.status(500).json({ error: 'Higgsfield: generation failed at submit', row_id: rowId, job_id: jobSet.id });
    }
    if (jobSet.isNsfw) {
      return res.status(422).json({ error: 'Higgsfield: content flagged as NSFW', row_id: rowId });
    }

    return res.status(200).json({
      row_id: rowId, job_id: jobSet.id, status: 'pending', prompt_used: fullPrompt
    });

  } catch (e) {
    const name = e?.name || '';
    const msg = e?.message || String(e);

    if (sb && rowId) {
      await sb.from('ai_generations').update({
        status: 'error', error: `${name}: ${msg}`.slice(0, 500)
      }).eq('id', rowId);
    }

    if (name === 'AuthenticationError') return res.status(401).json({ error: 'Higgsfield auth failed — check KEY_ID:KEY_SECRET in Vercel env vars' });
    if (name === 'NotEnoughCreditsError') return res.status(402).json({ error: 'Higgsfield: not enough credits' });
    if (name === 'AccountError') {
      if (/credit/i.test(msg)) return res.status(402).json({ error: 'Higgsfield Cloud API: not enough credits' });
      return res.status(402).json({ error: `Higgsfield account: ${msg}` });
    }
    if (name === 'BadInputError') return res.status(400).json({ error: `Higgsfield bad input: ${msg}` });
    if (name === 'ValidationError') return res.status(400).json({ error: `Higgsfield validation: ${msg}` });
    return res.status(500).json({ error: msg, name });
  }
}
