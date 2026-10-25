require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

(async () => {
  const [email, mdp] = process.argv.slice(2);
  if (!email || !mdp) {
    console.log("Usage : node scripts/creerAdmin.js 'email' 'motdepasse'");
    process.exit(1);
  }
  if (mdp.length < 8) {
    console.log('Le mot de passe doit contenir au moins 8 caractères.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(mdp, 12);
  await pool.query(
    `INSERT INTO admins (email, mot_de_passe_hash) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET mot_de_passe_hash = EXCLUDED.mot_de_passe_hash`,
    [email.trim().toLowerCase(), hash]
  );
  console.log('Compte admin créé ou mis à jour :', email.trim().toLowerCase());
  await pool.end();
})().catch((err) => { console.error(err.message); process.exit(1); });