const express = require('express');
const router = express.Router();
const c = require('../controllers/monetbilController');

router.all('/notify/:secret', c.notify);
router.get('/statut/:ref', c.statut);

module.exports = router;