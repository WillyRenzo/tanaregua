#!/bin/sh
# Roda o backup uma vez por dia, na hora BACKUP_HOUR_UTC. Um laço com sleep em vez de cron:
# o crond do busybox não repassa as variáveis de ambiente do container para o job.
set -eu

hour="${BACKUP_HOUR_UTC:-6}"
echo "backup: agendado diariamente às ${hour}h UTC"

while true; do
  now=$(date -u +%s)
  next=$(date -u -d "$(date -u +%Y-%m-%d) ${hour}:00:00" +%s)
  [ "$next" -gt "$now" ] || next=$((next + 86400))
  sleep $((next - now))
  # Uma falha não derruba o agendamento: fica no log e o próximo dia tenta de novo.
  backup || echo "backup: FALHOU (veja as linhas acima)" >&2
done
