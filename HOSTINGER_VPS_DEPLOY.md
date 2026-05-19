# Deploy tren VPS Hostinger

Huong dan nay dung cho VPS Ubuntu/Debian tren Hostinger. Muc tieu la chay app Node sau Nginx va bat HTTPS de trinh duyet dien thoai cho phep dung micro.

## 1. Chuan bi domain

Trong DNS cua domain, tao record:

```text
Type: A
Name: dich
Value: IP_VPS_HOSTINGER
```

Vi du sau khi tro DNS xong, app se chay tai:

```text
https://dich.tenmiencuaban.com
```

## 2. Cai Node, Nginx, PM2

SSH vao VPS:

```bash
ssh root@IP_VPS_HOSTINGER
```

Cai goi can thiet:

```bash
apt update
apt install -y nginx git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
npm install -g pm2
```

Kiem tra:

```bash
node -v
npm -v
pm2 -v
```

## 3. Dua source code len VPS

Tao thu muc app:

```bash
mkdir -p /var/www/realtime-translator
```

Copy cac file trong project nay len:

```bash
scp -r ./* root@IP_VPS_HOSTINGER:/var/www/realtime-translator/
scp .env.example root@IP_VPS_HOSTINGER:/var/www/realtime-translator/.env.example
```

Neu dung GitHub thi co the clone repo vao `/var/www/realtime-translator` thay cho `scp`.

## 4. Tao file moi truong

Tren VPS:

```bash
cd /var/www/realtime-translator
nano .env
```

Nhap:

```text
OPENAI_API_KEY=sk-proj-...
PORT=3001
```

Khong dua file `.env` len GitHub.

## 5. Chay app bang PM2

```bash
cd /var/www/realtime-translator
set -a
. ./.env
set +a
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Sau lenh `pm2 startup`, PM2 se in ra mot lenh `sudo env ...`. Copy va chay dung lenh do.

Kiem tra app:

```bash
curl http://127.0.0.1:3001/health
```

Ket qua dung:

```json
{"ok":true}
```

## 6. Cau hinh Nginx reverse proxy

Tao file:

```bash
nano /etc/nginx/sites-available/realtime-translator
```

Noi dung, thay `dich.tenmiencuaban.com` bang domain that:

```nginx
server {
    listen 80;
    server_name dich.tenmiencuaban.com;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Bat site:

```bash
ln -s /etc/nginx/sites-available/realtime-translator /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

Luc nay co the thu:

```text
http://dich.tenmiencuaban.com
```

Nhung de dung micro tren dien thoai, can lam tiep buoc HTTPS.

## 7. Bat HTTPS bang Let's Encrypt

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d dich.tenmiencuaban.com
```

Chon redirect HTTP sang HTTPS khi duoc hoi.

Kiem tra tu dong gia han:

```bash
certbot renew --dry-run
```

## 8. Mo firewall neu can

Neu VPS bat UFW:

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
ufw status
```

Tren Hostinger panel, dam bao firewall/security group mo cong:

```text
80/tcp
443/tcp
22/tcp
```

## 9. Cap nhat app sau nay

Neu copy code moi len VPS:

```bash
cd /var/www/realtime-translator
pm2 restart realtime-translator --update-env
```

Xem log:

```bash
pm2 logs realtime-translator
```

## 10. Su dung tren dien thoai

Mo Chrome/Safari tren dien thoai:

```text
https://dich.tenmiencuaban.com
```

Bam **Bat dau**, cho phep micro, roi noi vao dien thoai.

Neu micro van khong hien hop thoai xin quyen, hay kiem tra:

- URL phai la `https://`, khong phai `http://`.
- Trinh duyet khong chan micro trong site settings.
- VPS co `OPENAI_API_KEY` dung.
- PM2 app dang chay: `pm2 status`.
