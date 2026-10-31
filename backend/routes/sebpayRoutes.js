const express = require('express');
const router = express.Router();
const c = require('../controllers/sebpayController');

router.post('/webhook', c.webhook);
router.get('/retour/:ref', c.retour);
router.get('/statut/:ref', c.statut);

module.exports = router;
