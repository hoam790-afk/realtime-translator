# OpenAI Realtime Translator

Webapp demo dịch giọng nói realtime bằng OpenAI Realtime API và WebRTC.

## Chạy app

```powershell
$env:OPENAI_API_KEY="sk-proj-..."
node server.js
```

Mở `http://localhost:3000`, chọn ngôn ngữ nguồn/đích, bấm **Bắt đầu**, rồi cho phép trình duyệt dùng micro.

## Cách hoạt động

- Backend `server.js` giữ `OPENAI_API_KEY` và tạo client secret tạm thời qua `/v1/realtime/client_secrets`.
- Frontend `public/app.js` dùng client secret để tạo WebRTC call tới `/v1/realtime/calls`.
- Âm thanh micro được gửi trực tiếp đến model `gpt-realtime`; bản dịch được phát bằng audio và hiển thị transcript.

## Lưu ý

- Không đưa `OPENAI_API_KEY` vào frontend.
- Trình duyệt cần quyền micro.
- Nếu chỉ muốn phụ đề, chọn chế độ **Chỉ phụ đề** trước khi bắt đầu.
- Muốn dùng trên điện thoại, deploy lên HTTPS. Xem `HOSTINGER_VPS_DEPLOY.md` nếu dùng VPS Hostinger.
