export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { imageBase64, mimeType } = req.body;
  if (!imageBase64) return res.status(400).json({ error: '이미지 없음' });

  const systemPrompt = `당신은 공급사가 보낸 재고 안내 이미지를 분석하는 전문가입니다.
이미지에서 품절, 생산중단, 장기품절, 미정, 입고예정 등 이슈 정보를 추출하세요.
반드시 JSON만 반환하세요. 마크다운 코드블록 없이 순수 JSON만 출력하세요.

형식:
{
  "items": [
    {
      "product_name": "상품명",
      "code": "상품코드 (없으면 null)",
      "status": "품절|생산중단|장기품절|미정|입고예정|기타",
      "expected_date": "입고예정일 (없으면 null)",
      "note": "추가 메모 (없으면 null)"
    }
  ],
  "supplier": "공급사명 (없으면 null)",
  "notice_date": "안내 날짜 (없으면 null)",
  "raw_summary": "이미지 내용 한 줄 요약"
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mimeType || 'image/jpeg',
                  data: imageBase64,
                },
              },
              { type: 'text', text: '이 이미지에서 재고 이슈 정보를 추출해주세요.' },
            ],
          },
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'API 오류');

    const raw = data.content?.find((c) => c.type === 'text')?.text || '';
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
