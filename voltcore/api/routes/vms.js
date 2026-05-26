const express = require('express');
const router  = express.Router();
const jenkins = require('../services/jenkins');
const proxmox = require('../services/proxmox');
const { validateDeploy } = require('../middleware/validate');
const { authRequired, adminRequired } = require('../middleware/auth');
const Vm = require('../models/Vm');
const { notify } = require('../services/notifications');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function terraformPlan(plan) {
  const key = String(plan || '').toLowerCase();
  if (key === 'starter') return 'basic';
  if (key === 'professional') return 'pro';
  if (key === 'enterprise') return 'enterprise';
  if (key === 'custom') return 'custom';
  return key || 'basic';
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value || fallback);
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : fallback));
}

function vmIpFromId(vmId) {
    return `192.168.1.${100 + (Number(vmId) % 100)}`;
}

async function resolveVmIp(vm, statusIp = '') {
  if (statusIp) return statusIp;
  try {
    const agentIp = await proxmox.getVmAgentIp(vm.vmId);
    if (agentIp) return agentIp;
  } catch {
    // Guest agent IP discovery is best-effort while cloud-init is still settling.
  }
  return vm.ip || vmIpFromId(vm.vmId);
}

function secondsUntil(date) {
  if (!date) return null;
  return Math.max(0, Math.round((new Date(date).getTime() - Date.now()) / 1000));
}

function expirationFromLease(days) {
  const leaseDays = clampNumber(days, 1, 365, 30);
  const expiresAt = new Date(Date.now() + leaseDays * 24 * 60 * 60 * 1000);
  return { leaseDays, expiresAt };
}

async function findAuthorizedVm(req, vmId) {
  const vm = await Vm.findOne({ vmId: Number(vmId) });
  if (!vm) {
    const err = new Error('VM record not found');
    err.statusCode = 404;
    throw err;
  }
  if (req.user.role !== 'admin' && vm.user.toString() !== req.user._id.toString()) {
    const err = new Error('Not allowed to manage this VM');
    err.statusCode = 403;
    throw err;
  }
  return vm;
}

// Deploy
router.post('/deploy', authRequired, validateDeploy, async (req, res) => {
  try {
    const { vmName, clientSshPubkey, plan, os, cpuCores, ramMb, diskGb, leaseDays } = req.body;
    const clientId = req.user._id.toString();
    const clientEmail = req.user.email;
    const tfPlan = terraformPlan(plan || req.user.plan);
    const safeCpuCores = clampNumber(cpuCores, 1, 16, 1);
    const safeRamMb = clampNumber(ramMb, 512, 32768, 1024);
    const safeDiskGb = clampNumber(diskGb, 10, 1024, 40);
    const vmId = Math.floor(7000 + Math.random() * 1999);
    const expectedIp = vmIpFromId(vmId);
    const lease = expirationFromLease(leaseDays);
    const { buildUrl, buildNumber } = await jenkins.triggerBuild({
      VM_NAME: vmName, VM_ID: String(vmId), CLIENT_ID: clientId,
      CLIENT_EMAIL: clientEmail, CLIENT_SSH_PUBKEY: clientSshPubkey,
      TERMINAL_SSH_PUBKEY: process.env.VM_TERMINAL_PUBLIC_KEY || '',
      PLAN: tfPlan, OS: os || 'ubuntu-22.04',
      CPU_CORES: String(safeCpuCores), RAM_MB: String(safeRamMb),
      DISK_GB: String(safeDiskGb), ACTION: 'apply'
    });
    const vm = await Vm.create({
      vmId,
      name: vmName,
      user: req.user._id,
      userEmail: req.user.email,
      status: 'provisioning',
      os: os || 'ubuntu-22.04',
      plan: plan || req.user.plan || 'Professional',
      cpuCores: safeCpuCores,
      ramMb: safeRamMb,
      diskGb: safeDiskGb,
      ip: expectedIp,
      clientSshPubkey,
      leaseDays: lease.leaseDays,
      expiresAt: lease.expiresAt,
      buildUrl,
      buildNumber
    });
    await notify({
      user: req.user._id,
      vm: vm._id,
      vmId,
      type: 'info',
      title: 'VM deployment queued',
      detail: `${vmName} is being provisioned through Jenkins.`
    });
    res.status(202).json({ message: 'VM deployment triggered', vmId, vmName, ip: expectedIp, leaseDays: lease.leaseDays, expiresAt: lease.expiresAt, buildUrl, buildNumber, status: 'provisioning', vm });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/', authRequired, async (req, res) => {
  try {
    const query = req.user.role === 'admin' ? {} : { user: req.user._id };
    const vms = await Vm.find(query).sort({ createdAt: -1 });
    res.json(vms);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/all', authRequired, adminRequired, async (req, res) => {
  try {
    const vms = await Vm.find().populate('user', 'name email role plan').sort({ createdAt: -1 });
    res.json(vms);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Jenkins build status + IP
router.get('/status/:buildNumber', authRequired, async (req, res) => {
  try {
    const vm = await Vm.findOne({ buildNumber: Number(req.params.buildNumber) });
    if (!vm) return res.status(404).json({ error: 'VM build not found' });
    if (req.user.role !== 'admin' && vm.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not allowed to inspect this build' });
    }
    const status = await jenkins.getBuildStatus(req.params.buildNumber);
    if (vm) {
      const previous = vm.status;
      vm.lastStatusCheckedAt = new Date();
      if (!status.building) vm.status = status.status === 'SUCCESS' ? 'running' : 'failed';
      if (vm.status === 'running') vm.ip = await resolveVmIp(vm, status.ip);
      else if (status.ip) vm.ip = status.ip;
      await vm.save();
      if (!status.building && previous === 'provisioning') {
        await notify({
          user: vm.user,
          vm: vm._id,
          vmId: vm.vmId,
          type: vm.status === 'running' ? 'success' : 'error',
          title: vm.status === 'running' ? 'VM ready' : 'VM provisioning failed',
          detail: vm.status === 'running' ? `${vm.name} is ready at ${vm.ip}.` : `${vm.name} finished with ${status.status}.`
        });
      }
    }
    res.json(status);
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Stop VM (graceful then force)
router.post('/stop', authRequired, async (req, res) => {
  const { vmId } = req.body;
  if (!vmId) return res.status(400).json({ error: 'vmId required' });
  try {
    await findAuthorizedVm(req, vmId);
    await proxmox.stopVm(vmId);
    const vm = await Vm.findOneAndUpdate({ vmId: Number(vmId) }, { status: 'stopped', lastActivityAt: new Date() }, { new: true });
    await notify({ user: vm.user, vm: vm._id, vmId: vm.vmId, type: 'info', title: 'VM stopped', detail: `${vm.name} was stopped.` });
    res.json({ message: `VM ${vmId} stopped`, vmId, status: 'stopped', vm });
  } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

// Start VM
router.post('/start', authRequired, async (req, res) => {
  const { vmId } = req.body;
  if (!vmId) return res.status(400).json({ error: 'vmId required' });
  try {
    await findAuthorizedVm(req, vmId);
    await proxmox.startVm(vmId);
    const vm = await Vm.findOneAndUpdate({ vmId: Number(vmId) }, { status: 'running', lastActivityAt: new Date(), idleNoticeSentAt: null }, { new: true });
    await notify({ user: vm.user, vm: vm._id, vmId: vm.vmId, type: 'success', title: 'VM started', detail: `${vm.name} is running.` });
    res.json({ message: `VM ${vmId} started`, vmId, status: 'running', vm });
  } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

// Destroy VM — delete from Proxmox + disk
router.post('/destroy', authRequired, async (req, res) => {
  const { vmId, vmName } = req.body;
  if (!vmId) return res.status(400).json({ error: 'vmId required' });
  try {
    const vm = await findAuthorizedVm(req, vmId);
    let destroyBuild = null;
    if (vm.clientSshPubkey) {
      destroyBuild = await jenkins.triggerBuild({
        VM_NAME: vm.name,
        VM_ID: String(vm.vmId),
        CLIENT_ID: vm.user.toString(),
        CLIENT_EMAIL: vm.userEmail,
        CLIENT_SSH_PUBKEY: vm.clientSshPubkey,
        TERMINAL_SSH_PUBKEY: process.env.VM_TERMINAL_PUBLIC_KEY || '',
        PLAN: terraformPlan(vm.plan),
        OS: vm.os || 'ubuntu-22.04',
        CPU_CORES: String(vm.cpuCores || 1),
        RAM_MB: String(vm.ramMb || 1024),
        DISK_GB: String(vm.diskGb || 40),
        ACTION: 'destroy'
      });
    } else {
      await proxmox.deleteVm(vmId);
    }
    await notify({ user: vm.user, vm: vm._id, vmId: vm.vmId, type: 'info', title: 'VM deleted', detail: `${vm.name} deletion was triggered.` });
    await Vm.deleteOne({ vmId: Number(vmId) });
    res.json({ message: `VM ${vmId} deletion triggered`, vmId, status: 'deleted', destroyBuild });
  } catch (err) {
    if (proxmox.isMissingVmError(err)) {
      await Vm.deleteOne({ vmId: Number(vmId) });
      return res.json({ message: `VM ${vmId} already gone`, vmId, status: 'deleted' });
    }
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Real-time Proxmox status
router.get('/:vmId/status', authRequired, async (req, res) => {
  try {
    const vm = await findAuthorizedVm(req, req.params.vmId);
    const d = await proxmox.getVmStatus(req.params.vmId);
    const ip = await resolveVmIp(vm);
    await Vm.findOneAndUpdate(
      { vmId: Number(req.params.vmId) },
      { status: d.status, ip, lastStatusCheckedAt: new Date(), lastActivityAt: new Date() }
    );
    res.json({ vmId: req.params.vmId, status: d.status, ip, cpu: Math.round((d.cpu||0)*100), mem: d.mem, maxmem: d.maxmem, uptime: d.uptime, expiresAt: vm?.expiresAt, secondsRemaining: secondsUntil(vm?.expiresAt) });
  } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

// RRD metrics for graphs
router.get('/:vmId/metrics', authRequired, async (req, res) => {
  try {
    await findAuthorizedVm(req, req.params.vmId);
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
  } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

// List all VMs on node (admin)
router.get('/list', authRequired, adminRequired, async (req, res) => {
  try {
    const vms = await proxmox.listVms();
    res.json(vms.map(v => ({ vmId: v.vmid, name: v.name, status: v.status, cpu: Math.round((v.cpu||0)*100), mem: v.mem, maxmem: v.maxmem, uptime: v.uptime })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
