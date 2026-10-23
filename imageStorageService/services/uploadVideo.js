const fs = require("fs");
const s3 = require("./s3Client");
const createBucket = require("./createBucket");
const videoFormats = require("../utils/videoFormats");
const { v4: uuidv4 } = require("uuid");

async function uploadVideo(userId, projectId, file, stage) {
  const bucketName = `user-${userId}`;

  const fileName = `${uuidv4()}.${videoFormats[file.mimetype]}`;
  const videoKey = `${projectId}/${stage}/${fileName}`;
  const params = {
    Bucket: bucketName,
    Key: videoKey,
    Body: fs.createReadStream(file.path),
    ContentType: file.mimetype,
    // Faz com que o browser descarregue o vídeo em vez de o abrir.
    ContentDisposition: `attachment; filename="${fileName}"`,
  };

  try {
    await createBucket(bucketName);
    const data = await s3.upload(params).promise();
    return { videoKey, location: data.Location };
  } catch (error) {
    console.error("Erro ao enviar vídeo:", error.message);
    throw error;
  } finally {
    // Apaga o ficheiro temporário do disco, quer o envio corra bem quer falhe.
    await fs.promises.unlink(file.path).catch(() => {});
  }
}

module.exports = uploadVideo;