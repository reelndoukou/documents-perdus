const express = require('express');
const router = express.Router();
const c = require('../controllers/alertesController');
const { validerAlerte } = require('../middlewares/validate');

router.post('/', validerAlerte, c.creerAlerte);

module.exports = router;