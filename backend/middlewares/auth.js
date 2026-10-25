const jwt = require('jsonwebtoken');

// Protège les routes admin : exige un jeton valide dans l'en-tête Authorization
module.exports = (req, res, next) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    const e = new Error('JWT_SECRET manquant sur le serveur');
    e.status = 500;
    return next(e);
  }
  const entete = req.headers.authorization || '';
  const token = entete.startsWith('Bearer ') ? entete.slice(7) : null;
  if (!token) return res.status(401).json({ erreur: 'Connexion requise' });

  try {
    req.admin = jwt.verify(token, secret);
    next();
  } catch {
    res.status(401).json({ erreur: 'Session expirée, reconnectez-vous' });
  }
};