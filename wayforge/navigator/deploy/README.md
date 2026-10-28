# Putting the Navigator on the team server

The Navigator is site 2 on the team server `team27@51.79.243.238`. People open
**https://navigation.duckdns.org** (no login: it's the public site).

```
browser --> nginx :443 (https) --> /var/www/site2/current  (the built website, navigator/dist)
```

`navigation.duckdns.org` is a free DuckDNS name pointing at the server, with a Let's Encrypt
certificate that renews by itself (same setup as the Studio, see `studio-web/deploy/README.md`).
The nginx config is in `site2/deploy/` in the repo root.

The Navigator runs entirely in the browser today: it loads the published building from the backend and works out routes
itself (`src/api.ts`), so the server only hands out files (no backend). nginx was set up once
from `site2/deploy/` in the repo root.

## Deploy (automatic, from main)

Every push to `main` deploys by itself: CI (`.github/workflows/build.yml`) builds the site in the
`web` job, then the `deploy-navigator` job uploads it and makes it live. So the live site is always
what is on `main`: to put a change live, merge it into `main`. To redeploy without a new commit,
open the repo's Actions tab, pick **build**, **Run workflow** on `main`.

The upload uses its own SSH key, which can't open a shell: on the server it can only run
`deploy/server/navigator-deploy.sh`, which takes the built site, checks it and makes it live.

### One-time setup

1. Make the key (on your PC, Git Bash). No passphrase, CI has no one to type it:

   ```
   ssh-keygen -t ed25519 -N "" -C "github-actions navigator deploy" -f navigator_deploy
   ```

2. Put the script on the server (from the repo root):

   ```
   scp wayforge/navigator/deploy/server/navigator-deploy.sh team27@51.79.243.238:
   ssh team27@51.79.243.238 "mkdir -p ~/bin && mv ~/navigator-deploy.sh ~/bin/ && chmod 755 ~/bin/navigator-deploy.sh && echo \$HOME"
   ```

   The last line prints the home folder (e.g. `/home/team27`), needed in the next step.

3. On the server, add one line to `~/.ssh/authorized_keys`: the contents of `navigator_deploy.pub`
   with the restriction in front (use the home folder from step 2):

   ```
   restrict,command="/home/team27/bin/navigator-deploy.sh" ssh-ed25519 AAAA... github-actions navigator deploy
   ```

   `restrict` turns off shells, port forwarding and the rest; `command=` makes every login with
   this key run the deploy script, whatever the client asks for.

4. Get the server's host key so CI only ever talks to this server. Over your normal SSH login:

   ```
   ssh team27@51.79.243.238 'echo "51.79.243.238 $(cat /etc/ssh/ssh_host_ed25519_key.pub)"'
   ```

5. On GitHub (needs admin on the repo): **Settings > Environments > New environment**, name it
   `navigator-live`. Under **Deployment branches and tags** choose **Selected branches and tags**
   and add `main`, so only main can use its secrets. Then add two environment secrets:
   - `NAVIGATOR_DEPLOY_KEY`: the whole `navigator_deploy` file (the private key)
   - `NAVIGATOR_KNOWN_HOSTS`: the line printed in step 4

6. Delete `navigator_deploy` and `navigator_deploy.pub` from your PC. If the key ever leaks, delete
   its line from `authorized_keys` on the server and make a new one.

Until the secrets are set, the deploy job only shows a warning and the site is not changed.

## Deploy by hand (Windows)

Needs Node.js 22 LTS (https://nodejs.org) and your SSH key on the server. In a Command Prompt:

```
wayforge\navigator\deploy\deploy.bat
```

It builds the site (`npm run build`) from the code on your PC, uploads `dist/` and makes it live.
For emergencies or trying something out: the next push to `main` replaces it with `main` again.

## Undo a bad upload

Each upload is kept in its own folder (newest 5). On the server:

```
ls -1r /var/www/site2/releases                                     newest first (named by upload time)
ln -sfn /var/www/site2/releases/<older folder> /var/www/site2/current
```

The change is live straight away, no restart needed.
