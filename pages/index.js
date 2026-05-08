import { useState, useRef, useEffect } from 'react';
import Head from 'next/head';

let XLSX = null;

// ★ 모듈 레벨 변수 - 절대 stale 안됨
let _items = [];
let _supplier = '';

const STATUS_LIST = [
  '판매중','품절','입고예정','일부규격품절',
  '생산&공급중단','미정','입고완료','정산','신규금지','기타정책'
];

const COL = { manufacturer:0, product:1, spec:2, status:3, date:4, note:5 };

function normalize(str) {
  return (str || '').toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/\d+(\.\d+)?(mg|ml|g|mcg|iu)/gi, '')
    .replace(/\d+/g, '')
    .replace(/[^\w가-힣]/g, '')
    .trim();
}

function similarity(a, b) {
  const na = normalize(a), nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  let m = 0;
  for (let i = 0; i < Math.min(na.length, nb.length); i++) {
    if (na[i] === nb[i]) m++;
  }
  return m / Math.max(na.length, nb.length);
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

  useEffect(() => { import('xlsx').then(mod => { XLSX = mod; }); }, []);

  // ★ 상태 + 모듈변수 동시 업데이트
  function setItemsFull(newItems) {
    _items = newItems;
    setItems(newItems);
  }
  function setSupplierFull(val) {
    _supplier = val;
    setSupplier(val);
  }

  function updateItem(id, field, value) {
    const next = _items.map(it => it.id === id ? { ...it, [field]: value } : it);
    setItemsFull(next);
  }
  function addRow() {
    setItemsFull([..._items, {
      id: Date.now(), manufacturer: _supplier,
      product_name: '', spec: '', status: '미정', date: '', note: ''
    }]);
  }
  function deleteRow(id) {
    setItemsFull(_items.filter(it => it.id !== id));
  }

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
      setSupplierFull(data.supplier || '');
      setNoticeDate(data.notice_date || '');
      setItemsFull((data.items || []).map((it, i) => ({
        id: i,
        manufacturer: it.manufacturer || data.supplier || '',
        product_name: it.product_name || '',
        spec: it.spec || '',
        status: it.status || '미정',
        date: it.exact_date || '',
        note: [it.vague_date, it.note].filter(Boolean).join(' / '),
      })));
      setStep(2);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  function handleExcel(file) {
    if (!file || !XLSX) return;

    // ★ 모듈 레벨 변수에서 읽기 - 절대 stale 없음
    // ★ 화면의 input 값을 직접 읽음 - 수정 내용 100% 반영
    const tableRows = document.querySelectorAll('table tbody tr');
    const currentItems = Array.from(tableRows).map(tr => {
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
    console.log('적용할 데이터:', currentItems.map(i => i.product_name));

    const reader = new FileReader();
    reader.onload = e => {
      const wb = XLSX.read(e.target.result, { type: 'array', cellDates: false });
      const wsName = wb.SheetNames[0];
      const ws = wb.Sheets[wsName];
      const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });

      // ★ 빈 행 제거 (phantom rows 방지)
      const lastDataIdx = allRows.reduce((last, row, i) =>
        row.some(c => c !== '' && c !== null && c !== undefined) ? i : last, 0);
      const rows = allRows.slice(0, lastDataIdx + 1);

      // 헤더 행 찾기
      const headerIdx = rows.findIndex(r =>
        Array.isArray(r) && r.some(c => String(c).trim() === '제품명')
      );
      if (headerIdx < 0) { alert('제품명 헤더를 찾을 수 없어요.'); return; }

      const dataRows = rows.slice(headerIdx + 1);
      let updateCount = 0, addCount = 0;

      currentItems.forEach(item => {
        if (!item.product_name.trim()) return;

        let bestIdx = -1, bestScore = 0;
        dataRows.forEach((r, idx) => {
          const score = similarity(String(r[COL.product] || ''), item.product_name);
          if (score > bestScore) { bestScore = score; bestIdx = idx; }
        });

        if (bestScore >= 0.75 && bestIdx >= 0) {
          // ★ 기존 행 업데이트 (수정된 값 적용)
          const ri = headerIdx + 1 + bestIdx;
          rows[ri][COL.manufacturer] = item.manufacturer;
          rows[ri][COL.spec]         = item.spec;
          rows[ri][COL.status]       = item.status;
          rows[ri][COL.date]         = item.date;
          rows[ri][COL.note]         = item.note;
          updateCount++;
        } else {
          // ★ 신규 행 추가
          const newRow = new Array(8).fill('');
          newRow[COL.manufacturer] = item.manufacturer;
          newRow[COL.product]      = item.product_name;
          newRow[COL.spec]         = item.spec;
          newRow[COL.status]       = item.status;
          newRow[COL.date]         = item.date;
          newRow[COL.note]         = item.note;
          rows.push(newRow);
          addCount++;
        }
      });

      // ★ 새 시트 생성
      const newWs = XLSX.utils.aoa_to_sheet(rows);

      // ★ 날짜 컬럼 전체 문자열 강제
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
      alert(`✅ 완료!\n업데이트: ${updateCount}건 / 신규추가: ${addCount}건`);
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
    inp:      { border:'1px solid #e5e7eb', borderRadius:6, padding:'5px 7px', fontSize:13, width:'100%', background:'#fff', color:'#111', boxSizing:'border-box' },
    sel:      { border:'1px solid #e5e7eb', borderRadius:6, padding:'5px 4px', fontSize:12, background:'#fff', color:'#111', width:'100%' },
    th:       { padding:'8px 6px', fontSize:12, fontWeight:600, background:'#f8f9fa', color:'#555', textAlign:'left', whiteSpace:'nowrap', borderBottom:'2px solid #e5e7eb' },
    td:       { padding:'4px', verticalAlign:'middle', borderBottom:'1px solid #f3f3f3' },
    err:      { background:'#FCEBEB', color:'#A32D2D', borderRadius:8, padding:'10px 14px', fontSize:13, marginTop:10 },
  };

  return (
    <>
      <Head><title>재고 이슈 알리미</title></Head>
      <div style={s.wrap}>
        <div style={s.card}>
          <h1 style={{ fontSize:20, fontWeight:700, margin:'0 0 4px' }}>📦 재고 이슈 알리미</h1>
          <p style={{ fontSize:13, color:'#888', margin:'0 0 16px' }}>이미지 분석 → 수기 수정 → Excel 자동 업데이트</p>

          <div style={s.steps}>
            {['① 이미지 분석','② 내용 확인·수정','③ Excel 다운로드'].map((label,i) => (
              <div key={i} style={s.dot(step===i+1, step>i+1)}>{label}</div>
            ))}
          </div>

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

          {step === 2 && (
            <>
              <div style={{ display:'flex', gap:10, marginBottom:14, flexWrap:'wrap', alignItems:'flex-end' }}>
                <div style={{ flex:1, minWidth:150 }}>
                  <div style={{ fontSize:12, color:'#888', marginBottom:3 }}>공급사</div>
                  <input style={s.inp} value={supplier}
                    onChange={e => setSupplierFull(e.target.value)} />
                </div>
                <div style={{ flex:1, minWidth:130 }}>
                  <div style={{ fontSize:12, color:'#888', marginBottom:3 }}>안내 날짜</div>
                  <input style={s.inp} value={noticeDate}
                    onChange={e => setNoticeDate(e.target.value)} />
                </div>
                <div style={{ fontSize:13, color:'#888', paddingBottom:6 }}>총 {items.length}건</div>
              </div>

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
                        <td style={{ ...s.td, width:80 }}>
                          <input style={s.inp} value={item.manufacturer}
                            onChange={e => updateItem(item.id,'manufacturer',e.target.value)} />
                        </td>
                        <td style={{ ...s.td, width:165 }}>
                          <input style={{ ...s.inp, fontWeight:500 }} value={item.product_name}
                            onChange={e => updateItem(item.id,'product_name',e.target.value)} />
                        </td>
                        <td style={{ ...s.td, width:90 }}>
                          <input style={s.inp} value={item.spec}
                            onChange={e => updateItem(item.id,'spec',e.target.value)} />
                        </td>
                        <td style={{ ...s.td, width:118 }}>
                          <select style={s.sel} value={item.status}
                            onChange={e => updateItem(item.id,'status',e.target.value)}>
                            {STATUS_LIST.map(st => <option key={st} value={st}>{st}</option>)}
                          </select>
                        </td>
                        <td style={{ ...s.td, width:80 }}>
                          <input style={s.inp} value={item.date} placeholder="5월 6일"
                            onChange={e => updateItem(item.id,'date',e.target.value)} />
                        </td>
                        <td style={s.td}>
                          <input style={s.inp} value={item.note}
                            onChange={e => updateItem(item.id,'note',e.target.value)} />
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

              <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                <button style={{ ...s.btnGray, fontSize:13 }} onClick={addRow}>+ 행 추가</button>
                <div style={{ flex:1 }} />
                <button style={s.btnGray} onClick={() => setStep(1)}>↩ 다시 분석</button>
                <button style={s.btnGreen} onClick={() => xlsRef.current?.click()}>
                  완료 → Excel 업로드 ⬆
                </button>
                <input type="file" ref={xlsRef} accept=".xlsx,.xls" style={{ display:'none' }}
                  onChange={e => { if (e.target.files[0]) handleExcel(e.target.files[0]); }} />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
