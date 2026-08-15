const express = require('express');

const router = express.Router();

router.use('/auth', require('./auth.routes'));
router.use('/admin', require('./admin/index'));
router.use('/uploads', require('./uploads.routes'));
router.use('/nonconformities', require('./nonconformities.routes'));

router.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

module.exports = router;
