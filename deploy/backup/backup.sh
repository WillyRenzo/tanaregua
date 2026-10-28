#!/bin/sh
# Backup criptografado do banco e dos logos (architecture.md, "Dados").
# O arquivo é cifrado com a CHAVE PÚBLICA age (BACKUP_AGE_RECIPIENT): a chave privada fica
# fora da VPS, então quem invadir o servidor não lê os backups antigos.
# Restauração: deploy/backup/restore.sh (runbook em deploy/README.md).
set -eu

stamp=$(date -u +%Y%m%dT%H%M%SZ)
name="tanaregua-${stamp}.tar.age"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

pg_dump --format=custom --file="$work/db.dump"
tar -C /storage -czf "$work/storage.tar.gz" .
tar -C "$work" -cf - db.dump storage.tar.gz | age -r "$BACKUP_AGE_RECIPIENT" > "$work/$name"

rclone copyto "$work/$name" "remote:${BACKUP_DESTINATION}/${name}"
rclone delete --min-age "${BACKUP_RETENTION_DAYS:-30}d" "remote:${BACKUP_DESTINATION}"

echo "backup: ${name} enviado ($(du -h "$work/$name" | cut -f1))"
