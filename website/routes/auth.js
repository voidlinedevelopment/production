const express = require('express');
const passport = require('passport');
const router = express.Router();

router.get('/discord', passport.authenticate('discord', {
  scope: ['identify', 'email', 'guilds']
}));

router.get('/discord/callback',
  passport.authenticate('discord', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('/dashboard');
  }
);

router.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) console.error(err);
    res.redirect('/');
  });
});

module.exports = router;
