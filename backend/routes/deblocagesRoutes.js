const express = require('express');
const router = express.Router();
const c = require('../controllers/deblocagesController');

router.get('/:token', c.consulter);
router.put('/:token/restitue', c.confirmerRestitution);
router.put('/:token/signaler', c.signaler);

module.exports = router;