ADICIONAR ESTES COMANDOS AO DOCKER FILE QUE VAO SER CRIADOS PELA PATRICIA

FROM python:3.11-slim

# Tarefa J-01: Instalar o FFmpeg no sistema operativo do contentor
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# (O comando de entrypoint da tua colega virá aqui)