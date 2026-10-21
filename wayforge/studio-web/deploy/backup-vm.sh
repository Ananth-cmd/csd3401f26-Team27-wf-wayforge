#!/usr/bin/env bash
# backup-vm.sh - nightly backup of the team server's data and config
#
# setup-vm.sh installs this as a nightly cron job (19:00 server time = 03:00 Singapore time).
# Run by hand any time:   bash ~/wayforge/studio-web/deploy/backup-vm.sh
#
# what goes in ~/backups/vm-backup-<date>.tgz:
#   - the Studio buildings          ~/wayforge/studio-web/server/data
#   - site 2's data, if it exists   ~/site2/server/data
#   - nginx site configs            /etc/nginx/sites-available
#   - the backend services          /etc/systemd/system/wayforge-studio.service, site2-backend.service
# the login file (studio.htpasswd) is NOT included, only root can read it.
#
# keeps the newest 14 backups. These still live ON the VM, so copy them to your PC now and
# then with deploy/pull-backups.bat - if the VM is lost, so is everything in ~/backups.
#
# \author Joel Chua (c.jialiang@digipen.edu)
# AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the header comments.
# \date 2026-10-21
set -euo pipefail

KEEP=14
OUT="$HOME/backups"
mkdir -p "$OUT"
FILE="$OUT/vm-backup-$(date -u +%Y%m%d-%H%M).tgz"

# only back up the paths that exist (site 2 may not be set up yet)
PATHS=()
for p in "$HOME/wayforge/studio-web/server/data" \
         "$HOME/site2/server/data" \
         /etc/nginx/sites-available \
         /etc/systemd/system/wayforge-studio.service \
         /etc/systemd/system/site2-backend.service; do
  [ -e "$p" ] && PATHS+=("$p")
done

# -P keeps the full paths, so you can see where each file came from when restoring
tar -czPf "$FILE" "${PATHS[@]}"
chmod 600 "$FILE"
echo "$(date -u +%FT%TZ) saved $FILE ($(du -h "$FILE" | cut -f1))"

# delete all but the newest $KEEP backups
ls -1t "$OUT"/vm-backup-*.tgz | tail -n +$((KEEP + 1)) | xargs -r rm -f
