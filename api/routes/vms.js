// api/routes/vms.js
const express  = require('express');
const router   = express.Router();
const jenkins  = require('../services/jenkins');
const { validateDeploy } = require('../middleware/validate');

// POST /api/vms/deploy
router.post('/deploy', validateDeploy, async (req, res) => {
  try {
    const {
      vmName, clientId, clientEmail, clientSshPubkey,
      plan, os, cpuCores, ramMb, diskGb
    } = req.body;

    const vmId = Math.floor(7000 + Math.random() * 1999);

    const { buildUrl, buildNumber } = await jenkins.triggerBuild({
      VM_NAME:           vmName,
      VM_ID:             String(vmId),
      CLIENT_ID:         clientId,
      CLIENT_EMAIL:      clientEmail,
      CLIENT_SSH_PUBKEY: clientSshPubkey,
      PLAN:              plan        || 'basic',
      OS:                os          || 'ubuntu-22.04',
      CPU_CORES:         String(cpuCores || 2),
      RAM_MB:            String(ramMb    || 2048),
      DISK_GB:           String(diskGb   || 40),
      ACTION:            'apply'
    });

    res.status(202).json({
      message:     'VM deployment triggered',
      vmId,
      vmName,
      buildUrl,
      buildNumber,   // ← frontend uses this to poll status
      status:        'provisioning'
    });

  } catch (err) {
    console.error('Deploy error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/vms/destroy
router.post('/destroy', async (req, res) => {
  try {
    const { vmName, vmId, clientId, clientEmail, clientSshPubkey } = req.body;

    if (!vmName || !vmId)
      return res.status(400).json({ error: 'vmName and vmId are required' });

    const { buildUrl, buildNumber } = await jenkins.triggerBuild({
      VM_NAME:           vmName,
      VM_ID:             String(vmId),
      CLIENT_ID:         clientId         || '',
      CLIENT_EMAIL:      clientEmail      || '',
      CLIENT_SSH_PUBKEY: clientSshPubkey  || 'none',
      PLAN:              'basic',
      OS:                'ubuntu-22.04',
      CPU_CORES:         '1',
      RAM_MB:            '512',
      DISK_GB:           '10',
      ACTION:            'destroy'
    });

    res.status(202).json({
      message: 'VM destroy triggered',
      vmId,
      vmName,
      buildUrl,
      buildNumber,
      status: 'destroying'
    });

  } catch (err) {
    console.error('Destroy error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/vms/status/:buildNumber
// Returns: { building, status, buildNumber, ip, duration, url }
router.get('/status/:buildNumber', async (req, res) => {
  try {
    const data = await jenkins.getBuildStatus(req.params.buildNumber);
    res.json(data);
  } catch (err) {
    console.error('Status error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
