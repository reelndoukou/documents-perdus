const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const stockage = require('../services/stockage');

// Hash factice : on fait toujours un bcrypt.compare, même si l'e-mail n'existe pas,
// pour qu'on ne puisse pas deviner quels e-mails existent d'après le temps de réponse
const HASH_BIDON = bcrypt.hashSync('mot-de-passe-bidon', 10);

// Une alerte "correspond" quand une déclaration publiée a le même nom, type et ville
const CORRESPOND = `d.statut = 'publie'
  AND d.nom_recherche = a.nom_recherche
  AND d.type_document_id = a.type_document_id
  AND LOWER(TRIM(d.ville)) = LOWER(TRIM(a.ville))`;

const STATUTS_DECL = ['en_attente', 'publie', 'restitue', 'rejete'];

// ---------- CONNEXION ----------
exports.login = async (req, res, next) => {
  try {
    const { email, mot_de_passe } = req.body;
    if (!email || !mot_de_passe) return res.status(400).json({ erreur: 'E-mail et mot de passe requis' });

    const r = await pool.query('SELECT * FROM admins WHERE LOWER(email) = LOWER($1)', [String(email).trim()]);
    const admin = r.rows[0];
    const ok = await bcrypt.compare(String(mot_de_passe), admin ? admin.mot_de_passe_hash : HASH_BIDON);
    if (!admin || !ok) return res.status(401).json({ erreur: 'Identifiants incorrects' });

    const token = jwt.sign({ id: admin.id, email: admin.email }, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, email: admin.email });
  } catch (err) { next(err); }
};

// ---------- TABLEAU DE BORD : REVENUS + CHIFFRES CLÉS ----------
exports.stats = async (req, res, next) => {
  try {
    const [tot, parType, parMois, parJour, decl, sign, alActives, alTraiter] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS nb,
                COALESCE(SUM(montant), 0)::int AS total,
                COALESCE(SUM(montant) FILTER (WHERE COALESCE(reference_monetbil, '') NOT LIKE 'SIMULE-%'), 0)::int AS reel,
                COALESCE(SUM(montant) FILTER (WHERE COALESCE(reference_monetbil, '') LIKE 'SIMULE-%'), 0)::int AS simule
         FROM paiements WHERE statut = 'reussi'`
      ),
      pool.query(
        `SELECT type, COUNT(*)::int AS nb, COALESCE(SUM(montant), 0)::int AS total
         FROM paiements WHERE statut = 'reussi' GROUP BY type`
      ),
      pool.query(
        `SELECT to_char(date_trunc('month', date_creation), 'YYYY-MM') AS mois,
                COUNT(*)::int AS nb, SUM(montant)::int AS total
         FROM paiements
         WHERE statut = 'reussi' AND date_creation >= date_trunc('month', NOW()) - INTERVAL '11 months'
         GROUP BY 1 ORDER BY 1 DESC`
      ),
      pool.query(
        `SELECT to_char(j, 'YYYY-MM-DD') AS jour, COALESCE(SUM(p.montant), 0)::int AS total
         FROM generate_series((CURRENT_DATE - 29)::timestamp, CURRENT_DATE::timestamp, INTERVAL '1 day') AS j
         LEFT JOIN paiements p ON p.statut = 'reussi' AND p.date_creation::date = j::date
         GROUP BY j ORDER BY j`
      ),
      pool.query('SELECT statut, COUNT(*)::int AS nb FROM declarations GROUP BY statut'),
      pool.query(
        `SELECT COUNT(*)::int AS nb FROM deblocages b
         JOIN declarations d ON d.id = b.declaration_id
         WHERE b.statut = 'signale' AND d.statut <> 'rejete'`
      ),
      pool.query("SELECT COUNT(*)::int AS nb FROM alertes WHERE statut = 'active'"),
      pool.query(
        `SELECT COUNT(*)::int AS nb FROM alertes a
         WHERE a.statut = 'active'
           AND EXISTS (SELECT 1 FROM declarations d WHERE ${CORRESPOND})`
      ),
    ]);

    res.json({
      paiements: tot.rows[0],
      par_type: parType.rows,
      par_mois: parMois.rows,
      par_jour: parJour.rows,
      declarations: decl.rows,
      signalements_a_traiter: sign.rows[0].nb,
      alertes_actives: alActives.rows[0].nb,
      alertes_a_traiter: alTraiter.rows[0].nb,
    });
  } catch (err) { next(err); }
};

// ---------- DÉCLARATIONS ----------
exports.listeDeclarations = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = 15;
    const conditions = [];
    const valeurs = [];
    let i = 1;

    if (STATUTS_DECL.includes(req.query.statut)) {
      conditions.push(`d.statut = $${i++}`);
      valeurs.push(req.query.statut);
    }
    if (req.query.search && req.query.search.trim()) {
      conditions.push(
        `(d.nom_complet ILIKE $${i} OR d.declarant_nom ILIKE $${i} OR d.declarant_telephone ILIKE $${i} OR d.ville ILIKE $${i})`
      );
      valeurs.push(`%${req.query.search.trim()}%`);
      i++;
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const total = await pool.query(`SELECT COUNT(*)::int AS nb FROM declarations d ${where}`, valeurs);
    const result = await pool.query(
      `SELECT d.id, d.nom_complet, d.ville, d.mode, d.anonyme, d.statut, d.date_creation,
              d.declarant_nom, d.declarant_telephone, t.libelle AS type_document,
              (SELECT COUNT(*)::int FROM deblocages b WHERE b.declaration_id = d.id) AS nb_deblocages
       FROM declarations d
       JOIN types_document t ON t.id = d.type_document_id
       ${where}
       ORDER BY d.date_creation DESC
       LIMIT $${i} OFFSET $${i + 1}`,
      [...valeurs, limit, (page - 1) * limit]
    );

    res.json({
      donnees: result.rows,
      pagination: { page, total: total.rows[0].nb, totalPages: Math.ceil(total.rows[0].nb / limit) || 1 },
    });
  } catch (err) { next(err); }
};

exports.detailDeclaration = async (req, res, next) => {
  try {
    const d = await pool.query(
      `SELECT d.*, t.libelle AS type_document
       FROM declarations d JOIN types_document t ON t.id = d.type_document_id
       WHERE d.id = $1`,
      [req.params.id]
    );
    if (d.rows.length === 0) return res.status(404).json({ erreur: 'Déclaration introuvable' });

    const [images, deblocages] = await Promise.all([
      pool.query('SELECT url, ordre FROM images_declaration WHERE declaration_id = $1 ORDER BY ordre', [req.params.id]),
      pool.query(
        `SELECT b.id, b.proprietaire_nom, b.proprietaire_telephone, b.statut, b.date_creation, p.montant
         FROM deblocages b JOIN paiements p ON p.id = b.paiement_id
         WHERE b.declaration_id = $1 ORDER BY b.date_creation DESC`,
        [req.params.id]
      ),
    ]);

      res.json({
      declaration: d.rows[0],
      images: images.rows.map((i) => ({ ...i, url: stockage.urlOriginale(i.url) })),
      deblocages: deblocages.rows,
    });
  } catch (err) { next(err); }
};

// PUT /api/admin/declarations/:id/statut  { statut: 'publie' | 'en_attente' | 'rejete' }
exports.changerStatutDeclaration = async (req, res, next) => {
  try {
    const { statut } = req.body;
    if (!['publie', 'en_attente', 'rejete'].includes(statut)) {
      return res.status(400).json({ erreur: 'Statut invalide' });
    }

    const r = await pool.query(
      `UPDATE declarations SET statut = $1 WHERE id = $2 AND statut <> 'restitue' RETURNING id, statut`,
      [statut, req.params.id]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ erreur: 'Déclaration introuvable ou déjà restituée' });
    }

    // Si on publie : combien d'alertes actives attendent ce document ?
    let correspondantes = 0;
    if (statut === 'publie') {
      const c = await pool.query(
        `SELECT COUNT(*)::int AS nb FROM alertes a JOIN declarations d ON d.id = $1
         WHERE a.statut = 'active' AND ${CORRESPOND}`,
        [r.rows[0].id]
      );
      correspondantes = c.rows[0].nb;
    }

    res.json({ message: 'Statut mis à jour', statut, alertes_correspondantes: correspondantes });
  } catch (err) { next(err); }
};

// ---------- SIGNALEMENTS ----------
exports.listeDeblocages = async (req, res, next) => {
  try {
    const statut = ['debloque', 'restitue', 'signale'].includes(req.query.statut) ? req.query.statut : null;
    const result = await pool.query(
      `SELECT b.id, b.statut, b.proprietaire_nom, b.proprietaire_telephone, b.date_creation,
              d.id AS declaration_id, d.nom_complet, d.declarant_nom, d.declarant_telephone,
              d.statut AS statut_declaration, t.libelle AS type_document, p.montant
       FROM deblocages b
       JOIN declarations d ON d.id = b.declaration_id
       JOIN types_document t ON t.id = d.type_document_id
       JOIN paiements p ON p.id = b.paiement_id
       WHERE ($1::text IS NULL OR b.statut = $1)
       ORDER BY b.date_creation DESC LIMIT 100`,
      [statut]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
};

// PUT /api/admin/deblocages/:id/resoudre  { decision: 'fraude' | 'ecarter' }
exports.resoudreSignalement = async (req, res, next) => {
  const { decision } = req.body;
  if (!['fraude', 'ecarter'].includes(decision)) {
    return res.status(400).json({ erreur: 'Décision invalide' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const b = await client.query(
      "SELECT declaration_id FROM deblocages WHERE id = $1 AND statut = 'signale' FOR UPDATE",
      [req.params.id]
    );
    if (b.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erreur: 'Signalement introuvable ou déjà traité' });
    }
    const declId = b.rows[0].declaration_id;

    if (decision === 'fraude') {
      await client.query("UPDATE declarations SET statut = 'rejete' WHERE id = $1 AND statut <> 'restitue'", [declId]);
    } else {
      await client.query("UPDATE declarations SET statut = 'publie' WHERE id = $1 AND statut = 'en_attente'", [declId]);
      await client.query("UPDATE deblocages SET statut = 'debloque' WHERE id = $1", [req.params.id]);
    }

    await client.query('COMMIT');
    res.json({
      message: decision === 'fraude'
        ? 'Fraude confirmée : la déclaration est rejetée'
        : 'Signalement écarté : la déclaration est de nouveau publiée',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// ---------- ALERTES PAYANTES ----------
exports.listeAlertes = async (req, res, next) => {
  try {
    const statut = ['active', 'notifiee'].includes(req.query.statut) ? req.query.statut : null;
    const result = await pool.query(
      `SELECT a.id, a.nom_complet, a.ville, a.email, a.telephone, a.statut, a.date_creation,
              t.libelle AS type_document,
              COALESCE((
                SELECT json_agg(json_build_object('id', d.id, 'nom_complet', d.nom_complet, 'ville', d.ville))
                FROM declarations d WHERE ${CORRESPOND}
              ), '[]') AS correspondances
       FROM alertes a
       JOIN types_document t ON t.id = a.type_document_id
       WHERE ($1::text IS NULL OR a.statut = $1)
       ORDER BY a.date_creation DESC LIMIT 200`,
      [statut]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
};

exports.alerteNotifiee = async (req, res, next) => {
  try {
    const r = await pool.query(
      "UPDATE alertes SET statut = 'notifiee' WHERE id = $1 AND statut = 'active' RETURNING id",
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ erreur: 'Alerte introuvable ou déjà traitée' });
    res.json({ message: 'Alerte marquée comme traitée' });
  } catch (err) { next(err); }
};

// ---------- PAIEMENTS ----------
exports.listePaiements = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = 20;
    const type = ['deblocage', 'alerte'].includes(req.query.type) ? req.query.type : null;

    const total = await pool.query(
      "SELECT COUNT(*)::int AS nb FROM paiements WHERE ($1::text IS NULL OR type = $1)",
      [type]
    );
    const result = await pool.query(
      `SELECT id, type, montant, statut, reference_monetbil, telephone_payeur, date_creation,
              (COALESCE(reference_monetbil, '') LIKE 'SIMULE-%') AS simule
       FROM paiements WHERE ($1::text IS NULL OR type = $1)
       ORDER BY date_creation DESC LIMIT $2 OFFSET $3`,
      [type, limit, (page - 1) * limit]
    );

    res.json({
      donnees: result.rows,
      pagination: { page, total: total.rows[0].nb, totalPages: Math.ceil(total.rows[0].nb / limit) || 1 },
    });
  } catch (err) { next(err); }
};