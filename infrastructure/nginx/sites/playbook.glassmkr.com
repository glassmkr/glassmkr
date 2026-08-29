# Port 80: redirect everything to HTTPS so CF strict mode connects
# origin via TLS deterministically (pre-this-change there was no
# explicit 443 server, so CF→origin TLS fell through to the default
# 443 server's cert — fragile under nginx default-server-selection).
server {
    listen 80;
    listen [::]:80;
    server_name playbook.glassmkr.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name playbook.glassmkr.com;

    ssl_certificate /etc/letsencrypt/live/www.glassmkr.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/www.glassmkr.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    root /var/www/playbook.glassmkr.com;
    index index.html;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Enable gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;

    location / {
        try_files $uri $uri/ =404;
    }

    # LLM-friendly files
    location ~* ^(llms\.txt|robots\.txt|sitemap\.xml)$ {
        add_header Content-Type text/plain;
        access_log off;
    }
}
