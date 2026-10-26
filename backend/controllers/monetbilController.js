const crypto = require('crypto');
const pool = require('../config/db');
const monetbil = require('../services/monetbil');

function egal(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Une fois le paiement confirmé, on crée ce que le client a acheté
async function finaliser(client, p) {
  const d = p.donnees || {};
  if (p.type === 'deblocage') {
    await client.query(
      `INSERT INTO deblocages (declaration_id, paiement_id, proprietaire_nom, proprietaire_telephone, token)
       VALUES ($1, $2, $3, $4, $5)`,
      [d.declaration_id, p.id, d.proprietaire_nom, d.proprietaire_telephone, d.token]
    );
  } else if (p.type === 'alerte') {
    await client.query(
      `INSERT INTO alertes (nom_complet, nom_recherche, type_document_id, ville, email, telephone, paiement_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [d.nom_complet, d.nom_recherche, d.type_document_id, d.ville, d.email || null, d.telephone, p.id]
    );
  }
}

// GET ou POST /api/monetbil/notify/:secret : appelé par MonetBil
exports.notify = async (req, res, next) => {
  try {
    if (!egal(req.params.secret, process.env.MONETBIL_NOTIFY_SECRET || '')) {
      return res.status(404).json({ erreur: 'Introuvable' });
    }

    const params = { ...req.query, ...req.body };

    // 1. La notification vient bien de MonetBil
    if (!monetbil.signatureValide(params)) {
      console.warn('Notification MonetBil refusée : signature invalide');
      return res.status(400).send('Signature invalide');
    }
    if (params.service !== process.env.MONETBIL_SERVICE_KEY) {
      return res.status(400).send('Service inconnu');
    }

    // 2. Le paiement existe chez nous et n'est pas déjà traité
    const trouve = await pool.query('SELECT * FROM paiements WHERE reference_monetbil = $1', [params.payment_ref]);
    if (trouve.rows.length === 0) return res.status(404).send('Paiement inconnu');
    if (trouve.rows[0].statut !== 'en_attente') return res.status(200).send('OK');
    const attendu = trouve.rows[0];

    // 3. MonetBil confirme le statut (appel serveur à serveur)
    const resultat = monetbil.issue(await monetbil.verifierTransaction(params.transaction_id));
    if (resultat === null) return res.status(200).send('OK');

    // 4. Le montant payé doit couvrir le prix attendu
    if (resultat === 'reussi' && !(Number(params.amount) >= attendu.montant)) {
      console.error(`Montant insuffisant : reçu ${params.amount}, attendu ${attendu.montant}`);
      return res.status(200).send('OK');
    }

    // 5. Validation atomique et idempotente
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const maj = await client.query(
        `UPDATE paiements SET statut = $1, transaction_id = $2
         WHERE id = $3 AND statut = 'en_attente' RETURNING *`,
        [resultat, String(params.transaction_id), attendu.id]
      );
      if (maj.rows.length > 0 && resultat === 'reussi') await finaliser(client, maj.rows[0]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.status(200).send('OK');
  } catch (err) { next(err); }
};

// GET /api/monetbil/statut/:ref : consulté par la page de retour (la référence est un UUID secret)
exports.statut = async (req, res, next) => {
  try {
    const ref = String(req.params.ref);
    if (ref.length > 80) return res.status(400).json({ erreur: 'Référence invalide' });

    const r = await pool.query('SELECT statut, type, donnees FROM paiements WHERE reference_monetbil = $1', [ref]);
    if (r.rows.length === 0) return res.status(404).json({ erreur: 'Paiement introuvable' });

    const p = r.rows[0];
    const rep = { statut: p.statut, type: p.type };
    if (p.statut === 'reussi' && p.type === 'deblocage') {
      rep.token = (p.donnees || {}).token;
      rep.nom = (p.donnees || {}).proprietaire_nom;
    }
    res.json(rep);
  } catch (err) { next(err); }
};