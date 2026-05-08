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
    const currentItems = [..._items];
    console.log('적용할 데이터:', currentItems.map(i => i.product_name));

    const reader = new FileReader();
    reader.onload = e => {
      const wb = XLSX.read(e.target.result, { type: 'array', cellDates: false });
      const wsName = wb.SheetNames[0];
      const ws = wb.Sheets[wsName];
      const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });

      // ★ 빈 행 제거 (phantom rows
