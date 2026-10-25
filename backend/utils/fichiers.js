const fs = require('fs');

// Supprime les fichiers déjà enregistrés sur le disque (en cas d'erreur de validation)
function supprimerFichiers(files = []) {
  files.forEach((f) => fs.unlink(f.path, () => {}));
}

module.exports = { supprimerFichiers };