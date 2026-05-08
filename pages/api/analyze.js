export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { imageBase64, mimeType } = req.body;
  if (!imageBase64) return res.status(400).json({ error: '이미지 없음' });

  const prompt = `당신은 공급사가 보낸 재고 안내 이미지를 분석하는 전문가입니다.
이미지에서 품절, 생산중단, 장기품절, 미정, 입고예정 등 이슈 정보를 추출하세요.
반드시 JSON만 반환하세요. 마크다운 코드블록 없이 순수 JSON만 출력하세요.

형식:
{"items":[{"product_name":"상품명","code":null,"status":"품절|생산중단|장기품절|미정|입고예정|기타","expected_date":null,"note":null}],"supplier":null,"notice_date":null,"raw_summary":"한 줄 요약"}`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-exp:free',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${imageBase64}` } }
          ]
        }]
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'API 오류');

    const raw = data.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
