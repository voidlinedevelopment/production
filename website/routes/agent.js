const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.render('agent/download', { layout: false, title: 'Download OBS Agent' });
});

module.exports = router;
