const https = require('https');

const PROXMOX_URL   = process.env.PROXMOX_URL   || 'https://192.168.1.152:8006';
const PROXMOX_TOKEN = process.env.PROXMOX_TOKEN || ''; // format: user@realm!tokenid=secret
const PROXMOX_NODE  = process.env.PROXMOX_NODE  || 'pve';
const PROXMOX_DEBUG = process.env.PROXMOX_DEBUG === 'true';

// ─────────────────────────────────────────────
// Generic Proxmox request (FIXED)
// ─────────────────────────────────────────────
function pveRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(PROXMOX_URL + '/api2/json' + path);

    const opts = {
      hostname: url.hostname,
      port: url.port || 8006,
      path: url.pathname + (url.search || ''),
      method,
      headers: {
        'Authorization': `PVEAPIToken=${PROXMOX_TOKEN}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      rejectUnauthorized: false // allow self-signed cert
    };

    const req = https.request(opts, res => {
      let data = '';

      res.on('data', chunk => data += chunk);

      res.on('end', () => {
        if (PROXMOX_DEBUG) {
          console.log("----- PROXMOX RAW RESPONSE -----");
          console.log("STATUS:", res.statusCode);
          console.log("BODY:", data.slice(0, 2000));
          console.log("--------------------------------");
        }

        try {
          // ✅ empty response = success
          if (!data || data.trim() === '') {
            return resolve({ success: true });
          }

          // ✅ try parsing JSON
          const json = JSON.parse(data);

          if (res.statusCode >= 400) {
            const message = json.message || json.error || (json.errors ? JSON.stringify(json.errors) : `HTTP ${res.statusCode}`);
            const error = new Error(message);
            error.statusCode = res.statusCode;
            error.proxmoxBody = json;
            return reject(error);
          }

          return resolve(json.data ?? json);

        } catch (err) {
          if (err.statusCode) return reject(err);
          // ✅ non-JSON but success
          if (res.statusCode < 400) {
            return resolve({ success: true, raw: data });
          }

          return reject(new Error(`Invalid JSON from Proxmox: ${data}`));
        }
      });
    });

    req.on('error', reject);

    // ✅ FIX: send body as form-urlencoded
    if (body) {
      const form = new URLSearchParams(body).toString();
      req.write(form);
    }

    req.end();
  });
}

async function waitForTask(upid, timeoutMs = 120000) {
  if (!upid || typeof upid !== 'string' || !upid.startsWith('UPID:')) return upid;

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = await pveRequest(
      'GET',
      `/nodes/${PROXMOX_NODE}/tasks/${encodeURIComponent(upid)}/status`
    );

    if (status.status === 'stopped') {
      if (status.exitstatus && status.exitstatus !== 'OK') {
        throw new Error(`Proxmox task failed: ${status.exitstatus}`);
      }
      return status;
    }

    await sleep(1500);
  }

  throw new Error(`Timed out waiting for Proxmox task ${upid}`);
}

// ─────────────────────────────────────────────
// VM Actions
// ─────────────────────────────────────────────
async function startVm(vmId) {
  const task = await pveRequest('POST', `/nodes/${PROXMOX_NODE}/qemu/${vmId}/status/start`);
  return waitForTask(task);
}

async function stopVm(vmId) {
  const task = await pveRequest('POST', `/nodes/${PROXMOX_NODE}/qemu/${vmId}/status/stop`);
  return waitForTask(task);
}

async function shutdownVm(vmId) {
  const task = await pveRequest('POST', `/nodes/${PROXMOX_NODE}/qemu/${vmId}/status/shutdown`);
  return waitForTask(task);
}

// ─────────────────────────────────────────────
// Delete VM + disks
// ─────────────────────────────────────────────
async function deleteVm(vmId) {
  try {
    await stopVm(vmId);
    await sleep(3000);
  } catch {
    // ignore if already stopped
  }

  const task = await pveRequest(
    'DELETE',
    `/nodes/${PROXMOX_NODE}/qemu/${vmId}?purge=1&destroy-unreferenced-disks=1`
  );
  return waitForTask(task);
}

function isMissingVmError(err) {
  const message = String(err && err.message || '').toLowerCase();
  return message.includes('does not exist')
    || message.includes('configuration file')
    || message.includes('not found')
    || message.includes('404');
}

// ─────────────────────────────────────────────
// VM Info
// ─────────────────────────────────────────────
async function getVmStatus(vmId) {
  return pveRequest('GET', `/nodes/${PROXMOX_NODE}/qemu/${vmId}/status/current`);
}

async function getVmMetrics(vmId, timeframe = 'hour') {
  return pveRequest(
    'GET',
    `/nodes/${PROXMOX_NODE}/qemu/${vmId}/rrddata?timeframe=${timeframe}&cf=AVERAGE`
  );
}

async function listVms() {
  return pveRequest('GET', `/nodes/${PROXMOX_NODE}/qemu`);
}

async function getVmAgentIp(vmId) {
  const interfaces = await pveRequest('GET', `/nodes/${PROXMOX_NODE}/qemu/${vmId}/agent/network-get-interfaces`);
  const candidates = [];
  for (const iface of interfaces?.result || interfaces || []) {
    for (const item of iface['ip-addresses'] || []) {
      const ip = item['ip-address'];
      const usable = item['ip-address-type'] === 'ipv4'
        && ip
        && !ip.startsWith('127.')
        && !ip.startsWith('169.254.')
        && ip !== '192.168.1.1';
      if (usable) candidates.push(ip);
    }
  }
    return candidates.find(ip => ip.startsWith('192.168.1.')) || candidates[0] || null;
}

// ─────────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  startVm,
  stopVm,
  shutdownVm,
  deleteVm,
  getVmStatus,
  getVmMetrics,
  getVmAgentIp,
  listVms,
  isMissingVmError
};
