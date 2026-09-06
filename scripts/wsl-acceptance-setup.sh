#!/bin/sh
set -eu
stage=$1
fixture_dir=$2
source_dir=$3
case "$fixture_dir" in /var/tmp/server-check-acceptance-*) ;; *) echo 'Unexpected fixture directory' >&2; exit 2 ;; esac
case "$source_dir" in /mnt/c/Users/Zetta/AppData/Local/Temp/server-check-wsl-*) ;; *) echo 'Unexpected source directory' >&2; exit 2 ;; esac

if [ "$stage" = init ]; then
  test ! -e "$fixture_dir"
  install -d -m 755 "$fixture_dir" "$fixture_dir/public" "$fixture_dir/packages" "$fixture_dir/downloads"
  install -d -m 700 "$fixture_dir/agents"
  for script in "$source_dir"/*.sh; do install -m 700 "$script" "$fixture_dir/agents/"; done
  for config in nginx.conf apache.conf middleware.py nginx.service apache2.service middleware.service; do
    install -m 644 "$source_dir/$config" "$fixture_dir/$config"
  done
  install -m 644 "$source_dir/index.html" "$fixture_dir/public/index.html"
  printf 'WSL fixture files prepared: %s\n' "$fixture_dir"
elif [ "$stage" = binaries ]; then
  cd "$fixture_dir/downloads"
  apt-get download nginx apache2-bin libapr1t64 libaprutil1t64
  for package in ./*.deb; do dpkg-deb -x "$package" "$fixture_dir/packages"; done
  export LD_LIBRARY_PATH="$fixture_dir/packages/usr/lib/x86_64-linux-gnu"
  ldd "$fixture_dir/packages/usr/sbin/apache2"
  ldd "$fixture_dir/packages/usr/sbin/nginx"
  "$fixture_dir/packages/usr/sbin/apache2" -f "$fixture_dir/apache.conf" -t
  "$fixture_dir/packages/usr/sbin/nginx" -c "$fixture_dir/nginx.conf" -t
elif [ "$stage" = services ]; then
  for service in apache2 nginx; do
    test "$(systemctl show "$service.service" --property=LoadState --value)" = not-found
    test ! -e "/run/systemd/system/$service.service"
    install -m 644 "$fixture_dir/$service.service" "/run/systemd/system/$service.service"
  done
  test ! -e /run/systemd/system/server-check-wsl-middleware.service
  install -m 644 "$fixture_dir/middleware.service" /run/systemd/system/server-check-wsl-middleware.service
  systemctl daemon-reload
  systemctl start apache2 nginx server-check-wsl-middleware
  systemctl is-active apache2 nginx server-check-wsl-middleware
else
  echo 'Use init, binaries, or services' >&2
  exit 2
fi
