const express = require('express');
const { requireAuth } = require('../../middleware/auth');

const router = express.Router();

// Admin altındaki tüm rotalar geçerli bir oturum ister; her alt rota kendi yetki
// kontrolünü (requirePermission / requireSystemAdmin) ayrıca uygular.
router.use(requireAuth);

router.use('/projects', require('./projects.routes'));
router.use('/companies', require('./companies.routes'));
router.use('/users', require('./users.routes'));
router.use('/roles', require('./roles.routes'));
router.use('/permissions', require('./permissions.routes'));
router.use('/categories', require('./categories.routes'));

module.exports = router;
