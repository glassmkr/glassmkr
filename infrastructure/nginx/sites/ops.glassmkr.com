server {
    listen 80;
    server_name ops.glassmkr.com;

    location / {
        proxy_pass http://127.0.0.1:4004;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Cf-Access-Jwt-Assertion $http_cf_access_jwt_assertion;
    }
}

server {
    listen 443 ssl;
    server_name ops.glassmkr.com;

    ssl_certificate /etc/letsencrypt/live/www.glassmkr.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/www.glassmkr.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    location / {
        proxy_pass http://127.0.0.1:4004;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Cf-Access-Jwt-Assertion $http_cf_access_jwt_assertion;
    }
}
