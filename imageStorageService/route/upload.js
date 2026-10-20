const express = require("express");
const multer = require("multer");
const uploadImage = require("../services/uploadImage");
const { getInternalPutUrl, getPublicPutUrl } = require("../services/getPresignedUrl");
const allowedStages = require("../utils/stages");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Endpoint para gerar Presigned PUT URL (para upload direto ao S3 pelo Frontend ou microserviços)
router.get(
  "/presigned/:access/:userId/:projectId/:stage/:fileName",
  async (req, res) => {
    const { access, userId, projectId, stage, fileName } = req.params;
    const contentType = req.query.contentType || "video/mp4";

    if (access !== "internal" && access !== "public") {
      return res.status(400).json({
        error: "O acesso deve ser internal ou public.",
      });
    }

    if (!allowedStages.includes(stage)) {
      return res.status(400).json({
        error: "O estágio deve ser src, preview, preview_cache ou out.",
      });
    }

    try {
      const url =
        access === "internal"
          ? await getInternalPutUrl(userId, projectId, stage, fileName, contentType)
          : await getPublicPutUrl(userId, projectId, stage, fileName, contentType);

      const bucket = `user-${userId}`;
      const key = `${projectId}/${stage}/${fileName}`;

      res.status(200).json({
        url,
        bucket,
        key,
        expiresIn: 3600,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

router.post(
  "/:userId/:projectId/:stage",
  upload.single("file"),
  async (req, res) => {
    const { userId, projectId, stage } = req.params;

    if (!allowedStages.includes(stage)) {
      return res.status(400).json({
        error: "O estágio deve ser src, preview, preview_cache ou out.",
      });
    }


    try {
      const result = await uploadImage(userId, projectId, req.file, stage);
      res
        .status(201)
        .json({ message: "Imagem enviada com sucesso!", data: result });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

module.exports = router;

