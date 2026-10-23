const express = require("express");
const multer = require("multer");
const os = require("os");
const uploadVideo = require("../services/uploadVideo");
const allowedStages = require("../utils/stages");
const videoFormats = require("../utils/videoFormats");

const router = express.Router();

// Tamanho máximo de um vídeo, em MB (1 GB por omissão).
const MAX_VIDEO_MB = Number(process.env.MAX_VIDEO_MB) || 1024;

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: MAX_VIDEO_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (Object.hasOwn(videoFormats, file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Formato de vídeo não suportado. Use MP4, WebM ou MOV."));
    }
  },
}).single("file");

router.post("/:userId/:projectId/:stage", (req, res) => {
  const { userId, projectId, stage } = req.params;

  if (!allowedStages.includes(stage)) {
    return res.status(400).json({
      error: "O estágio deve ser src, preview, preview_cache ou out.",
    });
  }

  upload(req, res, async (err) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        error: `O vídeo excede o tamanho máximo de ${MAX_VIDEO_MB} MB.`,
      });
    }
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum ficheiro enviado no campo "file".' });
    }

    try {
      const result = await uploadVideo(userId, projectId, req.file, stage);
      res.status(201).json({ message: "Vídeo enviado com sucesso!", data: result });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
});

module.exports = router;