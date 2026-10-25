// Limite les tentatives de connexion échouées : 5 par IP toutes les 15 minutes
const tentatives = new Map();
const FENETRE = 15 * 60 * 1000;
const MAX = 5;

module.exports = (req, res, next) => {
  const ip = req.ip;
  const maintenant = Date.now();

  const t = tentatives.get(ip);
  if (t && maintenant - t.debut > FENETRE) tentatives.delete(ip);

  const courant = tentatives.get(ip);
  if (courant && courant.n >= MAX) {
    return res.status(429).json({ erreur: 'Trop de tentatives. Réessayez dans 15 minutes.' });
  }

  res.on('finish', () => {
    if (res.statusCode === 401) {
      const c = tentatives.get(ip) || { n: 0, debut: Date.now() };
      c.n += 1;
      tentatives.set(ip, c);
    } else if (res.statusCode === 200) {
      tentatives.delete(ip);
    }
  });
  next();
};