const crypto = require('crypto');
const pool = require('../config/db');

const DEVISE = 'XAF';

const baseUrl = () => (process.env.SEBPAY_BASE_URL || 'https://newapi.sebpay.bj/api/v1').replace(/\/$/, '');
const actif = () => process.env.SEBPAY_ACTIF === 'true';
// Les clés pk_test_ appartiennent au sandbox : les paiements sont marqués « simulés » dans l'admin
const modeTest = () => (process.env.SEBPAY_PUBLIC_KEY || '').startsWith('pk_test_');

// Vérifie X-SebPay-Signature : HMAC-SHA256 hexadécimal du corps BRUT, clé = clé secrète
function signatureValide(rawBody, signature) {
  const secret = process.env.SEBPAY_SECRET_KEY;
  if (!secret || !Buffer.isBuffer(rawBody) || typeof signature !== 'string') return false;
  const attendue = Buffer.from(crypto.createHmac('sha256', secret).update(rawBody).digest('hex'));
  const recue = Buffer.from(signature.trim().toLowerCase().replace(/^sha256=/, ''));
  return attendue.length === recue.length && crypto.timingSafeEqual(attendue, recue);
}

// Appel HTTP vers l'API Sebpay. Les réponses sont enveloppées : { success, data, message }.
// Lève une erreur si la réponse est inexploitable : on ne déduit JAMAIS « échoué » d'une panne.
async function appel(methode, chemin, corps) {
  const r = await fetch(baseUrl() + chemin, {
    method: methode,
    headers: {
      'X-Public-Key': process.env.SEBPAY_PUBLIC_KEY || '',
      'X-Secret-Key': process.env.SEBPAY_SECRET_KEY || '',
      'Content-Type': 'application/json',
    },
    body: corps ? JSON.stringify(corps) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  let j = null;
  try { j = await r.json(); } catch { /* corps non JSON */ }
  if (!r.ok || !j || j.success === false) {
    const code = j && j.errors && j.errors.code;
    const indice = j && j.errors && j.errors.api_url ? ` (serveur attendu : ${j.errors.api_url})` : '';
    const e = new Error(`Sebpay ${methode} ${chemin} : HTTP ${r.status} ${code || ''}${indice}`.trim());
    e.status = r.status;
    e.code = code;
    throw e;
  }
  return j.data !== undefined ? j.data : j;
}

// Lit une session par son id ou par notre external_reference.
// Sebpay revérifie auprès de l'opérateur si un paiement est en attente : cette lecture fait foi.
async function lireSession(idOuReference) {
  const s = await appel('GET', `/checkout/sessions/${encodeURIComponent(idOuReference)}`);
  if (!s || typeof s !== 'object' || s.transaction_status === undefined) {
    throw new Error('Réponse de session Sebpay inexploitable');
  }
  return s;
}

// reussi : approved. echoue : session expirée sans paiement en cours. null : on attend.
// Un webhook « rejected » ne clôt PAS la session (le client peut réessayer sur la même page).
function issue(session) {
  if (session.transaction_status === 'approved') return 'reussi';
  if (session.status === 'expired' && session.transaction_status !== 'pending') return 'echoue';
  return null;
}

// Enregistre un paiement « en_attente » puis crée la session de checkout Sebpay
async function creerPaiement({ type, montant, telephone, email, donnees }) {
  const { SEBPAY_PUBLIC_KEY, SEBPAY_SECRET_KEY, APP_URL } = process.env;
  if (!SEBPAY_PUBLIC_KEY || !SEBPAY_SECRET_KEY || !APP_URL) {
    const e = new Error('Configuration Sebpay incomplète sur le serveur');
    e.status = 500;
    throw e;
  }

  // Le préfixe SIMULE- fait apparaître ces paiements comme « simulés » dans l'admin
  const reference = (modeTest() ? 'SIMULE-TEST-' : '') + crypto.randomUUID();
  const p = await pool.query(
    `INSERT INTO paiements (type, montant, statut, reference_monetbil, telephone_payeur, donnees)
     VALUES ($1, $2, 'en_attente', $3, $4, $5) RETURNING id`,
    [type, montant, reference, telephone, JSON.stringify(donnees)]
  );

  const base = APP_URL.replace(/\/$/, '');
  const corps = {
    amount: montant,
    currency: DEVISE,
    // Chemin sans query string : Sebpay y ajoute ?checkout_session_id=… sans casser notre référence
    redirect_url: `${base}/api/sebpay/retour/${reference}`,
    external_reference: reference,
    callback_url: `${base}/api/sebpay/webhook`,
    metadata: { type, paiement_id: p.rows[0].id },
  };
  if (email) corps.customer_email = email;

  try {
    const s = await appel('POST', '/checkout/sessions', corps);
    if (!s || !s.checkout_url) throw new Error('Réponse Sebpay invalide (checkout_url manquant)');
    return { reference, payment_url: s.checkout_url };
  } catch (err) {
    console.error('Erreur Sebpay (création) :', err.message);
    await pool.query("UPDATE paiements SET statut = 'echoue' WHERE id = $1", [p.rows[0].id]);
    const e = new Error('Service de paiement indisponible, réessayez dans un instant');
    e.status = 502;
    throw e;
  }
}

module.exports = { DEVISE, actif, modeTest, signatureValide, lireSession, issue, creerPaiement };
