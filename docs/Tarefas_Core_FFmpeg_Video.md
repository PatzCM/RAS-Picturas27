# Spec do Core de Conversão de Vídeo (FFmpeg)

## 1\. O Teu Papel na Arquitetura (O "Porquê")

A tua colega assumiu toda a complexidade de infraestrutura (RabbitMQ, SeaweedFS, Docker, filas, etc.). O teu trabalho é ser o **"Mecânico do Motor"**: programar a lógica "core" do FFmpeg em Python, totalmente isolada do resto do sistema.

**Regras de Ouro para a tua função:**

* **NÃO** tocas no RabbitMQ.  
* **NÃO** tocas em bases de dados (MongoDB).  
* **NÃO** fazes download nem upload de ficheiros para a cloud (S3).  
* A tua função recebe um ficheiro local (que a tua colega já descarregou para `/tmp`), processa-o, e guarda o novo ficheiro localmente.

---

## 2\. A Interface que tens de criar

A tua missão é construir a pasta `Tools/video_convert/core/` com a seguinte função principal (em Python):

def convert\_video(input: dict, \*, on\_progress=None, is\_cancelled=None) \-\> dict:

    \# input: {inputPath, outputPath, targetFormat?, targetResolution?, preserveUnchanged, timeoutMs?}

    \# on\_progress({percent?, frame?, timeMs?, fps?, etaMs?})

    \# return \-\> {outputPath, format, width, height, durationMs, sizeBytes, videoCodec?, audioCodec?}

---

## 3\. A Tua Checklist de Tarefas (J-01 a J-11)

* **J-01 Instalar FFmpeg:** Adicionar o comando `apt-get install -y ffmpeg` no `Dockerfile` da vossa pasta para garantir que a ferramenta existe dentro do contentor.  
* **J-02 Validação com `ffprobe` (Início):** Antes de tentares converter, usa o comando `ffprobe` (via Python `subprocess`) no ficheiro de origem para garantir que é mesmo um vídeo, ver se não está corrompido e descobrir a sua duração total em milissegundos.  
* **J-03 Matriz MVP (Formatos e Resoluções):** Criar a lógica que traduz o pedido do utilizador. Se o input pedir `mp4` e `720p`, tu defines os parâmetros/codecs exatos que o FFmpeg deve usar (ex: `libx264` para mp4).  
* **J-04 Invocação Segura:** Quando chamares o FFmpeg no Python, **nunca** uses strings diretas na shell (`subprocess.run("ffmpeg -i video.mp4...", shell=True)`). Passa sempre uma lista de argumentos: `subprocess.run(["ffmpeg", "-i", "video.mp4", ...])`. Isto previne vulnerabilidades de segurança.  
* **J-05 Ler o Progresso Real:** O FFmpeg cospe muito texto. Usa o parâmetro `-progress pipe:1` para o FFmpeg te dar informação estruturada. O teu código tem de ler isto, calcular a percentagem (tempo processado / duração total descoberta no J-02) e enviá-la para a função de callback `on_progress(percent)`.  
* **J-06 Cancelamento:** O teu código tem de verificar repetidamente se a função `is_cancelled()` retornou `True`. Se sim, tens de "matar" o processo do FFmpeg ativamente enviando um sinal `SIGTERM` (ou `SIGKILL` em último caso).  
* **J-07 Timeouts:** Se a conversão ultrapassar o tempo limite definido em `timeoutMs`, deves abortar o processo da mesma forma.  
* **J-08 Validação do Output (Fim):** Quando o FFmpeg terminar com sucesso, volta a correr o `ffprobe` no ficheiro de destino (`outputPath`) para garantir que o vídeo final existe, é legível e os metadados estão coerentes.  
* **J-09 Limpeza de Temporários:** Se o teu código gerar algum lixo ou ficheiro intermédio na pasta `/tmp`, certifica-te de que o apagas no final (seja em caso de sucesso ou erro) para não encheres o disco do servidor.  
* **J-10 Testes:** Cria ficheiros de vídeo minúsculos de 1 a 2 segundos (*fixtures*) e escreve testes unitários para a tua função `convert_video`, testando erros, progressos e cancelamentos.  
* **J-11 Integração:** Juntar a tua função ao código de mensageria da tua colega.