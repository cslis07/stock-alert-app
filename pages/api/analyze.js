export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { imageBase64, mimeType } = req.body;
  if (!imageBase64) return res.status(400).json({ error: '이미지 없음' });

  const systemPrompt = `당신은 의약품 공급사가 보낸 재고 안내 이미지를 분석하는 전문가입니다.
이미지에서 제품 정보를 추출하여 반드시 JSON만 반환하세요. 마크다운 없이 순수 JSON만 출력하세요.

상태는 반드시 아래 중 하나로만 분류하세요:
판매중 / 품절 / 입고예정 / 일부규격품절 / 생산&공급중단 / 미정 / 입고완료 / 정산 / 신규금지 / 기타정책

날짜 규칙 (매우 중요):
- 날짜는 반드시 한국어 원문 그대로 유지하세요. 절대 YYYY.MM.DD 형식으로 변환하지 마세요.
- exact_date: 정확한 날짜 (예: "5월 6일", "5월 4일") - 일(日)이 명시된 경우만
- vague_date: 불명확한 날짜 (예: "5월초", "5월중순", "5월말", "5월말-6월초", "6월말") - 나머지 전부

형식:
{
  "supplier": "공급사명",
  "notice_date": "YYYY.MM.DD",
  "items": [
    {
      "manufacturer": "제약사명",
      "product_name": "제품명 정확하게",
      "spec": "규격",
      "status": "위 목록 중 하나",
      "exact_date": "5월 6일 (정확한 날짜만, 없으면 null)",
      "vague_date": "5월초 (불명확한 날짜, 없으면 null)",
      "note": "판매 가능 수량 등 추가 정보 (없으면 null)"
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
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: imageBase64 } },
            { type: 'text', text: '이 이미지에서 제품 정보를 추출해주세요.' }
          ]
        }]
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'API 오류');
    const raw = data.content?.find(c => c.type === 'text')?.text || '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('JSON 추출 실패');
    res.status(200).json(JSON.parse(match[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
