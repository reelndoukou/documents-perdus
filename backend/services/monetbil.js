const crypto = require('crypto');
const pool = require('../config/db');

const WIDGET = 'https://api.monetbil.com/widget/v2.1/';
const CHECK = 'https://api.monetbil.com/payment/v1/checkPayment';

const actif = () => process.env.MONETBIL_ACTIF === 'true';
const modeTest = () => process.env.MONETBIL_TEST_MODE === 'true';

// Même algorithme que le SDK officiel : tri des clés, md5(secret + valeurs)
function signer(secret, params) {
  const valeurs = Object.keys(params).sort().map((k) => params[k]).join('');
  return crypto.createHash('md5').update(secret + valeurs).digest('hex');
}

function signatureValide(params) {
  const { sign, ...reste } = params;
  const secret = process.env.MONETBIL_SERVICE_SECRET;
  if (typeof sign !== 'string' || !secret) return false;
  if (Object.values(reste).some((v) => typeof v !== 'string')) return false;
  const attendue = Buffer.from(signer(secret, reste));
  const recue = Buffer.from(sign.toLowerCase());
  return attendue.length === recue.length && crypto.timingSafeEqual(attendue, recue);
}

// Confirme le statut auprès de MonetBil. Lève une erreur si la réponse est inexploitable :
// on ne déduit JAMAIS « échoué » d'une panne réseau.
async function verifierTransaction(transactionId) {
  const r = await fetch(CHECK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ paymentId: String(transactionId) }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json();
  if (!j || !j.transaction || j.transaction.status === undefined) {
    throw new Error('Réponse checkPayment inexploitable');
  }
  return Number(j.transaction.status);
}

// 1 = réussi, 0 = échoué, -1 = annulé ; 7/8/9 = équivalents du mode test
function issue(statut) {
  if (statut === 1) return 'reussi';
  if (statut === 0 || statut === -1) return 'echoue';
  if (modeTest()) {
    if (statut === 7) return 'reussi';
    if (statut === 8 || statut === 9) return 'echoue';
  }
  return null; // statut inconnu : on attend
}

// Enregistre un paiement « en_attente » puis demande le lien de paiement à MonetBil
async function creerPaiement({ type, montant, telephone, email, donnees }) {
  const { MONETBIL_SERVICE_KEY, APP_URL, MONETBIL_NOTIFY_SECRET } = process.env;
  if (!MONETBIL_SERVICE_KEY || !APP_URL || !MONETBIL_NOTIFY_SECRET) {
    const e = new Error('Configuration MonetBil incomplète sur le serveur');
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
  const corps = new URLSearchParams({
    amount: String(montant),
    currency: 'XAF',
    country: 'CG',
    locale: 'fr',
    item_ref: type,
    payment_ref: reference,
    return_url: `${base}/?paiement=${reference}`,
    notify_url: `${base}/api/monetbil/notify/${MONETBIL_NOTIFY_SECRET}`,
  });
  if (email) corps.set('email', email);

  try {
    const r = await fetch(WIDGET + MONETBIL_SERVICE_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: corps,
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json();
    if (!j || !j.success || !j.payment_url) throw new Error('Réponse MonetBil invalide');
    return { reference, payment_url: j.payment_url };
  } catch (err) {
    console.error('Erreur MonetBil (création) :', err.message);
    await pool.query("UPDATE paiements SET statut = 'echoue' WHERE id = $1", [p.rows[0].id]);
    const e = new Error('Service de paiement indisponible, réessayez dans un instant');
    e.status = 502;
    throw e;
  }
}

module.exports = { actif, modeTest, signatureValide, verifierTransaction, issue, creerPaiement };