#!/usr/bin/env bash
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  printf 'ERROR: this provisioner must run as root.\n' >&2
  exit 1
fi

mapfile -t non_empty_lines < <(sed '/^[[:space:]]*$/d')
if [[ ${#non_empty_lines[@]} -ne 1 ]]; then
  printf 'ERROR: provide exactly one non-empty Ed25519 public-key line on stdin.\n' >&2
  exit 1
fi

public_key=${non_empty_lines[0]}
if [[ "$public_key" != ssh-ed25519\ * ]]; then
  printf 'ERROR: the submitted key must be an ssh-ed25519 public key.\n' >&2
  exit 1
fi
if ! ssh-keygen -l -f - <<<"$public_key" >/dev/null 2>&1; then
  printf 'ERROR: the submitted Ed25519 public key is invalid.\n' >&2
  exit 1
fi

if ! getent group anyjersey >/dev/null; then
  groupadd anyjersey
fi

if id emil-anyjersey >/dev/null 2>&1; then
  usermod --home /workspace --shell /usr/sbin/nologin --gid anyjersey emil-anyjersey
else
  useradd --home-dir /workspace --shell /usr/sbin/nologin --gid anyjersey \
    --no-create-home emil-anyjersey
fi
passwd --lock emil-anyjersey >/dev/null

for denied_group in sudo docker; do
  if getent group "$denied_group" >/dev/null \
    && id -nG emil-anyjersey | tr ' ' '\n' | grep -Fxq "$denied_group"; then
    gpasswd --delete emil-anyjersey "$denied_group" >/dev/null
  fi
done

install -d /srv/anyjersey-access
chown root:root /srv/anyjersey-access
chmod 0755 /srv/anyjersey-access

install -d /srv/anyjersey-access/workspace
chown emil-anyjersey:anyjersey /srv/anyjersey-access/workspace
chmod 2770 /srv/anyjersey-access/workspace

install -d -o root -g root -m 0755 /etc/ssh/authorized_keys
key_file=/etc/ssh/authorized_keys/emil-anyjersey
key_temp=$(mktemp /etc/ssh/authorized_keys/.emil-anyjersey.XXXXXX)
previous_snippet=''

cleanup() {
  rm -f -- "$key_temp"
  if [[ -n "$previous_snippet" ]]; then
    rm -f -- "$previous_snippet"
  fi
}
trap cleanup EXIT

printf 'restrict %s\n' "$public_key" >"$key_temp"
install -o root -g root -m 0600 "$key_temp" "$key_file"
rm -f -- "$key_temp"

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
sshd_source="$script_dir/60-emil-anyjersey.conf"
sshd_target=/etc/ssh/sshd_config.d/60-emil-anyjersey.conf
install -d -o root -g root -m 0755 /etc/ssh/sshd_config.d

if [[ -e "$sshd_target" ]]; then
  previous_snippet=$(mktemp)
  cp -a -- "$sshd_target" "$previous_snippet"
fi
install -o root -g root -m 0644 "$sshd_source" "$sshd_target"

if ! sshd -t; then
  if [[ -n "$previous_snippet" ]]; then
    cp -a -- "$previous_snippet" "$sshd_target"
  else
    rm -f -- "$sshd_target"
  fi
  printf 'ERROR: sshd configuration validation failed; the prior snippet was restored.\n' >&2
  exit 1
fi

systemctl reload ssh
printf 'Emil AnyJersey SFTP access is provisioned.\n'
