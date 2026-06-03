const KEY_ID = process.env.HIGGSFIELD_KEY_ID;
const KEY_SECRET = process.env.HIGGSFIELD_KEY_SECRET;
const BASE = 'https://platform.higgsfield.ai';

export default async function handler(req, res) {
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

    // Higgsfield response: { status, request_id, images: [{url}], video: {url}, ... }
    if (data.status === 'completed') {
      const url = data.images?.[0]?.url || data.video?.url;
      if (!url) {
        return res.status(500).json({ error: 'Higgsfield: completed but no result URL', hf: data });
      }
      return res.status(200).json({
        job_id: id,
        status: 'completed',
        result_url: url
      });
    }
    if (data.status === 'failed') {
      return res.status(200).json({ job_id: id, status: 'error', error: 'Higgsfield: generation failed' });
    }
    if (data.status === 'nsfw') {
      return res.status(200).json({ job_id: id, status: 'error', error: 'Higgsfield: NSFW' });
    }
    // queued / in_progress / unknown
    return res.status(200).json({
      job_id: id,
      status: 'pending',
      hf_status: data.status || 'unknown'
    });

  } catch (e) {
    return res.status(500).json({ error: e.message || 'Network error to Higgsfield' });
  }
}
