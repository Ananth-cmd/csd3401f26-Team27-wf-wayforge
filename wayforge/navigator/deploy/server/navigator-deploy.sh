#!/usr/bin/env bash
# navigator-deploy.sh - installs a new Navigator build on the team server
# It is the forced command of the GitHub Actions deploy key (see ../README.md), so that key can do
# nothing else: it can only send a .tgz of dist/ on stdin, which this script checks, unpacks into
# its own release folder and makes live. Same folders as deploy.bat (newest 5 kept).
#
# from CI:       tar -czf - -C dist . | ssh team27@51.79.243.238
# test locally:  tar -czf - -C dist . | bash navigator-deploy.sh /tmp/site2
#
# \author Joel Chua (c.jialiang@digipen.edu)
# Claude was used to help automate the deployment of the webserver instead of just running the deploy.bat script everytime to upload the changes made
# \date 2026-10-28
set -euo pipefail
umask 022

SITE=${1:-/var/www/site2}          # argument only for testing: the deploy key can't pass arguments
MAX_BYTES=$((100 * 1024 * 1024))   # a build is a few MB; stop there instead of filling the disk

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
reject() { echo "rejected: $1" >&2; exit 1; }

head -c $((MAX_BYTES + 1)) > "$work/upload.tgz"
[ "$(stat -c %s "$work/upload.tgz")" -le "$MAX_BYTES" ] || reject "upload is over $MAX_BYTES bytes"

# only plain files and folders, all inside the site folder, with index.html at the top
tar -tvzf "$work/upload.tgz" > "$work/list" 2>/dev/null || reject "not a .tgz"
! grep -qv '^[-d]' "$work/list" || reject "links or special files in the upload"
tar -tzf "$work/upload.tgz" > "$work/names"
! grep -qE '^/|(^|/)\.\.(/|$)' "$work/names" || reject "paths outside the site folder"
grep -qxE '(\./)?index\.html' "$work/names" || reject "no index.html at the top"

release="$SITE/releases/$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$release"
tar -xzf "$work/upload.tgz" -C "$release" --no-same-owner --no-same-permissions
chmod -R a+rX "$release"
ln -sfn "$release" "$SITE/current"
# newest 5 by name (= upload time): tar gives each folder the build's date, so don't sort by date
ls -1d "$SITE"/releases/* | sort -r | tail -n +6 | xargs -r rm -rf
echo "live: $release"
