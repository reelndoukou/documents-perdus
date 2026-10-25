const express = require('express');
const router = express.Router();
const c = require('../controllers/declarationsController');
const deblocages = require('../controllers/deblocagesController');
const upload = require('../middlewares/upload');
const { validerDeclaration, validerDeblocage, validerId } = require('../middlewares/validate');

router.post('/', upload.array('images', 2), validerDeclaration, c.createDeclaration);
router.get('/recherche', c.rechercher);
router.post('/:id/debloquer', validerId, validerDeblocage, deblocages.debloquer);

module.exports = router;