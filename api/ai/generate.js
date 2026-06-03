import { higgsfield, config } from '@higgsfield/client/v2';

const KEY_ID = process.env.HIGGSFIELD_KEY_ID;
const KEY_SECRET = process.env.HIGGSFIELD_KEY_SECRET;

if (KEY_ID && KEY_SECRET) {
  config({ credentials: `${KEY_ID}:${KEY_SECRET}` });
}

// RFC element names → English descriptions appended to prompt.
// Higgsfield Cloud API doesn't accept MCP-uploaded reference UUIDs;
// these textual hints give the model enough to render the right look
// until we wire real client.uploadImage() references in a later step.
const ELEMENT_DESC = {
  'rfc-navy-cap': 'wearing a navy blue baseball cap with a small embroidered red pennant flag patch on the front',
  'rfc-flag-tee': 'wearing a black cotton t-shirt with a large red pennant flag printed across the chest',
  'rfc-camo-cap': 'wearing a camouflage baseball cap with a small embroidered red pennant flag patch on the front'
};

const VALID_ASPECTS = new Set(['1:1', '4:5', '9:16', '16:9', '3:4', '21:9']);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!KEY_ID || !KEY_SECRET) {
    return res.status(500).json({ error: 'Server config: HIGGSFIELD_KEY_ID and HIGGSFIELD_KEY_SECRET must be set in Vercel env vars' });
  }

  const body = req.body || {};
  const prompt = (body.prompt || '').trim();
  const aspect = VALID_ASPECTS.has(body.aspect) ? body.aspect : '4:5';
  const elements = Array.isArray(body.elements) ? body.elements : [];

  if (!prompt) {
    return res.status(400).json({ error: 'Missing prompt' });
  }
  if (prompt.length > 4000) {
    return res.status(400).json({ error: 'Prompt too long (max 4000 chars)' });
  }

  // Enrich prompt with element descriptions
  const elText = elements
    .map(n => ELEMENT_DESC[n])
    .filter(Boolean)
    .join(', ');
  const fullPrompt = elText ? `${prompt}. Subject ${elText}.` : prompt;

  try {
    // withPolling:false → submit and return immediately, frontend will poll status
    const jobSet = await higgsfield.subscribe('flux-pro/kontext/max/text-to-image', {
      input: {
        prompt: fullPrompt,
        aspect_ratio: aspect,
        safety_tolerance: 2
      },
      withPolling: false
    });

    // Rare case: Higgsfield completed synchronously
    if (jobSet.isCompleted) {
      const url = jobSet.jobs?.[0]?.results?.raw?.url;
      if (url) {
        return res.status(200).json({
          job_id: jobSet.id,
          status: 'completed',
          result_url: url,
          prompt_used: fullPrompt
        });
      }
    }
    if (jobSet.isFailed) {
      return res.status(500).json({ error: 'Higgsfield: generation failed at submit', job_id: jobSet.id });
    }
    if (jobSet.isNsfw) {
      return res.status(422).json({ error: 'Higgsfield: content flagged as NSFW' });
    }

    // Normal path: queued/in_progress — frontend polls /api/ai/status?id=...
    return res.status(200).json({
      job_id: jobSet.id,
      status: 'pending',
      prompt_used: fullPrompt
    });

  } catch (e) {
    const name = e?.name || '';
    const msg = e?.message || String(e);
    if (name === 'AuthenticationError') return res.status(401).json({ error: 'Higgsfield auth failed — check KEY_ID:KEY_SECRET in Vercel env vars' });
    if (name === 'NotEnoughCreditsError') return res.status(402).json({ error: 'Higgsfield: not enough credits on the account' });
    if (name === 'AccountError') {
      if (/credit/i.test(msg)) return res.status(402).json({ error: 'Higgsfield Cloud API: not enough credits' });
      return res.status(402).json({ error: `Higgsfield account: ${msg}` });
    }
    if (name === 'BadInputError') return res.status(400).json({ error: `Higgsfield bad input: ${msg}` });
    if (name === 'ValidationError') return res.status(400).json({ error: `Higgsfield validation: ${msg}` });
    return res.status(500).json({ error: msg, name });
  }
}
