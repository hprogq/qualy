#!/bin/sh
# Storage-side steps for demo/restore.sh. The saved icons survive an
# interrupted swap and are removed only after the serving color is ready.
set -eu

operation=$1
root=$2
keep=$root/.qualy-restore-kept
tmp=$root/.qualy-restore-kept.tmp
completed=$root/.qualy-restore-completed
incoming=$root/.incoming

case "$operation" in
  check)
    [ ! -e "$keep" ] || {
      echo "an earlier keep-sign-in restore has saved icons; resume it with --keep-sign-in" >&2
      exit 1
    }
    rm -rf "$tmp" "$completed"
    ;;
  prepare)
    rm -rf "$completed"
    if [ ! -d "$keep" ]; then
      rm -rf "$tmp"
      mkdir "$tmp"
      for key in ${QUALY_KEEP_KEYS:-}; do
        [ -f "$root/$key" ] && [ ! -L "$root/$key" ] || {
          echo "a kept local icon is missing: $key" >&2
          exit 1
        }
        mkdir -p "$tmp/${key%/*}"
        cp -p "$root/$key" "$tmp/$key"
      done
      mv "$tmp" "$keep"
    fi
    # A previous attempt may have saved a different set of icons. Do not
    # proceed with a backup that cannot satisfy this restore's database.
    for key in ${QUALY_KEEP_KEYS:-}; do
      [ -f "$keep/$key" ] && [ ! -L "$keep/$key" ] || {
        echo "the saved icon is missing: $key" >&2
        exit 1
      }
    done
    ;;
  swap)
    rm -rf "$incoming"
    mkdir "$incoming"
    tar -xzf "$3" -C "$incoming"
    [ ! -e "$incoming/.qualy-restore-kept" ] && [ ! -e "$incoming/.qualy-restore-kept.tmp" ] || {
      echo "the baseline contains a reserved restore directory" >&2
      exit 1
    }
    for key in ${QUALY_KEEP_KEYS:-}; do
      [ -f "$keep/$key" ] && [ ! -L "$keep/$key" ] || {
        echo "the saved icon is missing: $key" >&2
        exit 1
      }
      mkdir -p "$incoming/${key%/*}"
      cp -p "$keep/$key" "$incoming/$key"
    done
    find "$root" -mindepth 1 -maxdepth 1 ! -name .incoming ! -name .qualy-restore-kept ! -name .qualy-restore-kept.tmp -exec rm -rf {} +
    find "$incoming" -mindepth 1 -maxdepth 1 -exec mv {} "$root/" \;
    rmdir "$incoming"
    ;;
  finish)
    # Once ready, detach the backup atomically before deleting it. A crash
    # during removal must not leave a partial backup that blocks the next run.
    rm -rf "$completed"
    if [ -e "$keep" ]; then mv "$keep" "$completed"; fi
    rm -rf "$completed" "$tmp"
    ;;
  *) echo "unknown storage restore operation" >&2; exit 1 ;;
esac
