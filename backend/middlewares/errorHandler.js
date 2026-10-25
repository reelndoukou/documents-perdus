const notFound = (req, res, next) => {
  res.status(404).json({ erreur: `Route introuvable : ${req.method} ${req.originalUrl}` });
};

const errorHandler = (err, req, res, next) => {
  console.error('ERREUR :', err.message);

  // Erreurs d'upload (multer)
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ erreur: 'Image trop lourde (5 Mo maximum par photo)' });
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ erreur: 'Deux photos maximum, envoyées dans le champ "images"' });
  }

  // Erreurs PostgreSQL courantes
  if (err.code === '23503') return res.status(409).json({ erreur: 'Opération impossible : donnée liée à une autre.' });
  if (err.code === '23505') return res.status(409).json({ erreur: 'Cette valeur existe déjà.' });
  if (err.code === '23514') return res.status(400).json({ erreur: 'Valeur invalide (règle non respectée).' });
  if (err.code === '22P02') return res.status(400).json({ erreur: 'Format de donnée invalide.' });

  res.status(err.status || 500).json({ erreur: err.message || 'Erreur serveur interne' });
};

module.exports = { notFound, errorHandler };