const pool = require('../config/db');
const { normaliserNom } = require('../utils/normaliser');

// POST /api/alertes : « Prévenez-moi quand mon document sera retrouvé »
// Paiement SIMULÉ (même principe que le déblocage : MonetBil viendra remplacer cette partie)
exports.creerAlerte = async (req, res, next) => {
  if (process.env.PAIEMENT_SIMULE !== 'true') {
    return res.status(501).json({ erreur: "Le paiement en ligne n'est pas encore activé" });
  }

  const client = await pool.connect();
  try {
    const b = req.body;

    const type = await client.query('SELECT id FROM types_document WHERE id = $1', [b.type_document_id]);
    if (type.rows.length === 0) return res.status(400).json({ erreur: 'Type de document inexistant' });

    const param = await client.query("SELECT valeur FROM parametres WHERE cle = 'prix_alerte'");
    const montant = parseInt(param.rows[0].valeur);

    await client.query('BEGIN');

    const paiement = await client.query(
      `INSERT INTO paiements (type, montant, statut, reference_monetbil, telephone_payeur)
       VALUES ('alerte', $1, 'reussi', $2, $3) RETURNING id`,
      [montant, `SIMULE-${Date.now()}`, b.telephone.trim()]
    );

    await client.query(
      `INSERT INTO alertes (nom_complet, nom_recherche, type_document_id, ville, email, telephone, paiement_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [b.nom_complet.trim(), normaliserNom(b.nom_complet), b.type_document_id, b.ville.trim(),
       b.email && b.email.trim() ? b.email.trim() : null, b.telephone.trim(), paiement.rows[0].id]
    );

    await client.query('COMMIT');
    res.status(201).json({
      message: 'Alerte activée. Notre équipe vous préviendra par mail et par appel dès que votre document sera retrouvé.',
      montant_paye: montant,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};