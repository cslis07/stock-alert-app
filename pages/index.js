import { useState, useRef } from 'react';
import Head from 'next/head';

const STATUS_CONFIG = {
  품절:     { color: '#A32D2D', bg: '#FCEBEB', icon: '🚫' },
  생산중단: { color: '#A32D2D', bg: '#FCEBEB', icon: '⛔' },
  장기품절: { color: '#854F0B', bg: '#FAEEDA', icon: '⚠️' },
  미정:     { color: '#5F5E5A', bg: '#F1EFE8', icon: '❓' },
  입고예정: { color: '#185FA5', bg: '#E6F1FB', icon: '📦' },
  기타:     { color: '#5F5E5A', bg: '#F1EFE8', icon: '📌' },
};

function generateNotice(data) {
  const { items = [], supplier, notice_date } = data;
  const date = notice_date || new Date().toLocaleDateString('ko-KR');
  const lines = [`📢 재고 안내${supplier ? ` (${supplier})` : ''} — ${date}\n`];

  const groups = {};
  items.forEach((it) => {
    if (!groups[it.status]) groups[it.status] = [];
    groups[it.status].push(it);
  });

  Object.entries(groups).forEach(([status, list]) => {
    const cfg = STATUS_CONFIG[status] || STATUS_CONFIG['기타'];
    lines.push(`${cfg.icon} [${status}]`);
    list.forEach((it) => {
      let line = `• ${it.product_name}`;
      if (it.code) line += ` (${it.code})`;
      if (it.expected_date) line += ` → 입고 예정: ${it.expected_date}`;
      if (it.note) line += `\n  ${it.note}`;
      lines.push(line);
    });
    lines.push('');
  });

  lines.push('불편을 드려 죄송합니다.\n문의사항은 채널로 남겨주세요.');
  return lines.join('\n');
}

export default function Home() {
  const [preview, setPreview] = useState(null);
  const [base64, setBase64] = useState('');
  const [mimeType, setMimeType] = useState('image/jpeg');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const fileRef = useRef();

  function handleFile(file) {
    if (!file) return;
    setMimeType(file.type || 'image/jpeg');
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreview(e.target.result);
      setBase64(e.target.result.split(',')[1]);
      setResult(null);
      setError('');
    };
    reader.readAsDataURL(file);
  }

  async function analyze() {
    if (!base64) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mimeType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '분석 실패');
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setPreview(null);
    setBase64('');
    setResult(null);
    setError('');
    if (fileRef.current) fileRef.current.value = '';
  }

  async function copyNotice() {
    if (!result) return;
    await navigator.clipboard.writeText(generateNotice(result));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <Head>
        <title>재고 이슈 알리미</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.title}>📦 재고 이슈 알리미</h1>
          <p style={styles.subtitle}>공급사 카톡 캡처 → AI 분석 → 카카오채널 공지 자동 생성</p>

          {/* 업로드 영역 */}
          {!preview ? (
            <div
              style={styles.dropzone}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
            >
              <div style={{ fontSize: 40 }}>📸</div>
              <p style={styles.dropText}>
                <strong>클릭</strong>하거나 이미지를 끌어다 놓으세요
              </p>
              <p style={styles.dropSub}>품절·입고·생산중단 안내 캡처 이미지</p>
              <input
                type="file"
                ref={fileRef}
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => handleFile(e.target.files[0])}
              />
            </div>
          ) : (
            <div style={{ textAlign: 'center' }}>
              <img src={preview} alt="미리보기" style={styles.previewImg} />
              <div style={styles.btnRow}>
                <button style={styles.btnPrimary} onClick={analyze} disabled={loading}>
                  {loading ? '⏳ 분석 중...' : '✨ AI 분석 시작'}
                </button>
                <button style={styles.btnSecondary} onClick={reset}>↩ 다시</button>
              </div>
            </div>
          )}

          {/* 에러 */}
          {error && <div style={styles.errBox}>❌ {error}</div>}

          {/* 결과 */}
          {result && (
            <div style={{ marginTop: 24 }}>
              {/* 공급사 정보 */}
              {(result.supplier || result.notice_date) && (
                <div style={styles.infoCard}>
                  <h3 style={styles.sectionLabel}>🏪 공급사 정보</h3>
                  {result.supplier && <p style={styles.infoRow}><span style={styles.infoKey}>공급사</span>{result.supplier}</p>}
                  {result.notice_date && <p style={styles.infoRow}><span style={styles.infoKey}>날짜</span>{result.notice_date}</p>}
                  {result.raw_summary && <p style={{ ...styles.infoRow, color: '#666', fontSize: 13 }}><span style={styles.infoKey}>요약</span>{result.raw_summary}</p>}
                </div>
              )}

              {/* 상품 목록 */}
              <h3 style={styles.sectionLabel}>📋 추출된 상품 ({result.items?.length || 0}건)</h3>
              {(result.items || []).map((item, i) => {
                const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG['기타'];
                return (
                  <div key={i} style={styles.itemCard}>
                    <div style={styles.itemHeader}>
                      <span style={{ ...styles.badge, color: cfg.color, background: cfg.bg }}>
                        {cfg.icon} {item.status}
                      </span>
                      <span style={styles.itemName}>{item.product_name}</span>
                      {item.code && <span style={styles.itemCode}>{item.code}</span>}
                    </div>
                    {item.expected_date && <p style={styles.itemMeta}>📅 입고 예정: {item.expected_date}</p>}
                    {item.note && <p style={styles.itemMeta}>{item.note}</p>}
                  </div>
                );
              })}

              {/* 공지 초안 */}
              <h3 style={{ ...styles.sectionLabel, marginTop: 20 }}>📣 카카오채널 공지 초안</h3>
              <pre style={styles.noticeBox}>{generateNotice(result)}</pre>
              <button style={{ ...styles.btnPrimary, marginTop: 8 }} onClick={copyNotice}>
                {copied ? '✅ 복사됨!' : '📋 공지 복사'}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    background: '#f5f5f5',
    display: 'flex',
    justifyContent: 'center',
    padding: '40px 16px',
  },
  card: {
    background: '#fff',
    borderRadius: 16,
    padding: '32px 28px',
    width: '100%',
    maxWidth: 560,
    boxShadow: '0 2px 16px rgba(0,0,0,0.08)',
    height: 'fit-content',
  },
  title: { fontSize: 22, fontWeight: 700, margin: '0 0 6px', color: '#1a1a1a' },
  subtitle: { fontSize: 14, color: '#666', margin: '0 0 24px' },
  dropzone: {
    border: '2px dashed #ccc',
    borderRadius: 12,
    padding: '40px 20px',
    textAlign: 'center',
    cursor: 'pointer',
    background: '#fafafa',
    transition: 'border-color 0.2s',
  },
  dropText: { fontSize: 15, color: '#333', margin: '8px 0 4px' },
  dropSub: { fontSize: 13, color: '#999', margin: 0 },
  previewImg: { maxWidth: '100%', maxHeight: 240, borderRadius: 10, border: '1px solid #eee' },
  btnRow: { display: 'flex', gap: 8, marginTop: 12, justifyContent: 'center' },
  btnPrimary: {
    background: '#3B82F6',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '10px 20px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  btnSecondary: {
    background: '#fff',
    color: '#333',
    border: '1px solid #ddd',
    borderRadius: 8,
    padding: '10px 16px',
    fontSize: 14,
    cursor: 'pointer',
  },
  errBox: {
    background: '#FCEBEB',
    color: '#A32D2D',
    borderRadius: 8,
    padding: '10px 14px',
    fontSize: 13,
    marginTop: 12,
  },
  infoCard: {
    background: '#f8f9fa',
    borderRadius: 10,
    padding: '14px 16px',
    marginBottom: 16,
  },
  sectionLabel: { fontSize: 14, fontWeight: 600, color: '#444', margin: '0 0 10px' },
  infoRow: { fontSize: 14, margin: '4px 0', display: 'flex', gap: 8 },
  infoKey: { color: '#999', minWidth: 60 },
  itemCard: {
    border: '1px solid #eee',
    borderRadius: 10,
    padding: '12px 14px',
    marginBottom: 8,
  },
  itemHeader: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  badge: { fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 99 },
  itemName: { fontSize: 14, fontWeight: 600, color: '#1a1a1a' },
  itemCode: { fontSize: 12, color: '#999' },
  itemMeta: { fontSize: 13, color: '#555', margin: '4px 0 0' },
  noticeBox: {
    background: '#f8f9fa',
    border: '1px solid #eee',
    borderRadius: 10,
    padding: '14px 16px',
    fontSize: 13,
    lineHeight: 1.8,
    whiteSpace: 'pre-wrap',
    fontFamily: 'inherit',
    color: '#222',
  },
};
