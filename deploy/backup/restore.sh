#!/bin/sh
# Restaura um backup num Postgres VAZIO (servidor novo ou ensaio de restauração).
#
#   restore.sh <arquivo.tar.age> <chave-privada-age> <destino-dos-logos>
#
# Variáveis PG* (PGHOST, PGUSER=tanaregua, PGPASSWORD, PGDATABASE=tanaregua) apontam para o
# banco de destino, já criado pelo db-init (usuário tanaregua_app existente). Rode dentro do
# container de backup para ter pg_restore e age na mesma versão:
#
#   docker compose run --rm -v /caminho/chave.txt:/key.txt:ro -v ./restaurado:/restore \
#     backup restore /restore/tanaregua-....tar.age /key.txt /restore/storage
set -eu

archive="${1:?uso: restore.sh <arquivo.tar.age> <chave-privada-age> <destino-dos-logos>}"
identity="${2:?informe a chave privada age}"
storage_dir="${3:?informe onde extrair os logos}"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

age -d -i "$identity" "$archive" | tar -C "$work" -xf -
pg_restore --exit-on-error --single-transaction --dbname="$PGDATABASE" "$work/db.dump"
mkdir -p "$storage_dir"
tar -C "$storage_dir" -xzf "$work/storage.tar.gz"

echo "restore: banco restaurado em ${PGHOST:-localhost}/${PGDATABASE}; logos em ${storage_dir}"
