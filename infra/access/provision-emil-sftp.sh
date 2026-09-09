#!/usr/bin/env bash

VALIDATED_ED25519_KEY=''
transaction_dir=''

read_validated_ed25519_key() {
  local -a non_empty_lines=()
  local candidate

  VALIDATED_ED25519_KEY=''
  mapfile -t non_empty_lines < <(sed '/^[[:space:]]*$/d')
  if [[ ${#non_empty_lines[@]} -ne 1 ]]; then
    printf 'ERROR: provide exactly one non-empty Ed25519 public-key line on stdin.\n' >&2
    return 1
  fi

  candidate=${non_empty_lines[0]}
  if [[ "$candidate" != ssh-ed25519\ * ]]; then
    printf 'ERROR: the submitted key must be an ssh-ed25519 public key.\n' >&2
    return 1
  fi
  if ! ssh-keygen -l -f - <<<"$candidate" >/dev/null 2>&1; then
    printf 'ERROR: the submitted Ed25519 public key is invalid.\n' >&2
    return 1
  fi

  VALIDATED_ED25519_KEY=$candidate
}

restore_prior_file() {
  local target=$1
  local backup=$2
  local was_present=$3

  rm -f -- "$target"
  if [[ "$was_present" == true ]]; then
    cp -a -- "$backup" "$target"
  fi
}

cleanup_transaction() {
  if [[ -n "${transaction_dir:-}" ]]; then
    rm -rf -- "$transaction_dir"
  fi
}

main() {
  set -euo pipefail

  if [[ $EUID -ne 0 ]]; then
    printf 'ERROR: this provisioner must run as root.\n' >&2
    exit 1
  fi

  read_validated_ed25519_key
  local public_key=$VALIDATED_ED25519_KEY

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

  local denied_group
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
  install -d -o root -g root -m 0755 /etc/ssh/sshd_config.d

  local key_file=/etc/ssh/authorized_keys/emil-anyjersey
  local script_dir
  script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
  local sshd_source="$script_dir/60-emil-anyjersey.conf"
  local sshd_target=/etc/ssh/sshd_config.d/60-emil-anyjersey.conf

  umask 077
  transaction_dir=$(mktemp -d)
  trap cleanup_transaction EXIT

  local previous_key="$transaction_dir/previous-key"
  local previous_snippet="$transaction_dir/previous-snippet"
  local previous_key_present=false
  local previous_snippet_present=false
  local key_temp="$transaction_dir/new-key"

  if [[ -e "$key_file" || -L "$key_file" ]]; then
    cp -a -- "$key_file" "$previous_key"
    previous_key_present=true
  fi
  if [[ -e "$sshd_target" || -L "$sshd_target" ]]; then
    cp -a -- "$sshd_target" "$previous_snippet"
    previous_snippet_present=true
  fi
  printf 'restrict %s\n' "$public_key" >"$key_temp"

  if ! install -o root -g root -m 0644 "$sshd_source" "$sshd_target"; then
    restore_prior_file "$sshd_target" "$previous_snippet" "$previous_snippet_present"
    printf 'ERROR: the SSH restriction snippet could not be installed.\n' >&2
    exit 1
  fi

  if ! sshd -t; then
    if [[ "$previous_snippet_present" == true ]]; then
      rm -f -- "$sshd_target"
      cp -a -- "$previous_snippet" "$sshd_target"
    else
      rm -f -- "$sshd_target"
    fi
    if ! sshd -t; then
      printf 'ERROR: sshd validation failed and the restored configuration is invalid.\n' >&2
    else
      printf 'ERROR: sshd validation failed; the prior snippet was restored.\n' >&2
    fi
    exit 1
  fi

  if ! install -o root -g root -m 0600 "$key_temp" "$key_file"; then
    restore_prior_file "$key_file" "$previous_key" "$previous_key_present"
    restore_prior_file "$sshd_target" "$previous_snippet" "$previous_snippet_present"
    printf 'ERROR: the authorised key could not be installed; prior files were restored.\n' >&2
    exit 1
  fi

  if ! systemctl reload ssh; then
    restore_prior_file "$key_file" "$previous_key" "$previous_key_present"
    restore_prior_file "$sshd_target" "$previous_snippet" "$previous_snippet_present"

    if ! sshd -t; then
      printf 'ERROR: SSH reload failed and the restored configuration is invalid.\n' >&2
      exit 1
    fi
    if ! systemctl reload ssh; then
      printf 'ERROR: SSH reload failed and the restored configuration could not be reloaded.\n' >&2
      exit 1
    fi

    printf 'ERROR: SSH reload failed; the prior key and snippet were restored and reloaded.\n' >&2
    exit 1
  fi

  cleanup_transaction
  transaction_dir=''
  trap - EXIT
  printf 'Emil AnyJersey SFTP access is provisioned.\n'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
