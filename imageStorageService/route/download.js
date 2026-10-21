const express = require("express");
const getDownloadUrl = require("../services/getDownloadUrl");
const allowedStages = require("../utils/stages");
const videoFormats = require("../utils/videoFormats");

const router = express.Router();

// Extensões de vídeo que podem ser exportadas (mp4, webm, mov).
const videoExtensions = Object.values(videoFormats);

router.get("/:userId/:projectId/:stage/:fileName", async (req, res) => {
  const { userId, projectId, stage, fileName } = req.params;

  if (!allowedStages.includes(stage)) {
    return res.status(400).json({
      error: "O estágio deve ser src, preview, preview_cache ou out.",
    });
  }

  const extension = fileName.split(".").pop();
  if (!videoExtensions.includes(extension)) {
    return res.status(400).json({
      error: "Só é possível exportar vídeos (MP4, WebM ou MOV).",
    });
  }

  try {
    const result = await getDownloadUrl(userId, projectId, stage, fileName);
    res.status(200).json(result);
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ error: "Vídeo não encontrado." });
    }
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;