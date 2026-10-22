# Putting the Navigator on the team server

The Navigator is site 2 on the team server `team27@51.79.243.238`. People open
**https://navigation.duckdns.org** (no login: it's the public site).

```
browser --> nginx :443 (https) --> /var/www/site2/current  (the built website, navigator/dist)
```

`navigation.duckdns.org` is a free DuckDNS name pointing at the server, with a Let's Encrypt
certificate that renews by itself (same setup as the Studio, see `studio-web/deploy/README.md`).
The nginx config is in `site2/deploy/` in the repo root.

The Navigator runs entirely in the browser today: it loads `building.json` and works out routes
itself (`src/api.ts`), so the server only hands out files (no backend). nginx was set up once
from `site2/deploy/` in the repo root.

## Deploy (Windows)

Needs Node.js 22 LTS (https://nodejs.org) and your SSH key on the server. In a Command Prompt:

```
wayforge\navigator\deploy\deploy.bat
```

It builds the site (`npm run build`), uploads `dist/` and makes it live. Run it again for every update.

## Undo a bad upload

Each upload is kept in its own folder (newest 5). On the server:

```
ls -1t /var/www/site2/releases                                     newest first
ln -sfn /var/www/site2/releases/<older folder> /var/www/site2/current
```

The change is live straight away, no restart needed.
