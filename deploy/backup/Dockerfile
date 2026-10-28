# Backup diário: pg_dump (mesma versão do Postgres) + age (criptografia) + rclone (S3).
FROM postgres:18-alpine
RUN apk add --no-cache age rclone
COPY --chmod=755 backup.sh /usr/local/bin/backup
COPY --chmod=755 schedule.sh /usr/local/bin/schedule
COPY --chmod=755 restore.sh /usr/local/bin/restore
USER postgres
CMD ["schedule"]
