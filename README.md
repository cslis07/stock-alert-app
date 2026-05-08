# 📦 재고 이슈 알리미

공급사 카톡 캡처 이미지 → AI 자동 분석 → 카카오채널 공지 초안 생성

---

## 배포 방법 (GitHub + Vercel)

### 1단계. GitHub에 코드 올리기

```bash
# 터미널에서 실행
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/내계정/stock-alert-app.git
git push -u origin main
```

또는 GitHub Desktop으로 업로드해도 됩니다.

### 2단계. Vercel 배포

1. https://vercel.com 접속 → 로그인
2. **"Add New Project"** 클릭
3. GitHub 레포지토리 선택
4. **Environment Variables** 항목에서:
   - Name: `ANTHROPIC_API_KEY`
   - Value: `sk-ant-...` (실제 API 키)
5. **Deploy** 클릭

배포 완료 후 `https://프로젝트명.vercel.app` 주소로 접속 가능!

---

## 로컬 개발

```bash
npm install

# .env.local 파일 만들고 API 키 입력
cp .env.local.example .env.local

npm run dev
# http://localhost:3000 접속
```

---

## 중요: API 키 보안

- `.env.local` 파일은 절대 GitHub에 올리지 마세요
- `.gitignore`에 이미 포함되어 있어 자동으로 제외됩니다
- API 키는 Vercel 환경변수로만 관리하세요
