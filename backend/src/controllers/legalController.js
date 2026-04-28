const pool = require('../config/database');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const legalController = {
  // POST /api/legal/infringement — submit a copyright infringement notice
  submitInfringement: async (req, res) => {
    try {
      const { name, email, body } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Name is required.' });
      }
      if (!email || !EMAIL_REGEX.test(email.trim())) {
        return res.status(400).json({ error: 'A valid email address is required.' });
      }
      if (!body || !body.trim()) {
        return res.status(400).json({ error: 'Notice body is required.' });
      }
      if (body.trim().length > 50000) {
        return res.status(400).json({ error: 'Notice body is too long (max 50,000 characters).' });
      }

      await pool.query(
        'INSERT INTO copyright_infringement_notices (submitter_name, submitter_email, body) VALUES ($1, $2, $3)',
        [name.trim(), email.trim().toLowerCase(), body.trim()]
      );

      res.json({ success: true, message: 'Your infringement notice has been submitted. We will review it and respond to the email address you provided.' });
    } catch (error) {
      console.error('Submit infringement notice error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // POST /api/legal/counter-notice — submit a copyright counter-notification
  submitCounterNotice: async (req, res) => {
    try {
      const { name, email, body } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Name is required.' });
      }
      if (!email || !EMAIL_REGEX.test(email.trim())) {
        return res.status(400).json({ error: 'A valid email address is required.' });
      }
      if (!body || !body.trim()) {
        return res.status(400).json({ error: 'Counter-notice body is required.' });
      }
      if (body.trim().length > 50000) {
        return res.status(400).json({ error: 'Counter-notice body is too long (max 50,000 characters).' });
      }

      await pool.query(
        'INSERT INTO copyright_counter_notices (submitter_name, submitter_email, body) VALUES ($1, $2, $3)',
        [name.trim(), email.trim().toLowerCase(), body.trim()]
      );

      res.json({ success: true, message: 'Your counter-notification has been submitted. We will review it and respond to the email address you provided.' });
    } catch (error) {
      console.error('Submit counter-notice error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
};

module.exports = legalController;
