const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const dossier = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(dossier, { recursive: true });

// On déduit l'extension du type réel du fichier, jamais du nom envoyé par l'utilisateur
const EXTENSIONS = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, dossier),
  filename: (req, file, cb) => cb(null, crypto.randomUUID() + EXTENSIONS[file.mimetype]),
});

const fileFilter = (req, file, cb) => {
  if (EXTENSIONS[file.mimetype]) return cb(null, true);
  const e = new Error('Format d\'image non accepté (JPG, PNG ou WEBP uniquement)');
  e.status = 400;
  cb(e);
};

module.exports = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024, files: 2 },
});