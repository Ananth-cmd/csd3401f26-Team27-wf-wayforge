# Putting the Studio on the team server

The server is `team27@51.79.243.238` (Ubuntu 24.04). People open
**https://wayforgestudio.duckdns.org** and log in with the team login (see "Team login" below).
The old address http://51.79.243.238:5000 still works, but without https.

```
browser --> nginx :443 (https) --> /var/www/studio (the website, studio-web/dist)
              (or :5000 http)  \--> /api --> node server.mjs :8080 (only reachable from the server itself)
                                                 \--> /usr/local/bin/wf_cli (built on the server from wayforge/core)
```

## HTTPS

`wayforgestudio.duckdns.org` is a free DuckDNS name pointing at the server (whoever owns the DuckDNS
account can change it; keep its token private). The certificate is from Let's Encrypt: `setup-vm.sh`
gets it the first time, then certbot renews it by itself every ~60 days and reloads nginx.
Port 80 only answers Let's Encrypt's checks and sends everyone else to https.

```
sudo certbot certificates             when does the certificate expire?
sudo certbot renew --dry-run          test that renewing works
```

## One step (Windows)

Build the 3D viewer in Unity first if you want 3D (Wayforge > Build WebGL Viewer). Then in a
Command Prompt:

```
C:\Users\katie\Documents\SIT\wf-wayforge\wayforge\studio-web\deploy\deploy.bat
```

It builds the site, uploads it and runs `setup-vm.sh` on the server. The server only accepts SSH
keys (no password), so your PC's key has to be on the server first - ask someone who can already
log in to add your `id_ed25519.pub` line. The first time takes a few minutes because it installs
things and builds `wf_cli`; after that it's quick. Run it again whenever you want to update the server.

## What setup-vm.sh does on the server

1. installs build-essential, cmake, ninja, nodejs, nginx
2. builds `wf_cli` from `~/wayforge/core` -> `/usr/local/bin/wf_cli`
3. copies the website to `/var/www/studio`
4. runs the backend as a service called `wayforge-studio` (starts by itself, restarts if it crashes)
5. makes the team login, the first time only
6. sets nginx port 5000: website + `/api` to the backend, all behind the team login
   (except `GET /api/published`, which the Navigator reads without logging in)
7. sets up the nightly backup (`backup-vm.sh`)

## Team login

The whole site asks for a username and password (anyone could otherwise edit or delete buildings).
The first run of `setup-vm.sh` makes a random password and saves it on the server; to see it:

```
ssh team27@51.79.243.238 cat studio-login.txt
```

Share it with the team privately (not in the repo, not in a public chat). To change it, on the server:

```
sudo apt install apache2-utils                    (once)
sudo htpasswd /etc/nginx/studio.htpasswd studio   type the new password twice
```

and update `~/studio-login.txt` (or delete that file once everyone has the password). No reload is
needed. Log in on the https address: on the old http://51.79.243.238:5000 the password travels
unencrypted.

## Backups

Every night at 03:00 Singapore time the server saves the buildings, site 2's data and the
nginx/service configs to `~/backups/vm-backup-<date>.tgz` and keeps the newest 14. Those are still
on the server, so copy them to your PC regularly:

```
wayforge\studio-web\deploy\pull-backups.bat       -> %USERPROFILE%\wayforge-backups
```

Make one right now: `ssh team27@51.79.243.238 wayforge/studio-web/deploy/backup-vm.sh`.
To look inside one: `tar -tzf vm-backup-<date>.tgz`.

## Handy commands on the server

```
sudo systemctl status wayforge-studio        is the backend running?
sudo journalctl -u wayforge-studio -n 50     its last 50 log lines
sudo systemctl restart wayforge-studio       restart it
curl http://127.0.0.1:8080/api/health        should say {"ok":true,...} (straight to the backend, no login)
ls ~/wayforge/studio-web/server/data         the buildings people made
ls ~/backups                                 the nightly backups
```

Buildings are saved in `~/wayforge/studio-web/server/data` on the server (backed up nightly, see
"Backups").
