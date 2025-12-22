const express = require('express');
const router = express.Router();
const manager = require('../controller/manager');

/**
 * Get all agents status
 */
router.get('/', (req, res) => {
    try {
        const status = manager.getAgentsStatus();
        res.status(200).json(status);
    } catch (e) {
        res.status(500).send(e.message);
    }
});

module.exports = router;
