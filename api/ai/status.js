import { sb, verifyAuth } from '../_lib/supabase.js';

const KEY_ID = process.env.HIGGSFIELD_KEY_ID;
const KEY_SECRET = process.env.HIGGSFIELD_KEY_SECRET;
const BASE = 'https://platform.higgsfield.ai';

export default async function handler(req, res) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return res.status(401).json({ error: 'Unauthorized: ' + auth.error });

  const id = req.query?.id;
  if (!id) return res.status(400).json({ error: 'Missing id parameter' });
  if (!KEY_ID || !KEY_SECRET) {
    return res.status(500).json({ error: 'Server config: missing HIGGSFIELD_KEY_ID/HIGGSFIELD_KEY_SECRET' });
  }

  try {
    const r = await fetch(`${BASE}/requests/${encodeURIComponent(id)}/status`, {
      headers: {
        'Authorization': `Key ${KEY_ID}:${KEY_SECRET}`,
        'User-Agent': 'higgsfield-server-js/2.0',
        'Accept': 'application/json'
      }
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      return res.status(r.status).json({
        error: data.message || data.error || `Higgsfield HTTP ${r.status}`,
        hf: data
      });
    }

    if (data.status === 'completed') {
      const url = data.images?.[0]?.url || data.video?.url;
      if (!url) {
        return res.status(500).json({ error: 'Higgsfield: completed but no result URL', hf: data });
      }
      if (sb) {
        await sb.from('ai_generations').update({
          status: 'completed', result_url: url
        }).eq('job_id', id);
      }
      return res.status(200).json({ job_id: id, status: 'completed', result_url: url });
    }
    if (data.status === 'failed') {
      if (sb) await sb.from('ai_generations').update({ status: 'error', error: 'Higgsfield: generation failed' }).eq('job_id', id);
      return res.status(200).json({ job_id: id, status: 'error', error: 'Higgsfield: generation failed' });
    }
    if (data.status === 'nsfw') {
      if (sb) await sb.from('ai_generations').update({ status: 'error', error: 'nsfw' }).eq('job_id', id);
      return res.status(200).json({ job_id: id, status: 'error', error: 'NSFW' });
    }
    // queued / in_progress / unknown
    return res.status(200).json({ job_id: id, status: 'pending', hf_status: data.status || 'unknown' });

  } catch (e) {
    return res.status(500).json({ error: e.message || 'Network error to Higgsfield' });
  }
}
