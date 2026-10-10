#!/bin/sh
# Volumes montados pela hospedagem chegam como root: ajusta o dono; o Node troca para o usuário "node".
set -e
mkdir -p /app/storage
chown -R node:node /app/storage
exec "$@"
