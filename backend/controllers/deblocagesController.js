const pool = require('../config/db');

const AVERTISSEMENT =
  "Donnez-vous rendez-vous dans un lieu public, à la vue de tous. " +
  "Vérifiez que le document est bien le vôtre avant de le récupérer, puis versez l'indemnité de déplacement au déclarant. " +
  "Le déclarant, de son côté, doit s'assurer que vous êtes bien le propriétaire avant de remettre le document.";

// Construit les informations révélées après paiement (uniquement celles qui existent)
function infosRevelees(d) {
  const contact = {};
  if (d.declarant_nom) contact.nom = d.declarant_nom;
  if (d.declarant_telephone) contact.telephone = d.declarant_telephone;
  if (d.declarant_email) contact.email = d.declarant_email;
  if (d.declarant_ville) contact.ville = d.declarant_ville;
  if (d.declarant_quartier) contact.quartier = d.declarant_quartier;

  return {
    contact: Object.keys(contact).length ? contact : null,
    lieu_depot: d.lieu_depot_description || null,
    avertissement: AVERTISSEMENT,
  };
}

// POST /api/declarations/:id/debloquer
// Paiement SIMULÉ. Avec MonetBil : on créera le paiement "en_attente", puis la
// notification de MonetBil le passera à "reussi". La lecture (consulter) ne
// change pas, car elle exige déjà un paiement "reussi".
exports.debloquer = async (req, res, next) => {
  if (process.env.PAIEMENT_SIMULE !== 'true') {
    return res.status(501).json({ erreur: "Le paiement en ligne n'est pas encore activé" });
  }

  const client = await pool.connect();
  try {
    const { proprietaire_nom, proprietaire_telephone } = req.body;

    const decl = await client.query(
      `SELECT d.*, t.libelle AS type_document
       FROM declarations d JOIN types_document t ON t.id = d.type_document_id
       WHERE d.id = $1 AND d.statut = 'publie'`,
      [req.params.id]
    );
    if (decl.rows.length === 0) {
      return res.status(404).json({ erreur: 'Document introuvable ou plus disponible' });
    }

    const param = await client.query("SELECT valeur FROM parametres WHERE cle = 'commission_deblocage'");
    const montant = parseInt(param.rows[0].valeur);

    await client.query('BEGIN');

    const paiement = await client.query(
      `INSERT INTO paiements (type, montant, statut, reference_monetbil, telephone_payeur)
       VALUES ('deblocage', $1, 'reussi', $2, $3) RETURNING id`,
      [montant, `SIMULE-${Date.now()}`, proprietaire_telephone.trim()]
    );

    const deblocage = await client.query(
      `INSERT INTO deblocages (declaration_id, paiement_id, proprietaire_nom, proprietaire_telephone)
       VALUES ($1, $2, $3, $4) RETURNING token`,
      [decl.rows[0].id, paiement.rows[0].id, proprietaire_nom.trim(), proprietaire_telephone.trim()]
    );

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Paiement reçu. Voici les informations pour récupérer votre document.',
      token: deblocage.rows[0].token,
      montant_paye: montant,
      ...infosRevelees(decl.rows[0]),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// GET /api/deblocages/:token : revoir ses informations (jeton + paiement réussi requis)
exports.consulter = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT b.statut AS statut_deblocage, d.*, t.libelle AS type_document
       FROM deblocages b
       JOIN paiements p ON p.id = b.paiement_id AND p.statut = 'reussi'
       JOIN declarations d ON d.id = b.declaration_id
       JOIN types_document t ON t.id = d.type_document_id
       WHERE b.token = $1`,
      [req.params.token]
    );
    if (result.rows.length === 0) return res.status(404).json({ erreur: 'Accès introuvable' });

    const d = result.rows[0];
    res.json({
      statut: d.statut_deblocage,
      document: { nom_complet: d.nom_complet, type_document: d.type_document, ville: d.ville },
      ...infosRevelees(d),
    });
  } catch (err) { next(err); }
};

// PUT /api/deblocages/:token/restitue : « J'ai récupéré mon document »
exports.confirmerRestitution = async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const b = await client.query(
      `UPDATE deblocages SET statut = 'restitue'
       WHERE token = $1 AND statut = 'debloque'
         AND paiement_id IN (SELECT id FROM paiements WHERE statut = 'reussi')
       RETURNING declaration_id`,
      [req.params.token]
    );
    if (b.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erreur: 'Accès introuvable ou déjà traité' });
    }
    // Le document n'apparaît plus dans les recherches
    await client.query("UPDATE declarations SET statut = 'restitue' WHERE id = $1", [b.rows[0].declaration_id]);
    await client.query('COMMIT');
    res.json({ message: 'Merci ! Le document est marqué comme restitué.' });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// PUT /api/deblocages/:token/signaler : « Ce n'est pas le bon document / fausse déclaration »
exports.signaler = async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const b = await client.query(
      `UPDATE deblocages SET statut = 'signale'
       WHERE token = $1 AND statut = 'debloque'
         AND paiement_id IN (SELECT id FROM paiements WHERE statut = 'reussi')
       RETURNING declaration_id`,
      [req.params.token]
    );
    if (b.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erreur: 'Accès introuvable ou déjà traité' });
    }
    // La déclaration est retirée des recherches en attendant l'examen de l'équipe
    await client.query("UPDATE declarations SET statut = 'en_attente' WHERE id = $1", [b.rows[0].declaration_id]);
    await client.query('COMMIT');
    res.json({ message: 'Signalement reçu. Notre équipe va examiner cette déclaration.' });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};