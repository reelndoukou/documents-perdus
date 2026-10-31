const pool = require('../config/db');
const sebpay = require('../services/sebpay');

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

// Validation atomique et idempotente. Un paiement « echoue » peut encore passer à « reussi »
// (un paiement lancé avant l'expiration peut être confirmé après), jamais l'inverse.
async function appliquer(paiement, resultat, transactionId) {
  const depuis = resultat === 'reussi' ? ['en_attente', 'echoue'] : ['en_attente'];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const maj = await client.query(
      `UPDATE paiements SET statut = $1, transaction_id = $2
       WHERE id = $3 AND statut = ANY($4) RETURNING *`,
      [resultat, transactionId ? String(transactionId) : null, paiement.id, depuis]
    );
    if (maj.rows.length > 0 && resultat === 'reussi') await finaliser(client, maj.rows[0]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Demande à Sebpay l'état réel de la session (source de vérité) et met à jour notre paiement.
// Appelée par le webhook ET par la page de retour : aucun des deux ne suffit seul.
async function reconcilier(paiement) {
  if (paiement.statut === 'reussi') return;

  const session = await sebpay.lireSession(paiement.reference_monetbil);
  const resultat = sebpay.issue(session);
  if (resultat === null) return;

  // Le montant payé doit couvrir le prix attendu, dans la bonne devise
  if (resultat === 'reussi') {
    if (session.currency !== sebpay.DEVISE || !(Number(session.amount) >= paiement.montant)) {
      console.error(`Paiement refusé : reçu ${session.amount} ${session.currency}, attendu ${paiement.montant} ${sebpay.DEVISE}`);
      return;
    }
  }
  await appliquer(paiement, resultat, session.transaction_id);
}

// POST /api/sebpay/webhook : appelé par Sebpay (corps JSON signé HMAC-SHA256)
exports.webhook = async (req, res, next) => {
  try {
    if (!sebpay.signatureValide(req.rawBody, req.get('X-SebPay-Signature'))) {
      console.warn('Webhook Sebpay refusé : signature invalide');
      return res.status(401).send('Signature invalide');
    }

    const ref = req.body && req.body.external_reference;
    if (typeof ref !== 'string' || ref.length > 100) return res.status(400).send('Référence invalide');

    const trouve = await pool.query('SELECT * FROM paiements WHERE reference_monetbil = $1', [ref]);
    if (trouve.rows.length === 0) {
      console.warn('Webhook Sebpay : référence inconnue', ref);
      return res.status(200).send('OK'); // inutile que Sebpay réessaie
    }

    // Ne jamais se fier au seul webhook : on confirme auprès de l'API avant de livrer.
    // En cas d'erreur (API injoignable) on répond 500 : Sebpay renverra le webhook.
    await reconcilier(trouve.rows[0]);
    res.status(200).send('OK');
  } catch (err) { next(err); }
};

// GET /api/sebpay/retour/:ref : le client revient de la page Sebpay (?checkout_session_id=… ignoré :
// le retour ne prouve rien). On le renvoie vers l'accueil, où le front interroge /statut.
exports.retour = (req, res) => {
  const ref = String(req.params.ref);
  if (!/^[A-Za-z0-9-]{1,80}$/.test(ref)) return res.redirect('/');
  res.redirect(`/?paiement=${encodeURIComponent(ref)}`);
};

// Évite qu'un front qui interroge toutes les 2 s déclenche un appel Sebpay à chaque fois
const derniereVerif = new Map();
const INTERVALLE_MS = 4000;

// GET /api/sebpay/statut/:ref : consulté par la page de retour (la référence est un UUID secret)
exports.statut = async (req, res, next) => {
  try {
    const ref = String(req.params.ref);
    if (ref.length > 80) return res.status(400).json({ erreur: 'Référence invalide' });

    let r = await pool.query('SELECT * FROM paiements WHERE reference_monetbil = $1', [ref]);
    if (r.rows.length === 0) return res.status(404).json({ erreur: 'Paiement introuvable' });

    // Paiement encore ouvert : on demande à Sebpay plutôt que d'attendre un webhook
    if (r.rows[0].statut === 'en_attente') {
      const maintenant = Date.now();
      if (maintenant - (derniereVerif.get(ref) || 0) >= INTERVALLE_MS) {
        derniereVerif.set(ref, maintenant);
        if (derniereVerif.size > 5000) {
          for (const [k, t] of derniereVerif) if (maintenant - t > 60000) derniereVerif.delete(k);
        }
        try {
          await reconcilier(r.rows[0]);
          r = await pool.query('SELECT * FROM paiements WHERE reference_monetbil = $1', [ref]);
        } catch (err) {
          console.error('Vérification Sebpay (statut) :', err.message); // on reste « en_attente »
        }
      }
    }

    const p = r.rows[0];
    const rep = { statut: p.statut, type: p.type };
    if (p.statut === 'reussi' && p.type === 'deblocage') {
      rep.token = (p.donnees || {}).token;
      rep.nom = (p.donnees || {}).proprietaire_nom;
    }
    res.json(rep);
  } catch (err) { next(err); }
};
