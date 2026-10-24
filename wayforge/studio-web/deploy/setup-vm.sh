#!/usr/bin/env bash
# setup-vm.sh - put the Wayforge Studio (website + backend) on the team server
#
# run it ON THE SERVER, from the folder you uploaded (see deploy/README.md):
#   bash ~/wayforge/studio-web/deploy/setup-vm.sh
#
# what it does:
#   1. installs what's needed (compiler, cmake, node, nginx)
#   2. builds wf_cli for Linux from ~/wayforge/core and puts it in /usr/local/bin
#   3. copies the website (studio-web/dist) to /var/www/studio
#   4. runs the backend (studio-web/server/server.mjs) as a service that starts by itself
#   5. makes the team login the first time (password saved in ~/studio-login.txt, never printed)
#   6. points nginx at the website and /api at the backend, behind that login, on
#      https://wayforgestudio.duckdns.org (443 only, no plain-http copy on 5000 any more)
#      (only GET /api/published stays open, the Navigator reads it)
#   7. gets the free https certificate from Let's Encrypt the first time (renews by itself)
#   8. nightly backup of the buildings + server config into ~/backups (deploy/backup-vm.sh)
#   9. (step 5 in the log) Kervin's API (wayforge/backend) as a service on 127.0.0.1:3000, and
#      https://navigation.duckdns.org/api sent to it, so the Navigator reads what the Studio publishes
#
# safe to run again after uploading a new version, it just updates everything.
# an existing login, certificate and backups are kept.
set -euo pipefail

ROOT="$HOME/wayforge"
WEB="$ROOT/studio-web"
PORT_API=8080       # the backend, only nginx talks to it
LOGIN_FILE=/etc/nginx/studio.htpasswd   # team login for the site (made in step 5)
LOGIN_USER=studio
DOMAIN=wayforgestudio.duckdns.org       # https address (DuckDNS name pointing at this server)
ACME_ROOT=/var/www/letsencrypt          # where certbot puts its domain-check files

echo "== 1/9 packages"
sudo apt-get update -qq
sudo apt-get install -y -qq build-essential cmake ninja-build git ca-certificates nodejs nginx certbot >/dev/null
node -v

echo "== 2/9 building wf_cli (first time takes a few minutes)"
cmake -S "$ROOT/core" -B "$ROOT/build/linux-release" -G Ninja -DCMAKE_BUILD_TYPE=Release \
      -DWF_BUILD_TESTS=OFF -DWF_BUILD_VIEWER=OFF >/dev/null
cmake --build "$ROOT/build/linux-release" --target wf_cli
sudo install -m 755 "$ROOT/build/linux-release/Sandbox/wf_cli/wf_cli" /usr/local/bin/wf_cli
wf_cli --version

echo "== 3/9 website"
sudo mkdir -p /var/www/studio
sudo rm -rf /var/www/studio/*
sudo cp -r "$WEB/dist/." /var/www/studio/
sudo chmod -R a+rX /var/www/studio

echo "== 4/9 backend service"
mkdir -p "$WEB/server/data"
sudo tee /etc/systemd/system/wayforge-studio.service >/dev/null <<UNIT
[Unit]
Description=Wayforge Studio backend (runs wf_cli)
After=network.target

[Service]
User=$USER
WorkingDirectory=$WEB/server
Environment=PORT=$PORT_API
Environment=HOST=127.0.0.1
Environment=WF_CLI=/usr/local/bin/wf_cli
Environment=WF_DATA=$WEB/server/data
ExecStart=/usr/bin/node $WEB/server/server.mjs
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now wayforge-studio >/dev/null
sudo systemctl restart wayforge-studio

echo "== 5/9 API for the Navigator (wayforge/backend, Kervin's)"
# it reads published buildings from the Studio backend (127.0.0.1:$PORT_API) and runs wf_cli for
# routes. only nginx talks to it. tsx runs the TypeScript straight away, no build step.
API="$ROOT/backend"
PORT_NAV_API=3000
if [ -f "$API/package.json" ]; then
  ( cd "$API" && npm ci --no-audit --no-fund --loglevel=error )
  sudo tee /etc/systemd/system/wayforge-api.service >/dev/null <<UNIT
[Unit]
Description=Wayforge API for the Navigator (reads published buildings, routes with wf_cli)
After=network.target wayforge-studio.service

[Service]
User=$USER
WorkingDirectory=$API
Environment=PORT=$PORT_NAV_API
Environment=HOST=127.0.0.1
Environment=WF_CLI=/usr/local/bin/wf_cli
Environment=STUDIO_API_URL=http://127.0.0.1:$PORT_API
ExecStart=$API/node_modules/.bin/tsx src/server.ts
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
UNIT
  sudo systemctl daemon-reload
  sudo systemctl enable --now wayforge-api >/dev/null
  sudo systemctl restart wayforge-api

  # the Navigator site (Joel's nginx-site2 config) gets /api from this service. same site, so no
  # CORS and no http calls from an https page. read-only: GET only
  sudo tee /etc/nginx/snippets/site2-api.conf >/dev/null <<CONF
location /api/ {
    limit_except GET { deny all; }
    proxy_pass http://127.0.0.1:$PORT_NAV_API;
    proxy_read_timeout 60s;
}
CONF
  if [ -f /etc/nginx/snippets/site2-site.conf ] && ! grep -q 'site2-api.conf' /etc/nginx/snippets/site2-site.conf; then
    echo 'include snippets/site2-api.conf;   # /api -> wayforge-api (added by studio-web/deploy/setup-vm.sh)' | sudo tee -a /etc/nginx/snippets/site2-site.conf >/dev/null
  fi
  sudo nginx -t && sudo systemctl reload nginx
else
  echo "no backend/ uploaded, skipping (deploy.bat packs it)"
fi

echo "== 6/9 team login"
# first time only: make a random password, store its hash for nginx and the password itself in
# ~/studio-login.txt (only team27 can read it). Change it later with:
#   sudo htpasswd /etc/nginx/studio.htpasswd studio      (needs: sudo apt install apache2-utils)
if ! sudo test -s "$LOGIN_FILE"; then
  PASS=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)
  printf '%s:%s\n' "$LOGIN_USER" "$(printf '%s' "$PASS" | openssl passwd -6 -stdin)" | sudo tee "$LOGIN_FILE" >/dev/null
  ( umask 077; printf 'Studio login for https://%s\nuser: %s\npassword: %s\n' "$DOMAIN" "$LOGIN_USER" "$PASS" > "$HOME/studio-login.txt" )
  unset PASS
  echo "made a new login, see ~/studio-login.txt"
else
  echo "keeping the existing login"
fi
sudo chown root:www-data "$LOGIN_FILE"
sudo chmod 640 "$LOGIN_FILE"

echo "== 7/9 nginx"
# the site itself (login, website, /api) is kept in a snippet, included by the https server.
sudo tee /etc/nginx/snippets/studio-site.conf >/dev/null <<CONF
root /var/www/studio;
index index.html;

# everything needs the team login, except the read-only list the Navigator uses (below)
auth_basic "Wayforge Studio";
auth_basic_user_file $LOGIN_FILE;

location /assets/ { try_files \$uri =404; }
location /viewer/ { try_files \$uri \$uri/ =404; }    # \$uri/ so /viewer/ opens viewer/index.html
location / { try_files \$uri \$uri/ /index.html; }

location /api/ {
    proxy_pass http://127.0.0.1:$PORT_API;
    client_max_body_size 60M;      # 9 big blueprint scans add up
    proxy_read_timeout 300s;       # wf_cli build can take a while on many floors
}

# the Navigator reads published buildings without logging in; read-only (GET) only
location /api/published {
    auth_basic off;
    limit_except GET { deny all; }
    proxy_pass http://127.0.0.1:$PORT_API;
}
CONF

# writes the studio config:
#   :80    Let's Encrypt's certificate checks, and sends everyone else to https
#   :443   https, only once the certificate exists (before that nginx would refuse the config)
# (the old plain-http copy on :5000 was removed, so the login never travels unencrypted and
#  fewer ports are open)
write_nginx() {
  local https="" redirect="return 404;"
  if sudo test -s "/etc/letsencrypt/live/$DOMAIN/fullchain.pem"; then
    redirect="return 301 https://\$host\$request_uri;"
    https="
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $DOMAIN;
    ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:studio_ssl:10m;
    include snippets/studio-site.conf;
}"
  fi
  sudo tee /etc/nginx/sites-available/studio >/dev/null <<CONF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ { root $ACME_ROOT; }
    location / { $redirect }
}
$https
CONF
  sudo ln -sf /etc/nginx/sites-available/studio /etc/nginx/sites-enabled/studio
  sudo nginx -t
  sudo systemctl reload nginx
}
sudo mkdir -p "$ACME_ROOT"
write_nginx

echo "== 8/9 https certificate for $DOMAIN"
# first time only: get a free certificate from Let's Encrypt (it checks we own the domain by
# fetching a file from $ACME_ROOT over port 80). certbot's own timer renews it automatically;
# the hook below reloads nginx after each renewal so the new certificate is used.
if ! sudo test -s "/etc/letsencrypt/live/$DOMAIN/fullchain.pem"; then
  sudo certbot certonly --webroot -w "$ACME_ROOT" -d "$DOMAIN" \
       --non-interactive --agree-tos --register-unsafely-without-email
  write_nginx
else
  echo "keeping the existing certificate"
fi
sudo install -d /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\nsystemctl reload nginx\n' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh >/dev/null
sudo chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

echo "== 9/9 nightly backup"
# runs deploy/backup-vm.sh every night at 19:00 server time (UTC) = 03:00 Singapore time.
# grep -v drops the old line first, so running setup again doesn't add a second one.
# (|| true: with no crontab yet, crontab -l and grep both "fail", which is fine here)
chmod +x "$WEB/deploy/backup-vm.sh"
mkdir -p "$HOME/backups"
( crontab -l 2>/dev/null | grep -v 'backup-vm.sh' || true ; echo "0 19 * * * $WEB/deploy/backup-vm.sh >> $HOME/backups/backup.log 2>&1" ) | crontab -
"$WEB/deploy/backup-vm.sh"

echo
echo "== check"
# give the backend a few seconds to start (asks the backend directly, so no login needed)
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf "http://127.0.0.1:$PORT_API/api/health" >/dev/null; then break; fi
  sleep 1
done
if curl -sf "http://127.0.0.1:$PORT_API/api/health"; then
  echo
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if curl -sf "http://127.0.0.1:3000/api/health" >/dev/null; then break; fi
    sleep 1
  done
  if curl -sf "http://127.0.0.1:3000/api/published" >/dev/null; then
    echo "Navigator API ok: $(curl -s http://127.0.0.1:3000/api/published | head -c 200)"
  else
    echo "The Navigator API didn't start. Its last log lines:"
    sudo journalctl -u wayforge-api -n 25 --no-pager || true
  fi
  echo "Done. Open https://$DOMAIN"
else
  echo "The backend didn't start. Its last log lines:"
  sudo journalctl -u wayforge-studio -n 25 --no-pager
  exit 1
fi
