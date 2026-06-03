export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { prompt, model = 'nano_banana_pro', aspect = '4:5', elements = [] } = req.body || {};
  if (!prompt) {
    return res.status(400).json({ error: 'Missing prompt' });
  }
  // MOCK — будет заменено на реальный вызов Higgsfield в Шаге 3
  return res.status(200).json({
    job_id: 'mock-' + Date.now(),
    status: 'pending',
    mock: true,
    received: { prompt, model, aspect, elements }
  });
}
