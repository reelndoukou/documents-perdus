require('dotenv').config();
const fs = require('fs');
const cloudinary = require('cloudinary').v2;

// Sans CLOUDINARY_URL (développement hors ligne), on garde le stockage sur disque
const actif = !!process.env.CLOUDINARY_URL;
if (actif) cloudinary.config({ secure: true });

// Filigrane diagonal appliqué à toutes les photos publiques.
// Le SDK ajoute lui-même fl_layer_apply ; les réglages de placement vont dans le 2e bloc.
const TRANSFO_PUBLIQUE = [
  { width: 900, crop: 'limit', quality: 'auto' },
  { overlay: { font_family: 'Arial', font_size: 64, font_weight: 'bold', text: 'DOCUMENTS PERDUS' }, color: 'white' },
  { flags: 'layer_apply', gravity: 'center', angle: -25, opacity: 45 },
];

// Envoie une photo reçue par multer. Renvoie la référence à enregistrer en base.
async function enregistrer(file) {
  if (!actif) return `/uploads/${file.filename}`;
  const r = await cloudinary.uploader.upload(file.path, {
    type: 'authenticated',
    folder: 'documents-perdus',
    resource_type: 'image',
  });
  fs.unlink(file.path, () => {}); // le fichier temporaire local n'est plus utile
  return `cld:${r.public_id}`;
}

// Nettoyage si l'enregistrement en base échoue après l'envoi des photos
async function supprimer(refs = []) {
  for (const ref of refs) {
    if (actif && ref.startsWith('cld:')) {
      await cloudinary.uploader
        .destroy(ref.slice(4), { type: 'authenticated', resource_type: 'image' })
        .catch(() => {});
    }
  }
}

// URL pour le public : filigranée, réduite, signée
function urlPublique(ref) {
  if (!ref.startsWith('cld:')) return ref;
  return cloudinary.url(ref.slice(4), {
    type: 'authenticated',
    sign_url: true,
    secure: true,
    resource_type: 'image',
    transformation: TRANSFO_PUBLIQUE,
  });
}

// URL pour l'équipe : image originale, signée
function urlOriginale(ref) {
  if (!ref.startsWith('cld:')) return ref;
  return cloudinary.url(ref.slice(4), {
    type: 'authenticated',
    sign_url: true,
    secure: true,
    resource_type: 'image',
  });
}

module.exports = { enregistrer, supprimer, urlPublique, urlOriginale };