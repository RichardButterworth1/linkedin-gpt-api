require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PHANTOM_API_KEY  = process.env.PHANTOMBUSTER_API_KEY?.trim();
const PHANTOM_AGENT_ID = process.env.PHANTOMBUSTER_AGENT_ID?.trim();
const PORT             = process.env.PORT || 3000;
const DEBUG            = (process.env.DEBUG_PHANTOM || 'false').toLowerCase() === 'true';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const mask  = (s, keep = 6) => (s ? s.slice(0, keep) + '…' : s);

// ---- runtime cache of what actually works ----
let launchMode   = null; // 'v2' | 'v1'
let statusMode   = null; // 'v2' | 'v1'
let outputMode   = null; // 'v2' | 'v1'

function assertEnv() {
  if (!PHANTOM_API_KEY)  throw new Error('Missing PHANTOMBUSTER_API_KEY');
  if (!PHANTOM_AGENT_ID) throw new Error('Missing PHANTOMBUSTER_AGENT_ID');
}

function logOnceAtBoot() {
  console.log(`Server listening on port ${PORT}`);
  console.log('Agent ID:', PHANTOM_AGENT_ID);
  console.log('API key present:', !!PHANTOM_API_KEY);
  console.log('Auto-detecting Phantombuster API shapes (v1/v2)…');
}

// -------------------- LOW LEVEL CALLS --------------------

async function v2Launch(args) {
  const payload = {
    id: PHANTOM_AGENT_ID,
    arguments: JSON.stringify(args),
    output: 'json'
  };

  const res = await axios.post(
    'https://api.phantombuster.com/api/v2/agents/launch',
    payload,
    {
      params: { id: PHANTOM_AGENT_ID },
      headers: {
        'X-Phantombuster-Key-1': PHANTOM_API_KEY,
        'Content-Type': 'application/json'
      },
      validateStatus: () => true
    }
  );

  if (DEBUG) {
    console.log('[v2Launch] status:', res.status);
    console.log('[v2Launch] data:', JSON.stringify(res.data));
  }

  if (res.data?.containerId) {
    return res.data.containerId;
  }
  const err = new Error('v2 launch failed');
  err.info = res.data;
  throw err;
}

async function v1Launch(args) {
  const res = await axios.post(
    `https://api.phantombuster.com/api/v1/agent/${PHANTOM_AGENT_ID}/launch`,
    {
      output: 'json',
      argument: JSON.stringify(args)
    },
    {
      headers: {
        'X-Phantombuster-Key-1': PHANTOM_API_KEY,
        'Content-Type': 'application/json'
      },
      validateStatus: () => true
    }
  );

  if (DEBUG) {
    console.log('[v1Launch] status:', res.status);
    console.log('[v1Launch] data:', JSON.stringify(res.data));
  }

  const containerId = res.data?.data?.containerId || res.data?.containerId;
  if (containerId) return containerId;

  const err = new Error('v1 launch failed');
  err.info = res.data;
  throw err;
}

async function v2FetchStatus(containerId) {
  const res = await axios.get(
    'https://api.phantombuster.com/api/v2/containers/fetch',
    {
      params: { containerId },
      headers: { 'X-Phantombuster-Key-1': PHANTOM_API_KEY },
      validateStatus: () => true
    }
  );
  if (DEBUG) console.log('[v2FetchStatus]', res.status, res.data);
  if (res.status >= 400) throw new Error(`v2 status endpoint error: ${res.status}`);
  return res.data?.status;
}

async function v1FetchStatus(containerId) {
  const res = await axios.get(
    'https://api.phantombuster.com/api/v1/containers/fetch',
    {
      params: { id: containerId },
      headers: { 'X-Phantombuster-Key-1': PHANTOM_API_KEY },
      validateStatus: () => true
    }
  );
  if (DEBUG) console.log('[v1FetchStatus]', res.status, res.data);
  if (res.status >= 400) throw new Error(`v1 status endpoint error: ${res.status}`);

  // v1 commonly wraps status in data
  return res.data?.data?.status || res.data?.status;
}

async function v2FetchOutput(containerId) {
  const res = await axios.get(
    'https://api.phantombuster.com/api/v2/containers/fetch-output',
    {
      params: { containerId, output: 'json' },
      headers: {
        'X-Phantombuster-Key-1': PHANTOM_API_KEY,
        'Accept': 'application/json'
      },
      validateStatus: () => true
    }
  );
  if (DEBUG) console.log('[v2FetchOutput]', res.status, res.data);
  if (res.status >= 400) throw new Error(`v2 output endpoint error: ${res.status}`);
  return res.data;
}

async function v1FetchOutput(containerId) {
  const res = await axios.get(
    'https://api.phantombuster.com/api/v1/containers/fetch-output',
    {
      params: { id: containerId, output: 'json' },
      headers: {
        'X-Phantombuster-Key-1': PHANTOM_API_KEY,
        'Accept': 'application/json'
      },
      validateStatus: () => true
    }
  );
  if (DEBUG) console.log('[v1FetchOutput]', res.status, res.data);
  if (res.status >= 400) throw new Error(`v1 output endpoint error: ${res.status}`);
  return res.data?.data ?? res.data;
}

// -------------------- AUTO-DETECT WRAPPERS --------------------

async function autoLaunch(args) {
  // Reuse working mode if we already found it
  if (launchMode) {
    return launchMode === 'v2' ? v2Launch(args) : v1Launch(args);
  }

  // Try v2 first
  try {
    const cid = await v2Launch(args);
    launchMode = 'v2';
    return cid;
  } catch (eV2) {
    // If v2 fails (validation, endpoint not found, etc.), try v1
    if (DEBUG) console.log('[autoLaunch] v2 failed, trying v1', eV2.info || eV2.message);
    const cid = await v1Launch(args);
    launchMode = 'v1';
    return cid;
  }
}

async function autoPoll(containerId) {
  const POLL_INTERVAL = 5000;

  // If we already found a working statusMode, use it
  const getStatus = async () => {
    if (statusMode === 'v2') return v2FetchStatus(containerId);
    if (statusMode === 'v1') return v1FetchStatus(containerId);

    // Detect on first call
    try {
      const s = await v2FetchStatus(containerId);
      statusMode = 'v2';
      return s;
    } catch {
      const s = await v1FetchStatus(containerId);
      statusMode = 'v1';
      return s;
    }
  };

  let status;
  do {
    status = await getStatus();
    if (status === 'failed') {
      throw new Error('PhantomBuster execution failed');
    }
    if (status !== 'finished' && status !== 'done') {
      await sleep(POLL_INTERVAL);
    }
  } while (status !== 'finished' && status !== 'done');
}

async function autoFetchOutput(containerId) {
  // Reuse working outputMode if we already found it
  const getOutput = async () => {
    if (outputMode === 'v2') return v2FetchOutput(containerId);
    if (outputMode === 'v1') return v1FetchOutput(containerId);

    // Detect on first call
    try {
      const d = await v2FetchOutput(containerId);
      outputMode = 'v2';
      return d;
    } catch {
      const d = await v1FetchOutput(containerId);
      outputMode = 'v1';
      return d;
    }
  };

  const raw = await getOutput();
  if (Array.isArray(raw)) return raw;
  if (raw && raw.profiles) return raw.profiles;
  return raw || [];
}

// -------------------- ROUTES --------------------

app.get('/', (_req, res) => {
  res.send('LinkedIn Profile API is running.');
});

app.get('/get_linkedin_profiles', (_req, res) => {
  res.status(405).send('Use POST');
});

app.post('/get_linkedin_profiles', async (req, res) => {
  try {
    assertEnv();
    const { role, industry, organisation } = req.body;
    if (!role || !organisation) {
      return res.status(400).send('Missing role or organisation');
    }

    const args = { role, industry, organisation, numberOfProfiles: 10 };

    const containerId = await autoLaunch(args);
    await autoPoll(containerId);
    const profiles = await autoFetchOutput(containerId);

    res.json({ profiles });
  } catch (error) {
    const detail = error?.response?.data || error.info || error.message;
    console.error('FATAL:', detail);
    res.status(500).json({
      message: 'Error retrieving profiles',
      detail
    });
  }
});

// -------------- BOOT ----------------

app.listen(PORT, () => {
  logOnceAtBoot();
});
