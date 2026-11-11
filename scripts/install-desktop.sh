#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
node -e "require('node:sqlite')"
if [ ! -d node_modules ]; then npm ci; fi
npm run build
python - "$PWD" <<'PY'
from pathlib import Path
import sys,shutil
project=Path(sys.argv[1]); home=Path.home()
node=shutil.which('node')
def unit_quote(text):
    return '"'+str(text).replace('\\','\\\\').replace('"','\\"').replace('%','%%')+'"'
units=home/'.config/systemd/user'; units.mkdir(parents=True,exist_ok=True)
(units/'securechat.service').write_text('\n'.join([
    '[Unit]','Description=SecureChat local messenger','After=network.target','',
    '[Service]','Type=simple','WorkingDirectory='+str(project).replace('%','%%'),
    'ExecStart='+unit_quote(node)+' '+unit_quote(project/'backend/server.js'),
    'Environment=HOST=127.0.0.1','Environment=PORT=5000','Restart=on-failure','RestartSec=3',
    'UMask=0077','',
])+'\n')
bin_dir=home/'.local/bin'; bin_dir.mkdir(parents=True,exist_ok=True)
launcher=bin_dir/'securechat'
launcher.write_text('''#!/usr/bin/env bash
set -euo pipefail
systemctl --user start securechat.service
for attempt in {1..40}; do
    if curl --fail --silent http://localhost:5000/api/health >/dev/null; then
        exec xdg-open http://localhost:5000
    fi
    sleep 0.1
done
printf 'SecureChat did not start. Check: journalctl --user -u securechat.service\\n' >&2
exit 1
''')
launcher.chmod(0o755)
apps=home/'.local/share/applications';apps.mkdir(parents=True,exist_ok=True)
(apps/'securechat.desktop').write_text('\n'.join([
    '[Desktop Entry]','Type=Application','Name=SecureChat','Comment=A little space for your people',
    'Exec="'+str(launcher).replace('"','\\"')+'"','Icon='+str(project/'client/public/favicon.svg'),
    'Terminal=false','Categories=Network;InstantMessaging;',
])+'\n')
PY
systemctl --user daemon-reload
printf 'Installed SecureChat in your app launcher. Run securechat to open it.\n'
