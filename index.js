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

// Health
app.get('/', (_req, res) => res.send('LinkedIn Profile API is running.'));

// Disallow GET on main endpoint
app.get('/get_linkedin_profiles', (_req, res) => res.status(405).send('Use POST'));

// ------ CORE HELPERS ---------------------------------------------------------

async function launchPhantomV2(args) {
  const payload = {
    id: PHANTOM_AGENT_ID,
    // v2 expects *arguments* (plural) and it must be a string
    arguments: JSON.stringify(args),
    output: 'json'
  };

  const res = await axios.post(
    'https://api.phantombuster.com/api/v2/agents/launch',
    payload,
    {
      // keeping it here as well doesn't hurt, but body is what validator needs
      params: { id: PHANTOM_AGENT_ID },
      headers: {
        'X-Phantombuster-Key-1': PHANTOM_API_KEY,
        'Content-Type': 'application/json'
      },
      validateStatus: () => true
    }
  );

  if (DEBUG) {
    console.log('[V2 LAUNCH] status:', res.status);
    console.log('[V2 LAUNCH] data:', JSON.stringify(res.data));
  }
  if (res.data?.containerId) return res.data.containerId;

  const err = new Error('v2 launch failed');
  err.v2Response = res.data;
  throw err;
}

async function launchPhantomV1(args) {
  const payload = {
    output: 'json',
    // v1 accepts "argument" (singular) and it must be a string
    argument: JSON.stringify(args)
  };

  const res = await axios.post(
    `https://api.phantombuster.com/api/v1/agent/${PHANTOM_AGENT_ID}/launch`,
    payload,
    {
      headers: {
        'X-Phantombuster-Key-1': PHANTOM_API_KEY,
        'Content-Type': 'application/json'
      },
      validateStatus: () => true
    }
  );

  if (DEBUG) {
    console.log('[V1 LAUNCH] status:', res.status);
    console.log('[V1 LAUNCH] data:', JSON.stringify(res.data));
  }
  // v1 returns { status: "success", data: { containerId: ... } }
  const containerId = res.data?.data?.containerId || res.data?.containerId;
  if (containerId) return containerId;

  const err = new Error('v1 launch failed');
  err.v1Response = res.data;
  throw err;
}

async function pollUntilDone(containerId) {
  const POLL_INTERVAL = 5000;
  let status;
  do {
    const statusRes = await axios.get(
      'https://api.phantombuster.com/api/v2/containers/fetch',
      {
        params: { containerId },
        headers: { 'X-Phantombuster-Key-1': PHANTOM_API_KEY }
      }
    );
    status = statusRes.data?.status;
    if (DEBUG) console.log('[POLL]', statusRes.data);

    if (status === 'failed') {
      throw new Error(`PhantomBuster execution failed: ${JSON.stringify(statusRes.data)}`);
    }
    if (status !== 'finished' && status !== 'done') {
      await sleep(POLL_INTERVAL);
    }
  } while (status !== 'finished' && status !== 'done');
}

async function fetchOutput(containerId) {
  const outputRes = await axios.get(
    'https://api.phantombuster.com/api/v2/containers/fetch-output',
    {
      params: { containerId, output: 'json' },
      headers: {
        'X-Phantombuster-Key-1': PHANTOM_API_KEY,
        'Accept': 'application/json'
      }
    }
  );
  if (DEBUG) console.log('[OUTPUT]', outputRes.data);
  const data = outputRes.data;
  if (Array.isArray(data)) return data;
  if (data && data.profiles) return data.profiles;
  return data || [];
}

// ------ MAIN BUSINESS ROUTE --------------------------------------------------

app.post('/get_linkedin_profiles', async (req, res) => {
  try {
    const { role, industry, organisation } = req.body;
    if (!role || !organisation) {
      return res.status(400).send('Missing role or organisation');
    }
    if (!PHANTOM_API_KEY || !PHANTOM_AGENT_ID) {
      return res.status(500).json({ message: 'Server misconfiguration: missing PHANTOMBUSTER env vars' });
    }

    if (DEBUG) {
      console.log('[REQ BODY]', req.body);
      console.log('Using Agent ID:', PHANTOM_AGENT_ID);
      console.log('Using API Key (first 6):', mask(PHANTOM_API_KEY));
    }

    const phantomArgs = { role, industry, organisation, numberOfProfiles: 10 };

    let containerId;
    try {
      containerId = await launchPhantomV2(phantomArgs);
    } catch (e) {
      // If v2 schema validator still complains, fall back to v1
      if (DEBUG) console.log('[V2 FAILED] Falling back to v1', e.v2Response);
      containerId = await launchPhantomV1(phantomArgs);
    }

    await pollUntilDone(containerId);
    const profiles = await fetchOutput(containerId);

    res.json({ profiles });

  } catch (error) {
    console.error(error?.response?.data || error.message);
    res.status(500).json({
      message: 'Error retrieving profiles',
      detail: error?.response?.data || error.message
    });
  }
});

// ------ OPTIONAL DIAGNOSTICS -------------------------------------------------

app.get('/debug_phantom', async (_req, res) => {
  try {
    const testArgs = { ping: true };
    let v2, v1;
    try {
      v2 = await launchPhantomV2(testArgs);
    } catch (e) {
      v2 = { error: e.message, v2Response: e.v2Response };
    }
    try {
      v1 = await launchPhantomV1(testArgs);
    } catch (e) {
      v1 = { error: e.message, v1Response: e.v1Response };
    }
    res.json({
      env: {
        PHANTOMBUSTER_AGENT_ID: PHANTOM_AGENT_ID,
        PHANTOMBUSTER_API_KEY_first6: mask(PHANTOM_API_KEY),
      },
      v2Result: v2,
      v1Result: v1
    });
  } catch (err) {
    res.status(500).json({ error: err?.response?.data || err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log('Agent ID:', PHANTOM_AGENT_ID);
  console.log('API key (first 6):', mask(PHANTOM_API_KEY));
});
