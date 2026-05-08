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
    .replace(/ptp/gi, '').replace(/alu-?alu/gi, '').trim();
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
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ current:0, total:0 });
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [failedImages, setFailedImages] = useState([]);

  useEffect(() => { import('xlsx').then(mod => { XLSX = mod; }); }, []);

  function handleImages(files) {
    const fileArray = Array.from(files).slice(0, 30);
    if (fileArray.length === 0) return;
    const promises = fileArray.map(file => new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = e => resolve({
        preview: e.target.result,
        base64: e.target.result.split(',')[1],
        mime: file.type || 'image/jpeg',
        name: file.name,
      });
      reader.readAsDataURL(file);
    }));
    Promise.all(promises).then(results => setImages(prev => [...prev, ...results].slice(0, 30)));
  }

  function removeImage(idx) {
    setImages(prev => prev.filter((_, i) => i !== idx));
  }

  async function analyzeAll() {
    if (images.length === 0) return;
    setLoading(true); setError(''); setFailedImages([]);
    const allItems = [];
    const failed = [];

    for (let i = 0; i < images.length; i++) {
      setProgress({ current: i + 1, total: images.length });
      try {
        const res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: images[i].base64, mimeType: images[i].mime }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        const supplier = data.supplier || '';
        (data.items || []).forEach(it => {
          allItems.push({
            id: Date.now() + Math.random(),
            manufacturer: supplier,
            product_name: it.product_name || '',
            spec: it.spec || '',
            status: it.status || '미정',
            date: it.exact_date || '',
            note: [it.vague_date, it.note].filter(Boolean).join(' / '),
          });
        });
      } catch (e) {
        failed.push(`${images[i].name}: ${e.message}`);
      }
    }

    setItems(allItems);
    setFailedImages(failed);
    setLoading(false);
    setSaved(false);
    setStep(2);
  }

  function addRow() {
    setItems(prev => [...prev, {
      id: Date.now(), manufacturer: '',
      product_name: '', spec: '', status: '미정', date: '', note: ''
    }]);
  }
  function deleteRow(id) {
    setItems(prev => prev.filter(it => it.id !== id));
  }

  function saveExtracted() {
    if (!XLSX) return;
    const currentItems = readFromDOM();
    if (currentItems.length === 0) { alert('데이터가 없어요.'); return; }

    const headers = ['제약사', '제품명', '규격', '상태', '입고/품절 날짜', '비고'];
    const data = [
      headers,
      ...currentItems.map(it => [it.manufacturer, it.product_name, it.spec, it.status, it.date, it.note])
    ];

    const ws = XLSX.utils.aoa_to_sheet(data);
    data.forEach((row, ri) => {
      if (ri < 1) return;
      const val = row[4];
      if (val) ws[XLSX.utils.encode_cell({ r: ri, c: 4 })] = { v: String(val), t: 's' };
    });
    ws['!cols'] = [{ wch:14 },{ wch:28 },{ wch:18 },{ wch:14 },{ wch:14 },{ wch:30 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '추출데이터');
    const d = new Date();
    const ds = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    XLSX.writeFile(wb, `추출데이터_${ds}.xlsx`);
    setSaved(true);
  }

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
          log.push(`✏️ "${oldName}" ← ${item.status} (${(bestScore*100).toFixed(0)}%)`);
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
          log.push(`➕ "${item.product_name}" 신규`);
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
      alert(`✅ 완료!\n업데이트: ${updateCount}건 / 신규추가: ${addCount}건\n\n${log.slice(0,20).join('\n')}${log.length > 20 ? `\n...외 ${log.length-20}건` : ''}`);
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
    th:       { padding:'8px 6px', fontSize:12, fontWeight:600, background:'#f8f9fa', color:'#555', textAlign:'left', whiteSpace:'nowrap', borderBottom:'2px solid #e5e7eb', position:'sticky', top:0, zIndex:1 },
    td:       { padding:'4px', verticalAlign:'middle', borderBottom:'1px solid #f3f3f3' },
    err:      { background:'#FCEBEB', color:'#A32D2D', borderRadius:8, padding:'10px 14px', fontSize:13, marginTop:10 },
    info:     { background:'#EAF3DE', color:'#3B6D11', borderRadius:8, padding:'8px 14px', fontSize:13, marginTop:8 },
    warn:     { background:'#FAEEDA', color:'#854F0B', borderRadius:8, padding:'8px 14px', fontSize:13, marginTop:8 },
    thumb:    { width:64, height:64, objectFit:'cover', borderRadius:6, border:'1px solid #eee' },
    thumbX:   { position:'absolute', top:-4, right:-4, background:'#e55', color:'#fff', border:'none', borderRadius:'50%', width:18, height:18, fontSize:11, cursor:'pointer', lineHeight:'18px', textAlign:'center', padding:0 },
    progress: { width:'100%', height:6, background:'#e5e7eb', borderRadius:3, overflow:'hidden', marginTop:12 },
    bar:      (pct) => ({ width:`${pct}%`, height:'100%', background:'#3B82F6', borderRadius:3, transition:'width 0.3s' }),
  };

  return (
    <>
      <Head><title>재고 이슈 알리미</title></Head>
      <div style={s.wrap}>
        <div style={s.card}>
          <h1 style={{ fontSize:20, fontWeight:700, margin:'0 0 4px' }}>📦 재고 이슈 알리미</h1>
          <p style={{ fontSize:13, color:'#888', margin:'0 0 16px' }}>이미지 분석 → 수기 수정 → 저장 확인 → Excel 반영</p>

          <div style={s.steps}>
            {['① 이미지 업로드','② 내용 확인·수정','③ Excel 반영'].map((label,i) => (
              <div key={i} style={s.dot(step===i+1, step>i+1)}>{label}</div>
            ))}
          </div>

          {/* ── STEP 1 ── */}
          {step === 1 && (
            <>
              <div style={s.drop}
                onClick={() => imgRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); handleImages(e.dataTransfer.files); }}>
                <div style={{ fontSize:40 }}>📸</div>
                <p style={{ fontSize:15, margin:'8px 0 4px' }}>
                  <strong>공급사 안내 이미지 업로드</strong> (최대 30장)
                </p>
                <p style={{ fontSize:13, color:'#999', margin:0 }}>여러 장 선택 가능 · 클릭 또는 드래그</p>
                <input type="file" ref={imgRef} accept="image/*" multiple style={{ display:'none' }}
                  onChange={e => handleImages(e.target.files)} />
              </div>

              {images.length > 0 && (
                <>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginTop:12 }}>
                    {images.map((img, i) => (
                      <div key={i} style={{ position:'relative' }}>
                        <img src={img.preview} alt={img.name} style={s.thumb} />
                        <button style={s.thumbX} onClick={() => removeImage(i)}>✕</button>
                      </div>
                    ))}
                  </div>
                  <p style={{ fontSize:13, color:'#666', margin:'8px 0 0' }}>
                    {images.length}장 선택됨 {images.length >= 30 && '(최대)'}
                  </p>
                </>
              )}

              {loading && (
                <div style={{ marginTop:16 }}>
                  <p style={{ fontSize:14, color:'#185FA5', fontWeight:500, margin:'0 0 6px' }}>
                    ⏳ {progress.current} / {progress.total} 분석 중...
                  </p>
                  <div style={s.progress}>
                    <div style={s.bar(progress.total ? (progress.current / progress.total) * 100 : 0)} />
                  </div>
                </div>
              )}

              {error && <div style={s.err}>❌ {error}</div>}

              <div style={{ display:'flex', gap:8, marginTop:12 }}>
                <button style={{ ...s.btnBlue, flex:1 }} onClick={analyzeAll}
                  disabled={images.length === 0 || loading}>
                  {loading ? `⏳ ${progress.current}/${progress.total} 분석 중...` : `✨ AI 분석 시작 (${images.length}장)`}
                </button>
                {images.length > 0 && !loading && (
                  <button style={s.btnGray} onClick={() => setImages([])}>전체 삭제</button>
                )}
              </div>
            </>
          )}

          {/* ── STEP 2 ── */}
          {step === 2 && (
            <>
              <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:12, flexWrap:'wrap' }}>
                <span style={{ fontSize:14, fontWeight:600 }}>
                  총 {items.length}건 추출 ({images.length}장 분석)
                </span>
                {failedImages.length > 0 && (
                  <span style={{ fontSize:12, color:'#A32D2D' }}>
                    ⚠️ {failedImages.length}장 실패
                  </span>
                )}
              </div>

              {failedImages.length > 0 && (
                <div style={s.warn}>
                  {failedImages.map((f, i) => <div key={i}>{f}</div>)}
                </div>
              )}

              <div style={{ overflowX:'auto', maxHeight:500, overflowY:'auto', marginBottom:10, border:'1px solid #eee', borderRadius:8 }}>
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

              <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginTop:8 }}>
                <button style={{ ...s.btnGray, fontSize:13 }} onClick={addRow}>+ 행 추가</button>
                <button style={s.btnOrange} onClick={saveExtracted}>
                  💾 저장 (확인용)
                </button>
                <div style={{ flex:1 }} />
                <button style={s.btnGray} onClick={() => { setStep(1); setSaved(false); setImages([]); }}>
                  ↩ 처음부터
                </button>
                <button style={s.btnGreen} onClick={() => xlsRef.current?.click()}>
                  📊 기존 Excel에 반영
                </button>
                <input type="file" ref={xlsRef} accept=".xlsx,.xls" style={{ display:'none' }}
                  onChange={e => { if (e.target.files[0]) handleExcel(e.target.files[0]); }} />
              </div>

              {saved && <div style={s.info}>✅ 저장 완료! 확인 후 "기존 Excel에 반영"으로 병합하세요.</div>}
            </>
          )}
        </div>
      </div>
    </>
  );
}
