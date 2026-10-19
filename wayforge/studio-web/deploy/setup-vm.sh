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
#   5. points nginx port 5000 at the website and /api at the backend
#
# safe to run again after uploading a new version, it just updates everything.
set -euo pipefail

ROOT="$HOME/wayforge"
WEB="$ROOT/studio-web"
PORT_SITE=5000      # what people open (5000-5050 are open on the team server)
PORT_API=8080       # the backend, only nginx talks to it

echo "== 1/5 packages"
sudo apt-get update -qq
sudo apt-get install -y -qq build-essential cmake ninja-build git ca-certificates nodejs nginx >/dev/null
node -v

echo "== 2/5 building wf_cli (first time takes a few minutes)"
cmake -S "$ROOT/core" -B "$ROOT/build/linux-release" -G Ninja -DCMAKE_BUILD_TYPE=Release \
      -DWF_BUILD_TESTS=OFF -DWF_BUILD_VIEWER=OFF >/dev/null
cmake --build "$ROOT/build/linux-release" --target wf_cli
sudo install -m 755 "$ROOT/build/linux-release/Sandbox/wf_cli/wf_cli" /usr/local/bin/wf_cli
wf_cli --version

echo "== 3/5 website"
sudo mkdir -p /var/www/studio
sudo rm -rf /var/www/studio/*
sudo cp -r "$WEB/dist/." /var/www/studio/
sudo chmod -R a+rX /var/www/studio

echo "== 4/5 backend service"
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

echo "== 5/5 nginx"
sudo tee /etc/nginx/sites-available/studio >/dev/null <<CONF
server {
    listen $PORT_SITE;
    root /var/www/studio;
    index index.html;

    location /assets/ { try_files \$uri =404; }
    location /viewer/ { try_files \$uri =404; }
    location / { try_files \$uri \$uri/ /index.html; }

    location /api/ {
        proxy_pass http://127.0.0.1:$PORT_API;
        client_max_body_size 60M;      # 9 big blueprint scans add up
        proxy_read_timeout 300s;       # wf_cli build can take a while on many floors
    }
}
CONF
sudo ln -sf /etc/nginx/sites-available/studio /etc/nginx/sites-enabled/studio
sudo nginx -t
sudo systemctl reload nginx

sleep 1
echo
echo "== check"
curl -s "http://127.0.0.1:$PORT_SITE/api/health" && echo
IP=$(hostname -I | awk '{print $1}')
echo "Done. Open http://$IP:$PORT_SITE"
