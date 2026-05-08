import { useState, useRef, useEffect } from 'react';
import Head from 'next/head';

let XLSX = null;

const STATUS_LIST = [
  '판매중','품절','입고예정','일부규격품절',
  '생산&공급중단','미정','입고완료','정산','신규금지','기타정책'
];

const COL = { manufacturer:0, product:1, spec:2, status:3, date:4, note:5 };

function drugIdentity(str) {
  return (str || '').toLowerCase()
    .replace(/[()（）\[\]]/g, '')
    .replace(/\s+/g, '')
    .replace(/\d+(t|c|관|포|병|앰플|바이알|b|a)(?![a-z가-힣])/gi, '')
    .replace(/ptp/gi, '')
    .replace(/alu-?alu/gi, '')
    .trim();
}

function matchScore(a, b) {
  const da = drugIdentity(a), db = drugIdentity(b);
  if (!da || !db) return 0;
  if (da === db) return 1;
  if (da.includes(db) || db.includes(da)) return 0.9;
  let m = 0;
  const len = Math.min(da.length, db.length);
  for (let i = 0; i < len; i++) if (da[i] === db[i]) m++;
  return m / Math.max(da.length, db.length);
}

// ★ DOM에서 테이블 데이터 읽기
function readFromDOM() {
  const tableRows = document.querySelectorAll('table tbody tr');
  return Array.from(tableRows).map(tr => {
    const inputs = tr.querySelectorAll('input');
    const select = tr.querySelector('select');
    return {
      manufacturer: inputs[0]?.value || '',
      product_name: inputs[1]?.value || '',
      spec:         inputs[2]?.value || '',
      status:       select?.value || '',
      date:         inputs[3]?.value || '',
      note:         inputs[4]?.value || '',
    };
  }).filter(it => it.product_name.trim());
}

export default function Home() {
  const imgRef = useRef();
  const xlsRef = useRef();

  const [step, setStep] = useState(1);
  const [imgPreview, setImgPreview] = useState(null);
  const [imgBase64, setImgBase64] = useState('');
  const [imgMime, setImgMime] = useState('image/jpeg');
  const [loading, setLoading] = useState(false);
  const [supplier, setSupplier] = useState('');
  const [noticeDate, setNoticeDate] = useState('');
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => { import('xlsx').then(mod => { XLSX = mod; }); }, []);

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
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: imgBase64, mimeType: imgMime }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSupplier(data.supplier || '');
      setNoticeDate(data.notice_date || '');
      setItems((data.items || []).map((it, i) => ({
        id: i,
        manufacturer: data.supplier || '',
        product_name: it.product_name || '',
        spec: it.spec || '',
        status: it.status || '미정',
        date: it.exact_date || '',
        note: [it.vague_date, it.note].filter(Boolean).join(' / '),
      })));
      setSaved(false);
      setStep(2);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  function addRow() {
    setItems(prev => [...prev, {
      id: Date.now(), manufacturer: supplier,
      product_name: '', spec: '', status: '미정', date: '', note: ''
    }]);
  }
  function deleteRow(id) {
    setItems(prev => prev.filter(it => it.id !== id));
  }

  // ★ 저장: 추출 데이터만 별도 Excel로 다운로드 (확인용)
  function saveExtracted() {
    if (!XLSX) return;
    const currentItems = readFromDOM();
    if (currentItems.length === 0) { alert('데이터가 없어요.'); return; }

    const supplierVal = document.getElementById('inp-supplier')?.value || '';
    const dateVal = document.getElementById('inp-date')?.value || '';

    const headers = ['제약사', '제품명', '규격', '상태', '입고/품절 날짜', '비고'];
    const data = [
      [`공급사: ${supplierVal}`, `날짜: ${dateVal}`, '', '', '', `총 ${currentItems.length}건`],
      [],
      headers,
      ...currentItems.map(it => [
        it.manufacturer, it.product_name, it.spec, it.status, it.date, it.note
      ])
    ];

    const ws = XLSX.utils.aoa_to_sheet(data);

    // 날짜 컬럼 문자열 강제
    data.forEach((row, ri) => {
      if (ri < 3) return;
      const val = row[4];
      if (val) {
        const addr = XLSX.utils.encode_cell({ r: ri, c: 4 });
        ws[addr] = { v: String(val), t: 's' };
      }
    });

    // 컬럼 너비
    ws['!cols'] = [
      { wch: 14 }, { wch: 28 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 30 }
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '추출데이터');
    XLSX.writeFile(wb, `추출_${supplierVal}_${dateVal}.xlsx`);
    setSaved(true);
  }

  // ★ 기존 Excel에 반영
  function handleExcel(file) {
    if (!file || !XLSX) return;
    const currentItems = readFromDOM();
    if (currentItems.length === 0) { alert('적용할 데이터가 없어요.'); return; }

    const reader = new FileReader();
    reader.onload = e => {
      const wb = XLSX.read(e.target.result, { type: 'array', cellDates: false });
      const wsName = wb.SheetNames[0];
      const ws = wb.Sheets[wsName];
      const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });

      // 빈 행 제거
      const lastDataIdx = allRows.reduce((last, row, i) =>
        row.some(c => c !== '' && c !== null && c !== undefined) ? i : last, 0);
      const rows = allRows.slice(0, lastDataIdx + 1);

      const headerIdx = rows.findIndex(r =>
        Array.isArray(r) && r.some(c => String(c).trim() === '제품명')
      );
      if (headerIdx < 0) { alert('제품명 헤더를 찾을 수 없어요.'); return; }

      const dataRows = rows.slice(headerIdx + 1);
      let updateCount = 0, addCount = 0;
      const log = [];

      currentItems.forEach(item => {
        let bestIdx = -1, bestScore = 0;
        dataRows.forEach((r, idx) => {
          const score = matchScore(String(r[COL.product] || ''), item.product_name);
          if (score > bestScore) { bestScore = score; bestIdx = idx; }
        });

        if (bestScore >= 0.85 && bestIdx >= 0) {
          const ri = headerIdx + 1 + bestIdx;
          const oldName = String(rows[ri][COL.product] || '');
          rows[ri][COL.status] = item.status;
          if (item.date) rows[ri][COL.date] = item.date;
          if (item.note) rows[ri][COL.note] = item.note;
          log.push(`✏️ "${oldName}" ← 상태:${item.status} (유사도:${(bestScore*100).toFixed(0)}%)`);
          updateCount++;
        } else {
          const newRow = new Array(8).fill('');
          newRow[COL.manufacturer] = item.manufacturer;
          newRow[COL.product]      = item.product_name;
          newRow[COL.spec]         = item.spec;
          newRow[COL.status]       = item.status;
          newRow[COL.date]         = item.date;
          newRow[COL.note]         = item.note;
          rows.push(newRow);
          log.push(`➕ "${item.product_name}" 신규추가`);
          addCount++;
        }
      });

      const newWs = XLSX.utils.aoa_to_sheet(rows);
      rows.forEach((row, ri) => {
        const val = row[COL.date];
        if (val !== '' && val !== null && val !== undefined) {
          const addr = XLSX.utils.encode_cell({ r: ri, c: COL.date });
          newWs[addr] = { v: String(val), t: 's' };
        }
      });

      wb.Sheets[wsName] = newWs;
      const d = new Date();
      const ds = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
      XLSX.writeFile(wb, `히스토바이오_제품_유통_현황_${ds}.xlsx`);

      console.log(log.join('\n'));
      alert(`✅ 완료!\n업데이트: ${updateCount}건 / 신규추가: ${addCount}건\n\n${log.join('\n')}`);
    };
    reader.readAsArrayBuffer(file);
  }

  const s = {
    wrap:     { minHeight:'100vh', background:'#f5f5f5', display:'flex', justifyContent:'center', padding:'24px 16px' },
    card:     { background:'#fff', borderRadius:16, padding:'24px 20px', width:'100%', maxWidth:980, height:'fit-content', boxShadow:'0 2px 16px rgba(0,0,0,.08)' },
    steps:    { display:'flex', gap:6, marginBottom:20 },
    dot:      (a,d) => ({ flex:1, padding:'7px 0', textAlign:'center', fontSize:13, fontWeight:500, borderRadius:8, background: d?'#EAF3DE':a?'#E6F1FB':'#f5f5f5', color: d?'#3B6D11':a?'#185FA5':'#999', border: d?'1px solid #3B6D11':a?'1px solid #185FA5':'1px solid #eee' }),
    drop:     { border:'2px dashed #ccc', borderRadius:12, padding:'32px 20px', textAlign:'center', cursor:'pointer', background:'#fafafa' },
    btnBlue:  { background:'#3B82F6', color:'#fff', border:'none', borderRadius:8, padding:'10px 20px', fontSize:14, fontWeight:600, cursor:'pointer' },
    btnGray:  { background:'#fff', color:'#333', border:'1px solid #ddd', borderRadius:8, padding:'10px 16px', fontSize:14, cursor:'pointer' },
    btnGreen: { background:'#22c55e', color:'#fff', border:'none', borderRadius:8, padding:'11px 28px', fontSize:15, fontWeight:700, cursor:'pointer' },
    btnOrange:{ background:'#f59e0b', color:'#fff', border:'none', borderRadius:8, padding:'10px 20px', fontSize:14, fontWeight:600, cursor:'pointer' },
    inp:      { border:'1px solid #e5e7eb', borderRadius:6, padding:'5px 7px', fontSize:13, width:'100%', background:'#fff', color:'#111', boxSizing:'border-box' },
    sel:      { border:'1px solid #e5e7eb', borderRadius:6, padding:'5px 4px', fontSize:12, background:'#fff', color:'#111', width:'100%' },
    th:       { padding:'8px 6px', fontSize:12, fontWeight:600, background:'#f8f9fa', color:'#555', textAlign:'left', whiteSpace:'nowrap', borderBottom:'2px solid #e5e7eb' },
    td:       { padding:'4px', verticalAlign:'middle', borderBottom:'1px solid #f3f3f3' },
    err:      { background:'#FCEBEB', color:'#A32D2D', borderRadius:8, padding:'10px 14px', fontSize:13, marginTop:10 },
    info:     { background:'#EAF3DE', color:'#3B6D11', borderRadius:8, padding:'8px 14px', fontSize:13, marginTop:8 },
  };

  return (
    <>
      <Head><title>재고 이슈 알리미</title></Head>
      <div style={s.wrap}>
        <div style={s.card}>
          <h1 style={{ fontSize:20, fontWeight:700, margin:'0 0 4px' }}>📦 재고 이슈 알리미</h1>
          <p style={{ fontSize:13, color:'#888', margin:'0 0 16px' }}>이미지 분석 → 수기 수정 → 저장 확인 → Excel 반영</p>

          <div style={s.steps}>
            {['① 이미지 분석','② 내용 확인·수정','③ Excel 반영'].map((label,i) => (
              <div key={i} style={s.dot(step===i+1, step>i+1)}>{label}</div>
            ))}
          </div>

          {/* ── STEP 1 ── */}
          {step === 1 && (
            <>
              {!imgPreview ? (
                <div style={s.drop}
                  onClick={() => imgRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); handleImg(e.dataTransfer.files[0]); }}>
                  <div style={{ fontSize:40 }}>📸</div>
                  <p style={{ fontSize:15, margin:'8px 0 4px' }}><strong>공급사 안내 이미지 업로드</strong></p>
                  <p style={{ fontSize:13, color:'#999', margin:0 }}>카톡 캡처, 공문 사진 등</p>
                  <input type="file" ref={imgRef} accept="image/*" style={{ display:'none' }}
                    onChange={e => handleImg(e.target.files[0])} />
                </div>
              ) : (
                <div style={{ textAlign:'center', marginBottom:12 }}>
                  <img src={imgPreview} alt="미리보기"
                    style={{ maxWidth:'100%', maxHeight:220, borderRadius:8, border:'1px solid #eee' }} />
                </div>
              )}
              {error && <div style={s.err}>❌ {error}</div>}
              <div style={{ display:'flex', gap:8, marginTop:10 }}>
                <button style={{ ...s.btnBlue, flex:1 }} onClick={analyze} disabled={!imgBase64||loading}>
                  {loading ? '⏳ AI 분석 중...' : '✨ AI 분석 시작'}
                </button>
                {imgPreview && (
                  <button style={s.btnGray}
                    onClick={() => { setImgPreview(null); setImgBase64(''); setError(''); }}>
                    ↩ 다시
                  </button>
                )}
              </div>
            </>
          )}

          {/* ── STEP 2 ── */}
          {step === 2 && (
            <>
              <div style={{ display:'flex', gap:10, marginBottom:14, flexWrap:'wrap', alignItems:'flex-end' }}>
                <div style={{ flex:1, minWidth:150 }}>
                  <div style={{ fontSize:12, color:'#888', marginBottom:3 }}>공급사</div>
                  <input id="inp-supplier" style={s.inp} defaultValue={supplier} />
                </div>
                <div style={{ flex:1, minWidth:130 }}>
                  <div style={{ fontSize:12, color:'#888', marginBottom:3 }}>안내 날짜</div>
                  <input id="inp-date" style={s.inp} defaultValue={noticeDate} />
                </div>
                <div style={{ fontSize:13, color:'#888', paddingBottom:6 }}>총 {items.length}건</div>
              </div>

              {/* 테이블 */}
              <div style={{ overflowX:'auto', marginBottom:10 }}>
                <table style={{ width:'100%', borderCollapse:'collapse', minWidth:820 }}>
                  <thead>
                    <tr>
                      {['제약사','제품명','규격','상태','날짜','비고',''].map((h,i) => (
                        <th key={i} style={s.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(item => (
                      <tr key={item.id}>
                        <td style={{ ...s.td, width:90 }}>
                          <input style={s.inp} defaultValue={item.manufacturer} />
                        </td>
                        <td style={{ ...s.td, width:175 }}>
                          <input style={{ ...s.inp, fontWeight:500 }} defaultValue={item.product_name} />
                        </td>
                        <td style={{ ...s.td, width:100 }}>
                          <input style={s.inp} defaultValue={item.spec} />
                        </td>
                        <td style={{ ...s.td, width:118 }}>
                          <select style={s.sel} defaultValue={item.status}>
                            {STATUS_LIST.map(st => <option key={st} value={st}>{st}</option>)}
                          </select>
                        </td>
                        <td style={{ ...s.td, width:85 }}>
                          <input style={s.inp} defaultValue={item.date} placeholder="5월 6일" />
                        </td>
                        <td style={s.td}>
                          <input style={s.inp} defaultValue={item.note} />
                        </td>
                        <td style={{ ...s.td, width:26, textAlign:'center' }}>
                          <button onClick={() => deleteRow(item.id)}
                            style={{ background:'none', border:'none', color:'#bbb', cursor:'pointer', fontSize:16 }}>
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 버튼 영역 */}
              <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginTop:8 }}>
                <button style={{ ...s.btnGray, fontSize:13 }} onClick={addRow}>+ 행 추가</button>
                <button style={s.btnOrange} onClick={saveExtracted}>
                  💾 저장 (확인용 다운로드)
                </button>
                <div style={{ flex:1 }} />
                <button style={s.btnGray} onClick={() => { setStep(1); setSaved(false); }}>↩ 다시 분석</button>
                <button style={s.btnGreen} onClick={() => xlsRef.current?.click()}>
                  📊 기존 Excel에 반영
                </button>
                <input type="file" ref={xlsRef} accept=".xlsx,.xls" style={{ display:'none' }}
                  onChange={e => { if (e.target.files[0]) handleExcel(e.target.files[0]); }} />
              </div>

              {saved && (
                <div style={s.info}>
                  ✅ 저장 완료! 다운로드한 파일에서 데이터를 확인한 후, "기존 Excel에 반영" 버튼으로 병합하세요.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
