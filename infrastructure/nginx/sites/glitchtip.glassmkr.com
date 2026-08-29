server {
    listen 80;
    listen [::]:80;
    server_name glitchtip.glassmkr.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name glitchtip.glassmkr.com;

    ssl_certificate     /etc/letsencrypt/live/glitchtip.glassmkr.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/glitchtip.glassmkr.com/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    client_max_body_size 25M;

    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    access_log /var/log/nginx/glitchtip.access.log;
    error_log  /var/log/nginx/glitchtip.error.log;

    location / {
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_read_timeout 90s;
        proxy_send_timeout 90s;
        proxy_buffering off;
    }
}
