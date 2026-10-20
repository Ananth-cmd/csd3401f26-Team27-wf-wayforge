# Putting the Studio on the team server

The server is `team27@51.79.243.238` (Ubuntu 24.04). People open **http://51.79.243.238:5000**.

```
browser --> nginx :5000 --> /var/www/studio (the website, studio-web/dist)
                       \--> /api --> node server.mjs :8080 (only reachable from the server itself)
                                          \--> /usr/local/bin/wf_cli (built on the server from wayforge/core)
```

## One step (Windows)

Build the 3D viewer in Unity first if you want 3D (Wayforge > Build WebGL Viewer). Then in a
Command Prompt:

```
C:\Users\katie\Documents\SIT\wf-wayforge\wayforge\studio-web\deploy\deploy.bat
```

It builds the site, uploads it and runs `setup-vm.sh` on the server. Type the server password
when it asks (twice). The first time takes a few minutes because it installs things and builds
`wf_cli`; after that it's quick. Run it again whenever you want to update the server.

## What setup-vm.sh does on the server

1. installs build-essential, cmake, ninja, nodejs, nginx
2. builds `wf_cli` from `~/wayforge/core` -> `/usr/local/bin/wf_cli`
3. copies the website to `/var/www/studio`
4. runs the backend as a service called `wayforge-studio` (starts by itself, restarts if it crashes)
5. sets nginx port 5000: website + `/api` to the backend

## Handy commands on the server

```
sudo systemctl status wayforge-studio        is the backend running?
sudo journalctl -u wayforge-studio -n 50     its last 50 log lines
sudo systemctl restart wayforge-studio       restart it
curl http://127.0.0.1:5000/api/health        should say {"ok":true,...}
ls ~/wayforge/studio-web/server/data         the buildings people made
```

Buildings are saved in `~/wayforge/studio-web/server/data` on the server. There are no backups,
so download anything important (Download .wfb in the editor).
