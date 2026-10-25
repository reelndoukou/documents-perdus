const pool = require('../config/db');
const { normaliserNom } = require('../utils/normaliser');
const { supprimerFichiers } = require('../utils/fichiers');
const stockage = require('../services/stockage');

// POST /api/declarations  (multipart/form-data)
exports.createDeclaration = async (req, res, next) => {
  const client = await pool.connect();
  const refs = [];
  try {
    const b = req.body;
    const anonyme = b.anonyme === 'true';
    const statut = process.env.AUTO_PUBLISH === 'true' ? 'publie' : 'en_attente';
    const vide = (v) => (v && v.trim() !== '' ? v.trim() : null);

    const coord = anonyme
      ? [null, null, null, null, null]
      : [vide(b.declarant_nom), vide(b.declarant_telephone), vide(b.declarant_email),
         vide(b.declarant_ville), vide(b.declarant_quartier)];

    const type = await client.query('SELECT id FROM types_document WHERE id = $1', [b.type_document_id]);
    if (type.rows.length === 0) {
      supprimerFichiers(req.files);
      return res.status(400).json({ erreur: 'Type de document inexistant' });
    }

    // Les photos partent vers Cloudinary AVANT la transaction en base
    for (const f of req.files) refs.push(await stockage.enregistrer(f));

    await client.query('BEGIN');

    const decl = await client.query(
      `INSERT INTO declarations
         (type_document_id, nom_complet, nom_recherche, ville, mode, anonyme,
          lieu_depot_description, declarant_nom, declarant_telephone, declarant_email,
          declarant_ville, declarant_quartier, statut)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, statut`,
      [b.type_document_id, b.nom_complet.trim(), normaliserNom(b.nom_complet), b.ville.trim(),
       b.mode, anonyme, vide(b.lieu_depot_description), ...coord, statut]
    );

    for (let i = 0; i < refs.length; i++) {
      await client.query(
        'INSERT INTO images_declaration (declaration_id, url, ordre) VALUES ($1, $2, $3)',
        [decl.rows[0].id, refs[i], i + 1]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({
      message: statut === 'publie'
        ? 'Document déclaré avec succès. Merci pour votre geste !'
        : 'Déclaration reçue. Elle sera visible après validation par notre équipe.',
      id: decl.rows[0].id,
      statut: decl.rows[0].statut,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    await stockage.supprimer(refs);
    supprimerFichiers(req.files);
    next(err);
  } finally {
    client.release();
  }
};

// GET /api/declarations/recherche?nom=...&type_document_id=...&ville=...
// RÈGLE DE CONFIDENTIALITÉ : la réponse ne contient JAMAIS de coordonnées
// ni de lieu de dépôt. Ces informations ne sortent qu'après le paiement.
exports.rechercher = async (req, res, next) => {
  try {
    const { nom, type_document_id, ville } = req.query;

    if (!nom || !nom.trim() || !ville || !ville.trim() || !type_document_id || isNaN(parseInt(type_document_id))) {
      return res.status(400).json({ erreur: 'Le nom complet, le type de document et la ville sont obligatoires' });
    }

    const result = await pool.query(
      `SELECT d.id, d.nom_complet, d.ville, d.mode, d.date_creation,
              t.libelle AS type_document,
              COALESCE(json_agg(i.url ORDER BY i.ordre) FILTER (WHERE i.id IS NOT NULL), '[]') AS images
       FROM declarations d
       JOIN types_document t ON t.id = d.type_document_id
       LEFT JOIN images_declaration i ON i.declaration_id = d.id
       WHERE d.statut = 'publie'
         AND d.nom_recherche = $1
         AND d.type_document_id = $2
         AND LOWER(TRIM(d.ville)) = LOWER(TRIM($3))
       GROUP BY d.id, t.libelle
       ORDER BY d.date_creation DESC`,
      [normaliserNom(nom), parseInt(type_document_id), ville]
    );

      if (result.rows.length > 0) {
      return res.json({
      trouve: true,
      resultats: result.rows.map((r) => ({ ...r, images: r.images.map(stockage.urlPublique) })),
      });
    }

    // Rien trouvé : on renvoie le message de réessai et l'offre d'alerte payante
    const params = await pool.query(
      "SELECT cle, valeur FROM parametres WHERE cle IN ('delai_reessai_heures', 'prix_alerte')"
    );
    const p = Object.fromEntries(params.rows.map((r) => [r.cle, r.valeur]));

    res.json({
      trouve: false,
      resultats: [],
      message: `Votre document n'a pas encore été déclaré. Réessayez dans ${p.delai_reessai_heures} heures, ou activez l'alerte pour être prévenu dès qu'il sera retrouvé.`,
      alerte: { disponible: true, prix: parseInt(p.prix_alerte) },
    });
  } catch (err) { next(err); }
};