// api/services/jenkins.js
const http = require('http');

const JENKINS_URL   = process.env.JENKINS_URL  || 'http://192.168.0.143:8080';
const JENKINS_USER  = process.env.JENKINS_USER || 'Shouaib';
const JENKINS_TOKEN = process.env.JENKINS_TOKEN|| '11d0609b21bf69fb86359f7a08ed5246bf';
const JOB_NAME      = process.env.JENKINS_JOB  || 'voltcore-vm-provision';

const auth = Buffer.from(`${JENKINS_USER}:${JENKINS_TOKEN}`).toString('base64');

// ── Generic fetch helper ─────────────────────────────────────
function jenkinsFetch(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(JENKINS_URL + path);
    const options = {
      hostname: url.hostname,
      port:     url.port || 8080,
      path:     url.pathname + (url.search || ''),
      method:   opts.method || 'GET',
      headers:  {
        'Authorization': `Basic ${auth}`,
        'Content-Type': opts.contentType || 'application/x-www-form-urlencoded',
        ...(opts.headers || {})
      }
    };

    const req = http.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });

    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// ── Get Jenkins crumb (CSRF token) ───────────────────────────
async function getCrumb() {
  const r = await jenkinsFetch('/crumbIssuer/api/json');
  const d = JSON.parse(r.body);
  return { field: d.crumbRequestField, value: d.crumb };
}

// ── Trigger Jenkins build ────────────────────────────────────
async function triggerBuild(params) {
  const crumb = await getCrumb();

  const body = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const r = await jenkinsFetch(
    `/job/${JOB_NAME}/buildWithParameters`,
    {
      method: 'POST',
      body,
      headers: { [crumb.field]: crumb.value }
    }
  );

  if (r.status !== 201 && r.status !== 200) {
    throw new Error(`Jenkins trigger failed: HTTP ${r.status}`);
  }

  const queueUrl = r.headers['location'];
  if (!queueUrl) throw new Error('No queue URL returned by Jenkins');

  const buildNumber = await pollQueue(queueUrl);
  const buildUrl = `${JENKINS_URL}/job/${JOB_NAME}/${buildNumber}/`;

  return { buildUrl, buildNumber };
}

// ── Poll Jenkins queue ───────────────────────────────────────
async function pollQueue(queueUrl, retries = 15) {
  for (let i = 0; i < retries; i++) {
    await sleep(2000);

    try {
      const path = new URL(queueUrl).pathname + 'api/json';
      const r = await jenkinsFetch(path);
      const d = JSON.parse(r.body);

      if (d.executable && d.executable.number) {
        return d.executable.number;
      }
    } catch {}
  }

  throw new Error('Timed out waiting for Jenkins build');
}

// ── Get build status + extract IP ────────────────────────────
async function getBuildStatus(buildNumber) {
  const path = `/job/${JOB_NAME}/${buildNumber}/api/json`;
  const r = await jenkinsFetch(path);
  const d = JSON.parse(r.body);

  const building = d.building;
  const result   = d.result;

  let ip = null;

  if (!building && result === 'SUCCESS') {
    ip = await extractIpFromLog(buildNumber);
  }

  return {
    building,
    status:      result,
    buildNumber: parseInt(buildNumber),
    ip,
    duration:    d.duration,
    url:         d.url
  };
}

// ── 🔥 FIXED: Extract IP from Jenkins logs ───────────────────
async function extractIpFromLog(buildNumber) {
  try {
    const path = `/job/${JOB_NAME}/${buildNumber}/consoleText`;
    const r = await jenkinsFetch(path);
    const log = r.body;

    // ✅ 1. Flexible match (works always)
    let match = log.match(/IP:\s*(192\.168\.\d+\.\d+)/);

    // ✅ 2. Fallback: any 192.168.x.x except Proxmox host
    if (!match) {
      const all = [...log.matchAll(/192\.168\.\d+\.\d+/g)];
      const filtered = all
        .map(m => m[0])
        .filter(ip => ip !== '192.168.0.143');

      if (filtered.length) {
        return filtered[filtered.length - 1];
      }
    }

    return match ? match[1] : null;

  } catch (err) {
    console.log('IP extraction failed:', err);
    return null;
  }
}

// ── Utils ────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { triggerBuild, getBuildStatus };
