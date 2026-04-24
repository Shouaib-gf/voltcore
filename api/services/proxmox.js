const https = require('https');

const PROXMOX_URL   = process.env.PROXMOX_URL   || 'https://192.168.0.143:8006';
const PROXMOX_TOKEN = process.env.PROXMOX_TOKEN || ''; // format: user@realm!tokenid=secret
const PROXMOX_NODE  = process.env.PROXMOX_NODE  || 'pve';

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
        console.log("----- PROXMOX RAW RESPONSE -----");
        console.log("STATUS:", res.statusCode);
        console.log("BODY:", data);
        console.log("--------------------------------");

        try {
          // ✅ empty response = success
          if (!data || data.trim() === '') {
            return resolve({ success: true });
          }

          // ✅ try parsing JSON
          const json = JSON.parse(data);

          if (res.statusCode >= 400) {
            return reject(new Error(
              json.errors
                ? JSON.stringify(json.errors)
                : `HTTP ${res.statusCode}`
            ));
          }

          return resolve(json.data ?? json);

        } catch (err) {
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

// ─────────────────────────────────────────────
// VM Actions
// ─────────────────────────────────────────────
async function startVm(vmId) {
  return pveRequest('POST', `/nodes/${PROXMOX_NODE}/qemu/${vmId}/status/start`);
}

async function stopVm(vmId) {
  return pveRequest('POST', `/nodes/${PROXMOX_NODE}/qemu/${vmId}/status/stop`);
}

async function shutdownVm(vmId) {
  return pveRequest('POST', `/nodes/${PROXMOX_NODE}/qemu/${vmId}/status/shutdown`);
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

  return pveRequest(
    'DELETE',
    `/nodes/${PROXMOX_NODE}/qemu/${vmId}?purge=1&destroy-unreferenced-disks=1`
  );
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
  listVms
};
