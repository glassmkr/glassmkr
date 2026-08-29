server {
    if ($host = api.glassmkr.com) {
        return 301 https://$host$request_uri;
    } # managed by Certbot


    listen 80;
    server_name api.glassmkr.com;
    return 301 https://$host$request_uri;


}

server {
    listen 443 ssl;
    server_name api.glassmkr.com;
    ssl_certificate /etc/letsencrypt/live/www.glassmkr.com/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/www.glassmkr.com/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Placeholder redirect to the docs surface. api.<domain> is the
    # standard developer-portal subdomain pattern; this 302 holds the
    # name until File 04 / File 05 of the synthesis-docs roadmap
    # produces a real dev portal. At that point this returns to a
    # proxy_pass to whatever serves the portal.
    #
    # $request_uri appends so https://api.glassmkr.com/v1/foo
    # redirects to https://app.glassmkr.com/docs/v1/foo.
    #
    # Pre-this-change the location block proxied to 127.0.0.1:3000
    # which had no listener, producing a 502 on every request.
    return 302 https://app.glassmkr.com/docs$request_uri;
}
