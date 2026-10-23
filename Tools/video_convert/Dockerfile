FROM python:3.11-slim

# Instalação do FFmpeg no contentor
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instalar dependências Python
COPY ./video_convert/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar todo o código do microserviço
COPY ./video_convert /app

CMD ["python", "-u", "video_convert.py"]
