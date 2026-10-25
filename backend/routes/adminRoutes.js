const express = require('express');
const router = express.Router();
const c = require('../controllers/adminController');
const auth = require('../middlewares/auth');
const limiteConnexion = require('../middlewares/limiteConnexion');
const { validerId } = require('../middlewares/validate');

router.post('/login', limiteConnexion, c.login);

// Tout ce qui suit exige une connexion
router.use(auth);

router.get('/stats', c.stats);
router.get('/declarations', c.listeDeclarations);
router.get('/declarations/:id', validerId, c.detailDeclaration);
router.put('/declarations/:id/statut', validerId, c.changerStatutDeclaration);
router.get('/deblocages', c.listeDeblocages);
router.put('/deblocages/:id/resoudre', validerId, c.resoudreSignalement);
router.get('/alertes', c.listeAlertes);
router.put('/alertes/:id/notifiee', validerId, c.alerteNotifiee);
router.get('/paiements', c.listePaiements);

module.exports = router;