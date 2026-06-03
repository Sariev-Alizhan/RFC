export default async function handler(req, res) {
  const id = req.query?.id;
  if (!id) return res.status(400).json({ error: 'Missing id parameter' });
  // MOCK — Шаг 3 заменит на реальный poll Higgsfield по job_id
  return res.status(200).json({
    job_id: id,
    status: 'completed',
    result_url: 'https://redflag.kz/og.jpg',
    mock: true
  });
}
