# Test Assets - Módulo de Vídeo (Fase 1)

Esta pasta contém os artefactos preparados para validação e testes de ponta-a-ponta descritos no **Anexo A.7**:

- `amostra_valida_1080p.mp4`: Vídeo MP4 (H.264/AAC), duração nominal para testes de conversão e exportação.
- `amostra_720p.webm`: Vídeo WebM (VP9/Opus) para teste de compatibilidade e conversão para MP4.
- `amostra_limite_180s.mp4`: Vídeo com 180 segundos para teste de fronteira de duração.
- `amostra_invalida_excesso.mp4`: Ficheiro com > 100 MB para teste do erro de quota/tamanho de payload (ignorado pelo git para respeitar o limite de 100 MB do GitHub).

### Como gerar o ficheiro de excesso (> 100 MB) localmente:
Caso clone o repositório numa nova máquina, execute:
```bash
./test-assets/generate_excess_file.sh
```
ou diretamente:
```bash
head -c 105M </dev/urandom > test-assets/amostra_invalida_excesso.mp4
```
