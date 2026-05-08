export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { imageBase64, mimeType } = req.body;
  if (!imageBase64) return res.status(400).json({ error: '이미지 없음' });

  const systemPrompt = `당신은 의약품 공급사가 보낸 재고 안내 이미지를 분석하는 전문가입니다.
이미지에서 제품 정보를 추출하여 반드시 JSON만 반환하세요. 마크다운 없이 순수 JSON만 출력하세요.

상태는 반드시 아래 중 하나로만 분류하세요:
- 판매중
- 품절
- 입고예정
- 일부규격품절
- 생산&공급중단
- 미정
- 입고완료
- 정산
- 신규금지
- 기타정책

형식:
{
  "supplier": "공급사명 (없으면 null)",
  "notice_date": "안내 날짜 YYYY.MM.DD (없으면 null)",
  "raw_summary": "이미지 내용 한 줄 요약",
  "items": [
    {
      "manufacturer": "제약사명 (없으면 null)",
      "product_name": "제품명 (정확하게)",
      "spec": "규격 (없으면 null)",
      "status": "위 목록 중 하나",
      "date": "입고/품절 날짜 (없으면 null)",
      "note": "비고 내용 (없으면 null)"
    }
  ]
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
        max_tokens: 4096,
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
              { type: 'text', text: '이 이미지에서 제품 정보를 추출해주세요.' },
            ],
          },
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'API 오류');

    const raw = data.content?.find((c) => c.type === 'text')?.text || '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON 추출 실패');
    const parsed = JSON.parse(jsonMatch[0]);
    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
