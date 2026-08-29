server {
    if ($host = glassmkr.com) {
        return 301 https://$host$request_uri;
    }
    if ($host = www.glassmkr.com) {
        return 301 https://$host$request_uri;
    }
    listen 80;
    server_name glassmkr.com www.glassmkr.com;
    return 301 https://$host$request_uri;




}

server {
    listen 443 ssl;
    server_name glassmkr.com www.glassmkr.com;
    ssl_certificate /etc/letsencrypt/live/www.glassmkr.com/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/www.glassmkr.com/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Discovery relations for the Markdown twins.
    #
    # The twins are pre-generated files under static/, so adapter-node's sirv
    # handler serves them before the SvelteKit router runs and the app's own
    # Link header never applies. That is fine for the file itself, but a client
    # that followed rel="alternate" from an HTML page and landed on the .md had
    # no way back to the LLM index or the API contract: Markdown has no head to
    # carry a relation. Setting it here is the only layer that sees every twin.
    #
    # `always` so it is sent on 304 as well, which is what a client revalidating
    # a cached twin receives.
    location ~ \.md$ {
        add_header Link '<https://glassmkr.com/llms.txt>; rel="describedby"; type="text/plain", <https://app.glassmkr.com/api/openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"' always;
        proxy_pass http://127.0.0.1:4001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:4001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }


}
