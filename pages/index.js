import { useState, useRef, useEffect } from 'react';
import Head from 'next/head';

let XLSX = null;

function normalize(str) {
  return (str || '').replace(/\s+/g, '').replace(/[^\w가-힣]/g, '').toLowerCase();
}

function isExactDate(str) {
  return str && /\d+\s*일/.test(str);
}

function buildNote(item) {
  const parts = [];
  if (item.vague_date) parts.push(item.vague_date);
  if (item.note) parts.push(item.note);
  return parts.join(' / ') || null;
}

export default function Home() {
  const [step, setStep] = useState(1);
  const [imgPreview, setImgPreview] = useState(null);
  const [imgBase64, setImgBase64] = useState('');
  const [imgMime, setImgMime] = useState('image/jpeg');
  const [loading, setLoading] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [excelData, setExcelData] = useState(null);
  const [excelWb, setExcelWb] = useState(null);
  const [matchResult, setMatchResult] = useState(null);
  const [error, setError] = useState('');
  const imgRef = useRef();
  const xlsRef = useRef();

  useEffect(() => {
    import('xlsx').then(mod => { XLSX = mod; });
  }, []);

  function handleImg(file) {
    if (!file) return;
    setImgMime(file.type || 'image/jpeg');
    const reader = new FileReader();
    reader.onload = e => {
      setImgPreview(e.target.result);
      setImgBase64(e.target.result.split(',')[1]);
    };
    reader.readAsDataURL(file);
  }

  async function analyze() {
    if (!imgBase64) return;
    setLoading(true); setError(''); setAiResult(null);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: imgBase64, mimeType: imgMime }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAiResult(data);
      setStep(2);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  function handleExcel(file) {
    if (!file || !XLSX) return;
    const reader = new FileReader();
    reader.onload = e => {
      const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      // 헤더 행 찾기 (제품명 포함)
      const headerIdx = rows.findIndex(r => r.includes('제품명'));
      setExcelData({ rows, headerIdx, ws });
      setExcelWb(wb);
      doMatch(data => data, { rows, headerIdx }, wb);
    };
    reader.readAsArrayBuffer(file);
  }

  function doMatch(_, exData, wb) {
    if (!aiResult || !exData) return;
    const { rows, headerIdx } = exData;
    const headers = rows[headerIdx] || [];
    const colIdx = {
      manufacturer: headers.indexOf('제약사'),
      product: headers.indexOf('제품명'),
      spec: headers.indexOf('규격'),
      status: headers.indexOf('상태'),
      date: headers.indexOf('입고/품절 날짜'),
      note: headers.indexOf('비고'),
    };

    const dataRows = rows.slice(headerIdx + 1);
    const results = aiResult.items.map(item => {
      const normItem = normalize(item.product_name);
      const rowIdx = dataRows.findIndex(r =>
        normalize(String(r[colIdx.product] || '')) === normItem
      );
      const exactDate = item.exact_date || null;
      const noteText = buildNote(item);

      if (rowIdx >= 0) {
        return {
          type: 'update',
          product_name: item.product_name,
          manufacturer: item.manufacturer,
          spec: item.spec,
          status: item.status,
          exact_date: exactDate,
          note: noteText,
          excelRow: headerIdx + 1 + rowIdx,
          existingStatus: String(dataRows[rowIdx][colIdx.status] || ''),
          colIdx,
        };
      } else {
        return {
          type: 'add',
          product_name: item.product_name,
          manufacturer: item.manufacturer || aiResult.supplier,
          spec: item.spec,
          status: item.status,
          exact_date: exactDate,
          note: noteText,
          colIdx,
        };
      }
    });

    setMatchResult({ results, colIdx, headerIdx });
    setStep(3);
  }

  function handleExcelUpload(file) {
    if (!file || !XLSX) return;
    const reader = new FileReader();
    reader.onload = e => {
      const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      const headerIdx = rows.findIndex(r => Array.isArray(r) && r.includes('제품명'));
      const exData = { rows, headerIdx, ws };
      setExcelData(exData);
      setExcelWb(wb);
      doMatch(null, exData, wb);
    };
    reader.readAsArrayBuffer(file);
  }

  function downloadUpdated() {
    if (!excelWb || !matchResult || !excelData) return;
    const wb = excelWb;
    const wsName = wb.SheetNames[0];
    const ws = wb.Sheets[wsName];
    const rows = [...excelData.rows];
    const { results, colIdx, headerIdx } = matchResult;

    results.forEach(r => {
      if (r.type === 'update') {
        const ri = r.excelRow;
        if (!rows[ri]) rows[ri] = [];
        rows[ri][colIdx.status] = r.status;
        if (r.exact_date) rows[ri][colIdx.date] = r.exact_date;
        if (r.note) {
          const existing = rows[ri][colIdx.note] || '';
          rows[ri][colIdx.note] = r.note;
        }
      } else {
        const newRow = new Array(Math.max(...Object.values(colIdx)) + 1).fill('');
        if (colIdx.manufacturer >= 0) newRow[colIdx.manufacturer] = r.manufacturer || aiResult.supplier || '';
        newRow[colIdx.product] = r.product_name;
        if (colIdx.spec >= 0) newRow[colIdx.spec] = r.spec || '';
        newRow[colIdx.status] = r.status;
        if (r.exact_date && colIdx.date >= 0) newRow[colIdx.date] = r.exact_date;
        if (r.note && colIdx.note >= 0) newRow[colIdx.note] = r.note;
        rows.push(newRow);
      }
    });

    const newWs = XLSX.utils.aoa_to_sheet(rows);
    wb.Sheets[wsName] = newWs;
    XLSX.writeFile(wb, `히스토바이오_제품_유통_현황_${new Date().toLocaleDateString('ko-KR').replace(/\. /g,'-').replace('.','')}.xlsx`);
  }

  const s = {
    wrap: { minHeight: '100vh', background: '#f5f5f5', display: 'flex', justifyContent: 'center', padding: '32px 16px' },
    card: { background: '#fff', borderRadius: 16, padding: '28px 24px', width: '100%', maxWidth: 680, height: 'fit-content', boxShadow: '0 2px 16px rgba(0,0,0,.08)' },
    title: { fontSize: 22, fontWeight: 700, margin: '0 0 4px' },
    sub: { fontSize: 13, color: '#888', margin: '0 0 24px' },
    steps: { display: 'flex', gap: 8, marginBottom: 24 },
    stepDot: (active, done) => ({ flex: 1, padding: '8px 0', textAlign: 'center', fontSize: 13, fontWeight: 500, borderRadius: 8, background: done ? '#EAF3DE' : active ? '#E6F1FB' : '#f5f5f5', color: done ? '#3B6D11' : active ? '#185FA5' : '#999', border: done ? '1px solid #3B6D11' : active ? '1px solid #185FA5' : '1px solid #eee' }),
    drop: { border: '2px dashed #ccc', borderRadius: 12, padding: '32px 20px', textAlign: 'center', cursor: 'pointer', background: '#fafafa', marginBottom: 12 },
    btnBlue: { background: '#3B82F6', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer', width: '100%', marginTop: 8 },
    btnGreen: { background: '#22c55e', color: '#fff', border: 'none', borderRadius: 8, padding: '12px 20px', fontSize: 15, fontWeight: 700, cursor: 'pointer', width: '100%', marginTop: 12 },
    badge: (type) => ({ fontSize: 11, padding: '2px 8px', borderRadius: 99, fontWeight: 600, background: type === 'update' ? '#E6F1FB' : '#EAF3DE', color: type === 'update' ? '#185FA5' : '#3B6D11' }),
    row: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '10px 0', borderBottom: '1px solid #f0f0f0', fontSize: 13 },
    err: { background: '#FCEBEB', color: '#A32D2D', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginTop: 12 },
  };

  return (
    <>
      <Head><title>재고 이슈 알리미</title></Head>
      <div style={s.wrap}>
        <div style={s.card}>
          <h1 style={s.title}>📦 재고 이슈 알리미</h1>
          <p style={s.sub}>공급사 이미지 → AI 분석 → Excel 자동 업데이트</p>

          <div style={s.steps}>
            {['① 이미지 분석', '② Excel 업로드', '③ 확인 & 다운로드'].map((label, i) => (
              <div key={i} style={s.stepDot(step === i+1, step > i+1)}>{label}</div>
            ))}
          </div>

          {step === 1 && (
            <>
              {!imgPreview ? (
                <div style={s.drop} onClick={() => imgRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); handleImg(e.dataTransfer.files[0]); }}>
                  <div style={{ fontSize: 36 }}>📸</div>
                  <p style={{ fontSize: 15, margin: '8px 0 4px' }}><strong>공급사 안내 이미지 업로드</strong></p>
                  <p style={{ fontSize: 13, color: '#999', margin: 0 }}>품절·입고·생산중단 캡처 이미지</p>
                  <input type="file" ref={imgRef} accept="image/*" style={{ display: 'none' }}
                    onChange={e => handleImg(e.target.files[0])} />
                </div>
              ) : (
                <div style={{ textAlign: 'center', marginBottom: 12 }}>
                  <img src={imgPreview} alt="미리보기" style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 8, border: '1px solid #eee' }} />
                </div>
              )}
              {error && <div style={s.err}>❌ {error}</div>}
              <button style={s.btnBlue} onClick={analyze} disabled={!imgBase64 || loading}>
                {loading ? '⏳ AI 분석 중...' : '✨ AI 분석 시작'}
              </button>
              {imgPreview && <button style={{ ...s.btnBlue, background: '#fff', color: '#333', border: '1px solid #ddd', marginTop: 6 }}
                onClick={() => { setImgPreview(null); setImgBase64(''); setError(''); }}>↩ 다시 선택</button>}
            </>
          )}

          {step === 2 && aiResult && (
            <>
              <div style={{ background: '#f8f9fa', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
                <p style={{ fontSize: 14, fontWeight: 600, margin: '0 0 4px' }}>✅ AI 분석 완료</p>
                <p style={{ fontSize: 13, color: '#666', margin: 0 }}>
                  {aiResult.supplier} · {aiResult.notice_date} · {aiResult.items?.length}개 제품 추출
                </p>
              </div>
              <div style={s.drop} onClick={() => xlsRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); handleExcelUpload(e.dataTransfer.files[0]); }}>
                <div style={{ fontSize: 36 }}>📊</div>
                <p style={{ fontSize: 15, margin: '8px 0 4px' }}><strong>히스토바이오 Excel 파일 업로드</strong></p>
                <p style={{ fontSize: 13, color: '#999', margin: 0 }}>히스토바이오_제품_유통_현황_리스트.xlsx</p>
                <input type="file" ref={xlsRef} accept=".xlsx,.xls" style={{ display: 'none' }}
                  onChange={e => handleExcelUpload(e.target.files[0])} />
              </div>
              <button style={{ ...s.btnBlue, background: '#fff', color: '#333', border: '1px solid #ddd', marginTop: 8 }}
                onClick={() => setStep(1)}>↩ 이미지 다시 분석</button>
            </>
          )}

          {step === 3 && matchResult && (
            <>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <div style={{ flex: 1, background: '#E6F1FB', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#185FA5' }}>
                    {matchResult.results.filter(r => r.type === 'update').length}
                  </div>
                  <div style={{ fontSize: 12, color: '#185FA5' }}>기존 업데이트</div>
                </div>
                <div style={{ flex: 1, background: '#EAF3DE', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#3B6D11' }}>
                    {matchResult.results.filter(r => r.type === 'add').length}
                  </div>
                  <div style={{ fontSize: 12, color: '#3B6D11' }}>신규 추가</div>
                </div>
              </div>

              <div style={{ maxHeight: 340, overflowY: 'auto', marginBottom: 8 }}>
                {matchResult.results.map((r, i) => (
                  <div key={i} style={s.row}>
                    <div style={{ flex: 1 }}>
                      <span style={s.badge(r.type)}>{r.type === 'update' ? '기존 업데이트' : '신규 추가'}</span>
                      <span style={{ marginLeft: 8, fontWeight: 500 }}>{r.product_name}</span>
                      {r.spec && <span style={{ marginLeft: 4, color: '#999', fontSize: 12 }}>{r.spec}</span>}
                      <div style={{ marginTop: 4, fontSize: 12, color: '#666' }}>
                        상태: <strong>{r.status}</strong>
                        {r.exact_date && <> · 날짜: <strong>{r.exact_date}</strong></>}
                        {r.note && <> · {r.note}</>}
                        {r.type === 'update' && r.existingStatus && r.existingStatus !== r.status &&
                          <span style={{ color: '#e55', marginLeft: 6 }}>{r.existingStatus} → {r.status}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <button style={s.btnGreen} onClick={downloadUpdated}>
                ⬇️ 업데이트된 Excel 다운로드
              </button>
              <button style={{ ...s.btnBlue, background: '#fff', color: '#333', border: '1px solid #ddd', marginTop: 8 }}
                onClick={() => { setStep(1); setAiResult(null); setMatchResult(null); setImgPreview(null); setImgBase64(''); }}>
                🔄 처음부터 다시
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
