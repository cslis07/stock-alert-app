import { useState, useRef, useEffect } from 'react';
import Head from 'next/head';

let XLSX = null;

const STATUS_LIST = ['판매중','품절','입고예정','일부규격품절','생산&공급중단','미정','입고완료','정산','신규금지','기타정책'];

function normalize(str) {
  return (str || '').toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/\d+(\.\d+)?(mg|ml|g|mcg|iu)/gi, '')
    .replace(/\d+/g, '').replace(/[^\w가-힣]/g, '').trim();
}

function similarity(a, b) {
  const na = normalize(a), nb = normalize(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  let m = 0;
  for (let i = 0; i < Math.min(na.length, nb.length); i++) if (na[i] === nb[i]) m++;
  return m / Math.max(na.length, nb.length);
}

export default function Home() {
  const [step, setStep] = useState(1);
  const [imgPreview, setImgPreview] = useState(null);
  const [imgBase64, setImgBase64] = useState('');
  const [imgMime, setImgMime] = useState('image/jpeg');
  const [loading, setLoading] = useState(false);
  const [supplier, setSupplier] = useState('');
  const [noticeDate, setNoticeDate] = useState('');
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const imgRef = useRef();
  const xlsRef = useRef();

  useEffect(() => { import('xlsx').then(mod => { XLSX = mod; }); }, []);

  function handleImg(file) {
    if (!file) return;
    setImgMime(file.type || 'image/jpeg');
    const reader = new FileReader();
    reader.onload = e => { setImgPreview(e.target.result); setImgBase64(e.target.result.split(',')[1]); };
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
      setItems((data.items || []).map((it,
