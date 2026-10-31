require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const pool = require('./config/db');
const sebpay = require('./services/sebpay');

const logger = require('./middlewares/logger');
const { notFound, errorHandler } = require('./middlewares/errorHandler');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 4000;

app.use(cors());
// On garde le corps brut : Sebpay signe les octets exacts du webhook (HMAC-SHA256)
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: false }));
app.use(logger);

// Photos envoyées + frontend (même serveur, même port)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.get('/api/types-document', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM types_document ORDER BY id');
    res.json(result.rows);
  } catch (err) { next(err); }
});

// Prix et délais publics, pour les afficher dans l'interface
app.get('/api/parametres', async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT cle, valeur FROM parametres
       WHERE cle IN ('commission_deblocage','prix_alerte','indemnite_conseillee_min','delai_reessai_heures')`
    );
      res.json({
      ...Object.fromEntries(r.rows.map((x) => [x.cle, parseInt(x.valeur)])),
      mode_paiement: sebpay.actif() ? 'sebpay' : 'simule',
    });
  } catch (err) { next(err); }
});

app.use('/api/declarations', require('./routes/declarationsRoutes'));
app.use('/api/deblocages', require('./routes/deblocagesRoutes'));
app.use('/api/alertes', require('./routes/alertesRoutes'));
const sebpayRoutes = require('./routes/sebpayRoutes');
app.use('/api/sebpay', sebpayRoutes);
// Alias temporaire : l'ancien front appelle encore /api/monetbil/statut/:ref.
// À supprimer une fois le front passé sur /api/sebpay.
app.use('/api/monetbil', sebpayRoutes);

app.use('/api/admin', require('./routes/adminRoutes'));
app.use(notFound);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});
