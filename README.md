# OpenAI Realtime Translator

Webapp demo dich giong noi realtime bang OpenAI Realtime Translation API va WebRTC.

## Chay app

```powershell
$env:OPENAI_API_KEY="sk-proj-..."
$env:PORT="3001"
node server.js
```

Mo `http://localhost:3001`, chon ngon ngu dich, bam **Bat dau**, roi cho phep trinh duyet dung micro.

## Cach hoat dong

- Backend `server.js` giu `OPENAI_API_KEY` va tao client secret tam thoi qua `/v1/realtime/translations/client_secrets`.
- Frontend `public/app.js` dung client secret de tao WebRTC call toi `/v1/realtime/translations/calls`.
- Am thanh micro duoc gui truc tiep den model `gpt-realtime-translate`; ban dich duoc phat bang audio va hien thi transcript.
- Realtime Translation khong dung `response.create`; dich bat dau tu luong audio vao.

## Luu y

- Khong dua `OPENAI_API_KEY` vao frontend.
- Trinh duyet can quyen micro va nen chay tren HTTPS neu dung dien thoai.
- Neu dung VPS Hostinger, xem `HOSTINGER_VPS_DEPLOY.md`.
