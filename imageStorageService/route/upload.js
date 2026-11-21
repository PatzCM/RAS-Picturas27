const express = require("express");
const multer = require("multer");
const os = require("os");
const fs = require("fs");
const uploadImage = require("../services/uploadImage");

const router = express.Router();
// Files go to a temporary file on disk instead of memory,
// so a large video does not fill the service's RAM.
const upload = multer({ dest: os.tmpdir() });

router.post(
  "/:userId/:projectId/:stage",
  upload.single("file"),
  async (req, res) => {
    const { userId, projectId, stage } = req.params;

    const allowedStages = require("../utils/stages");

    try {
      if (!allowedStages.includes(stage)) {
        return res.status(400).json({
          error: "O estágio deve ser src, preview, preview_cache ou out.",
        });
      }

      const result = await uploadImage(userId, projectId, req.file, stage);
      res
        .status(201)
        .json({ message: "Imagem enviada com sucesso!", data: result });
    } catch (error) {
      res.status(500).json({ error: error.message });
    } finally {
      // Always remove the temporary file
      if (req.file) fs.unlink(req.file.path, () => {});
    }
  },
);

module.exports = router;