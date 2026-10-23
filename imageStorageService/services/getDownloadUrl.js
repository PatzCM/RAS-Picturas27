const s3 = require("./s3Client");

// Validade do link de exportação, em minutos (15 por omissão).
const EXPORT_LINK_MINUTES = Number(process.env.EXPORT_LINK_MINUTES) || 15;

// Link temporário para descarregar um ficheiro. Os vídeos já são guardados
// com a indicação para serem descarregados (ver services/uploadVideo.js).
async function getDownloadUrl(userId, projectId, stage, fileName) {
  const params = {
    Bucket: `user-${userId}`,
    Key: `${projectId}/${stage}/${fileName}`,
  };

  // Confirma que o ficheiro existe e obtém o tamanho e o tipo.
  const info = await s3.headObject(params).promise();

  const url = await s3.getSignedUrlPromise("getObject", {
    ...params,
    Expires: EXPORT_LINK_MINUTES * 60,
  });

  const internal = `http://${process.env.S3_ENDPOINT || "seaweedfs:9000"}`;
  return {
    url: url.replace(internal, process.env.FRONTEND_URL + "/s3"),
    expiresInMinutes: EXPORT_LINK_MINUTES,
    size: info.ContentLength,
    contentType: info.ContentType,
  };
}

module.exports = getDownloadUrl;