const { supprimerFichiers } = require('../utils/fichiers');

const erreur = (message, status = 400) => {
  const e = new Error(message);
  e.status = status;
  return e;
};

const TEL_REGEX = /^[+\d\s().-]{8,20}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.validerDeclaration = (req, res, next) => {
  const b = req.body;
  const files = req.files || [];
  // Si la validation échoue, on supprime les photos déjà enregistrées
  const echec = (message) => {
    supprimerFichiers(files);
    return next(erreur(message));
  };

  if (!b.nom_complet || !b.nom_complet.trim()) return echec('Le nom complet figurant sur le document est obligatoire');
  if (!b.type_document_id || isNaN(parseInt(b.type_document_id))) return echec('Le type de document est obligatoire');
  if (!b.ville || !b.ville.trim()) return echec('La ville est obligatoire');
  if (!['garde', 'depose'].includes(b.mode)) return echec('Le mode doit être "garde" ou "depose"');
  if (files.length !== 2) return echec('Deux photos du document sont obligatoires');

  const anonyme = b.anonyme === 'true';

  if (b.mode === 'garde') {
    if (anonyme) return echec('Le mode anonyme n\'est possible que si le document a été déposé dans un établissement');
    if (!b.declarant_nom || !b.declarant_nom.trim()) return echec('Votre nom est obligatoire');
    if (!b.declarant_telephone || !TEL_REGEX.test(b.declarant_telephone)) return echec('Un numéro de téléphone valide est obligatoire');
  }

  if (b.mode === 'depose') {
    if (!b.lieu_depot_description || !b.lieu_depot_description.trim()) {
      return echec('Décrivez l\'endroit où le document a été déposé');
    }
    if (!anonyme && b.declarant_telephone && !TEL_REGEX.test(b.declarant_telephone)) {
      return echec('Numéro de téléphone invalide');
    }
  }

  if (b.declarant_email && !EMAIL_REGEX.test(b.declarant_email)) return echec('Adresse e-mail invalide');

  next();
};

exports.validerId = (req, res, next) => {
  if (isNaN(parseInt(req.params.id))) return next(erreur('Identifiant invalide'));
  next();
};

exports.validerDeblocage = (req, res, next) => {
  const { proprietaire_nom, proprietaire_telephone } = req.body;
  if (!proprietaire_nom || !proprietaire_nom.trim()) return next(erreur('Votre nom est obligatoire'));
  if (!proprietaire_telephone || !TEL_REGEX.test(proprietaire_telephone)) {
    return next(erreur('Un numéro de téléphone valide est obligatoire'));
  }
  next();
};

exports.validerAlerte = (req, res, next) => {
  const b = req.body;
  if (!b.nom_complet || !b.nom_complet.trim()) return next(erreur('Le nom complet figurant sur le document est obligatoire'));
  if (!b.type_document_id || isNaN(parseInt(b.type_document_id))) return next(erreur('Le type de document est obligatoire'));
  if (!b.ville || !b.ville.trim()) return next(erreur('La ville est obligatoire'));
  if (!b.telephone || !TEL_REGEX.test(b.telephone)) return next(erreur('Un numéro de téléphone valide est obligatoire'));
  if (b.email && !EMAIL_REGEX.test(b.email)) return next(erreur('Adresse e-mail invalide'));
  next();
};