const express = require('express');
const http = require('http');
const https = require('https');
const { authRequired, adminRequired } = require('../middleware/auth');
const proxmox = require('../services/proxmox');
const jenkins = require('../services/jenkins');
const Vm = require('../models/Vm');
const User = require('../models/User');

const router = express.Router();

function probeUrl(target, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const url = new URL(target);
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'GET',
      timeout: timeoutMs,
      rejectUnauthorized: false
    }, (res) => {
      res.resume();
      resolve({ ok: res.statusCode >= 200 && res.statusCode < 500, status: res.statusCode });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.end();
  });
}

router.get('/health', authRequired, adminRequired, async (req, res) => {
  const [proxmoxResult, jenkinsResult, minioResult, vmCount, userCount] = await Promise.allSettled([
    proxmox.listVms(),
    jenkins.getJobInfo(),
    probeUrl(process.env.MINIO_HEALTH_URL || 'http://192.168.1.152:9000/minio/health/live'),
    Vm.countDocuments(),
    User.countDocuments()
  ]);

  const proxmoxOk = proxmoxResult.status === 'fulfilled';
  const jenkinsOk = jenkinsResult.status === 'fulfilled';
  const minioOk = minioResult.status === 'fulfilled' && minioResult.value.ok;
  const vms = proxmoxOk ? proxmoxResult.value : [];

  res.json({
    generatedAt: new Date(),
    services: {
      api: { ok: true, status: 'online' },
      proxmox: {
        ok: proxmoxOk,
        status: proxmoxOk ? 'online' : 'error',
        vmCount: Array.isArray(vms) ? vms.length : 0,
        error: proxmoxOk ? null : proxmoxResult.reason.message
      },
      jenkins: {
        ok: jenkinsOk,
        status: jenkinsOk ? 'online' : 'error',
        job: jenkinsOk ? jenkinsResult.value.name : process.env.JENKINS_JOB,
        buildable: jenkinsOk ? jenkinsResult.value.buildable : false,
        error: jenkinsOk ? null : jenkinsResult.reason.message
      },
      minio: {
        ok: minioOk,
        status: minioOk ? 'online' : 'error',
        error: minioOk ? null : (minioResult.value?.error || minioResult.reason?.message || 'unreachable')
      },
      mongo: {
        ok: vmCount.status === 'fulfilled' && userCount.status === 'fulfilled',
        vmRecords: vmCount.status === 'fulfilled' ? vmCount.value : 0,
        users: userCount.status === 'fulfilled' ? userCount.value : 0
      }
    }
  });
});

module.exports = router;
