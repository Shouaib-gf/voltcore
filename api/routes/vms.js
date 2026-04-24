const express = require('express');
const router  = express.Router();
const jenkins = require('../services/jenkins');
const proxmox = require('../services/proxmox');
const { validateDeploy } = require('../middleware/validate');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Deploy
router.post('/deploy', validateDeploy, async (req, res) => {
  try {
    const { vmName, clientId, clientEmail, clientSshPubkey, plan, os, cpuCores, ramMb, diskGb } = req.body;
    const vmId = Math.floor(7000 + Math.random() * 1999);
    const { buildUrl, buildNumber } = await jenkins.triggerBuild({
      VM_NAME: vmName, VM_ID: String(vmId), CLIENT_ID: clientId,
      CLIENT_EMAIL: clientEmail, CLIENT_SSH_PUBKEY: clientSshPubkey,
      PLAN: plan || 'basic', OS: os || 'ubuntu-22.04',
      CPU_CORES: String(cpuCores || 2), RAM_MB: String(ramMb || 2048),
      DISK_GB: String(diskGb || 40), ACTION: 'apply'
    });
    res.status(202).json({ message: 'VM deployment triggered', vmId, vmName, buildUrl, buildNumber, status: 'provisioning' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Jenkins build status + IP
router.get('/status/:buildNumber', async (req, res) => {
  try { res.json(await jenkins.getBuildStatus(req.params.buildNumber)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Stop VM (graceful then force)
router.post('/stop', async (req, res) => {
  const { vmId } = req.body;
  if (!vmId) return res.status(400).json({ error: 'vmId required' });
  try {
    await proxmox.shutdownVm(vmId);
    res.json({ message: `VM ${vmId} shutdown initiated`, vmId, status: 'stopped' });
  } catch {
    try {
      await proxmox.stopVm(vmId);
      res.json({ message: `VM ${vmId} force stopped`, vmId, status: 'stopped' });
    } catch (err2) { res.status(500).json({ error: err2.message }); }
  }
});

// Start VM
router.post('/start', async (req, res) => {
  const { vmId } = req.body;
  if (!vmId) return res.status(400).json({ error: 'vmId required' });
  try {
    await proxmox.startVm(vmId);
    res.json({ message: `VM ${vmId} started`, vmId, status: 'running' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Destroy VM — delete from Proxmox + disk
router.post('/destroy', async (req, res) => {
  const { vmId, vmName } = req.body;
  if (!vmId) return res.status(400).json({ error: 'vmId required' });
  try {
    await proxmox.deleteVm(vmId);
    res.json({ message: `VM ${vmId} deleted`, vmId, status: 'deleted' });
  } catch (err) {
    if (err.message.includes('does not exist') || err.message.includes('404')) {
      return res.json({ message: `VM ${vmId} already gone`, vmId, status: 'deleted' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Real-time Proxmox status
router.get('/:vmId/status', async (req, res) => {
  try {
    const d = await proxmox.getVmStatus(req.params.vmId);
    res.json({ vmId: req.params.vmId, status: d.status, cpu: Math.round((d.cpu||0)*100), mem: d.mem, maxmem: d.maxmem, uptime: d.uptime });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// RRD metrics for graphs
router.get('/:vmId/metrics', async (req, res) => {
  try {
    const { timeframe = 'hour' } = req.query;
    const data = await proxmox.getVmMetrics(req.params.vmId, timeframe);
    res.json({
      vmId: req.params.vmId, timeframe,
      data: (data||[]).map(p => ({
        time:      p.time,
        cpu:       Math.round((p.cpu||0)*100),
        mem:       Math.round((p.mem||0)/1024/1024),
        netin:     Math.round((p.netin||0)/1024),
        netout:    Math.round((p.netout||0)/1024),
        diskread:  Math.round((p.diskread||0)/1024),
        diskwrite: Math.round((p.diskwrite||0)/1024)
      }))
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// List all VMs on node (admin)
router.get('/list', async (req, res) => {
  try {
    const vms = await proxmox.listVms();
    res.json(vms.map(v => ({ vmId: v.vmid, name: v.name, status: v.status, cpu: Math.round((v.cpu||0)*100), mem: v.mem, maxmem: v.maxmem, uptime: v.uptime })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
