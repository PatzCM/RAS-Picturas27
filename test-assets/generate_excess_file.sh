#!/usr/bin/env bash
# Gera o ficheiro de teste com tamanho superior a 100 MB para testes de erro de payload/tamanho
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_FILE="${SCRIPT_DIR}/amostra_invalida_excesso.mp4"

if [ ! -f "$TARGET_FILE" ]; then
  echo "A gerar ${TARGET_FILE} com 105 MB..."
  head -c 105M </dev/urandom > "$TARGET_FILE"
  echo "Ficheiro gerado com sucesso."
else
  echo "O ficheiro ${TARGET_FILE} já existe."
fi
