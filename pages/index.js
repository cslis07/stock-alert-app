import { useState, useRef } from 'react';
import Head from 'next/head';

const STATUS_LIST = [
  '판매중','품절','입고예정','일부규격품절',
  '생산&공급중단','미정','입고완료','정산','신규금지','기타정책'
];

const STATUS_COLOR = {
  '판매중':     { bg: '#EAF3DE', color: '#3B6D11' },
  '품절':       { bg: '#FCEBEB', color: '#A32D2D' },
  '입고예정':   { bg: '#E6F1FB', color: '#185FA5' },
  '일부규격품절':{ bg: '#FAEEDA', color: '#854F0B' },
  '생산&공급중단':{ bg: '#FCEBEB', color: '#A32D2D' },
  '미정':       { bg: '#F1EFE8', color: '#5F5E5A' },
  '입고완료':   { bg: '#EAF3DE', color: '#3B6D11' },
  '정산':       { bg: '#F1EFE8', color: '#5F5E5A' },
  '신규금지':   { bg: '#FAEEDA', color: '#854F0B' },
  '기타정책':   { bg: '#F1EFE8', color: '#5F5E5A' },
};

export default function Home() {
  const [preview, setPreview]   = useState(null);
  const [base64, setBase64]     = useState('');
  const [mimeType, setMimeType] = useState('image/jpeg');
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState(null);
  const [error, setError]       = useState('');
  const [copied, setCopied]     = useState(false);
  const fileRef = useRef();

  function handleFile(file) {
    if (!file) return;
    setMimeType(file.type || 'image/jpeg');
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreview(e.target.result);
      setBase64(e.target.result.split(',')[1]);
      setResult(null); setError('');
    };
    reader.readAsDataURL(file);
  }

  async function analyze() {
    if (!base64) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mimeType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '분석 실패');
      setResult(data);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  function reset() {
    setPreview(null); setBase64(''); setResult(null); setError('');
    if (fileRef.current) fileRef.current.value = '';
  }

  // 구글 시트 붙여넣기용 탭 구분 텍스트
  function makeSheetText(items) {
    return items.map(it =>
      [
        it.manufacturer || '',
        it.product_name || '',
        it.spec || '',
        it.status || '',
        it.date || '',
        it.note || '',
      ].join('\t')
    ).join('\n');
  }

  async function copyForSheet() {
    if (!result?.items) return;
    await navigator.clipboard.writeText(makeSheetText(result.items));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <Head><title>재고 이슈 알리미</title></Head>
      <div style={s.wrap}>
        <div style={s.card}>
          <h1 style={s.title}>📦 재고 이슈 알리미</h1>
          <p style={s.sub}>공급사 카톡 캡처 → AI 분석 → 구글 시트 바로 붙여넣기</p>

          {!preview ? (
            <div style={s.drop} onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}>
              <div style={{ fontSize: 36 }}>📸</div>
              <p style={s.dropTxt}><strong>클릭</strong>하거나 이미지를 끌어다 놓으세요</p>
              <p style={s.dropSub}>품절·입고·생산중단 안내 캡처 이미지</p>
              <input type="file" ref={fileRef} accept="image/*" style={{ display:'none' }}
                onChange={e => handleFile(e.target.files[0])} />
            </div>
          ) : (
            <div style={{ textAlign:'center' }}>
              <img src={preview} alt="미리보기" style={s.img} />
              <div style={s.btnRow}>
                <button style={s.btnBlue} onClick={analyze} disabled={loading}>
                  {loading ? '⏳ 분석 중...' : '✨ AI 분석 시작'}
                </button>
                <button style={s.btnGray} onClick={reset}>↩ 다시</button>
              </div>
            </div>
          )}

          {error && <div style={s.err}>❌ {error}</div>}

          {result && (
            <div style={{ marginTop: 20 }}>
              {/* 요약 */}
              <div style={s.summary}>
                <span>🏪 {result.supplier || '공급사 미상'}</span>
                <span style={{ color:'#888', fontSize:13 }}>{result.notice_date || ''}</span>
              </div>
              <p style={{ fontSize:13, color:'#666', marginBottom:12 }}>{result.raw_summary}</p>

              {/* 구글 시트 복사 버튼 */}
              <button style={{ ...s.btnBlue, marginBottom:12, width:'100%' }} onClick={copyForSheet}>
                {copied ? '✅ 복사됨! 구글 시트에 붙여넣기 하세요' : '📋 구글 시트용 복사 (Ctrl+V로 붙여넣기)'}
              </button>

              {/* 테이블 */}
              <div style={{ overflowX:'auto' }}>
                <table style={s.table}>
                  <thead>
                    <tr style={{ background:'#f5f5f5' }}>
                      {['제약사','제품명','규격','상태','날짜','비고'].map(h => (
                        <th key={h} style={s.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(result.items || []).map((it, i) => {
                      const sc = STATUS_COLOR[it.status] || { bg:'#f5f5f5', color:'#333' };
                      return (
                        <tr key={i} style={{ borderBottom:'1px solid #eee' }}>
                          <td style={s.td}>{it.manufacturer || '-'}</td>
                          <td style={{ ...s.td, fontWeight:500 }}>{it.product_name}</td>
                          <td style={s.td}>{it.spec || '-'}</td>
                          <td style={s.td}>
                            <span style={{ ...s.badge, background:sc.bg, color:sc.color }}>
                              {it.status}
                            </span>
                          </td>
                          <td style={s.td}>{it.date || '-'}</td>
                          <td style={{ ...s.td, fontSize:12, color:'#555' }}>{it.note || '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const s = {
  wrap:    { minHeight:'100vh', background:'#f5f5f5', display:'flex', justifyContent:'center', padding:'32px 16px' },
  card:    { background:'#fff', borderRadius:16, padding:'28px 24px', width:'100%', maxWidth:700, height:'fit-content', boxShadow:'0 2px 16px rgba(0,0,0,0.08)' },
  title:   { fontSize:22, fontWeight:700, margin:'0 0 4px' },
  sub:     { fontSize:13, color:'#888', margin:'0 0 20px' },
  drop:    { border:'2px dashed #ccc', borderRadius:12, padding:'36px 20px', textAlign:'center', cursor:'pointer', background:'#fafafa' },
  dropTxt: { fontSize:15, color:'#333', margin:'8px 0 4px' },
  dropSub: { fontSize:13, color:'#999', margin:0 },
  img:     { maxWidth:'100%', maxHeight:220, borderRadius:10, border:'1px solid #eee' },
  btnRow:  { display:'flex', gap:8, marginTop:10, justifyContent:'center' },
  btnBlue: { background:'#3B82F6', color:'#fff', border:'none', borderRadius:8, padding:'10px 20px', fontSize:14, fontWeight:600, cursor:'pointer' },
  btnGray: { background:'#fff', color:'#333', border:'1px solid #ddd', borderRadius:8, padding:'10px 16px', fontSize:14, cursor:'pointer' },
  err:     { background:'#FCEBEB', color:'#A32D2D', borderRadius:8, padding:'10px 14px', fontSize:13, marginTop:12 },
  summary: { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 },
  table:   { width:'100%', borderCollapse:'collapse', fontSize:13 },
  th:      { padding:'8px 10px', textAlign:'left', fontWeight:500, fontSize:13, whiteSpace:'nowrap' },
  td:      { padding:'8px 10px', verticalAlign:'top' },
  badge:   { fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:99, whiteSpace:'nowrap' },
};
