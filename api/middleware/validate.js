// api/middleware/validate.js

function validateDeploy(req, res, next) {
  const { vmName, clientId, clientEmail, clientSshPubkey, os } = req.body;

  if (!vmName)
    return res.status(400).json({ error: 'vmName is required' });

  if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(vmName))
    return res.status(400).json({ error: 'vmName must be lowercase letters, numbers and hyphens only' });

  if (!clientId)
    return res.status(400).json({ error: 'clientId is required' });

  if (!clientEmail)
    return res.status(400).json({ error: 'clientEmail is required' });

  if (!clientSshPubkey || !clientSshPubkey.startsWith('ssh-'))
    return res.status(400).json({ error: 'A valid SSH public key is required (must start with ssh-)' });

  const validOs = ['ubuntu-22.04', 'debian-12'];
  if (os && !validOs.includes(os))
    return res.status(400).json({ error: `OS must be one of: ${validOs.join(', ')}` });

  next();
}

module.exports = { validateDeploy };
