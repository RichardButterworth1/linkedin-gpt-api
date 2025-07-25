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

function assertEnv() {
  if (!PHANTOM_API_KEY) {
    throw new Error('Missing PHANTOMBUSTER_API_KEY');
  }
  if (!PHANTOM_AGENT_ID) {
    throw new Error('Missing PHANTOMBUSTER_AGENT_ID');
  }
}

// Health
app.get('/', (_req, res) => res.send('LinkedIn Profile API is running.'));
app.get('/get_linkedin_profiles', (_req, res) => res.status(405).send('Use POST'));

// ------------------------------ CORE ----------------------------------------

async function tryV2Launch(payload, label) {
  const res = await axios.post(
    'https://api.phantombuster.com/api/v2/agents/launch',
    payload,
    {
      params: { id: PHANTOM_AGENT_ID }, // harmless redundancy
      headers: {
        'X-Phantombuster-Key-1': PHANTOM_API_KEY,
        'Content-Type': 'application/json'
      },
      validateStatus: () => true
    }
  );

  if (DEBUG) {
    console.log(`[V2 ${label}] SENT:`, JSON.stringify(payload));
    console.log(`[V2 ${label}] STATUS:`, res.status);
    console.log(`[V2 ${label}] RESP:`, JSON.stringify(res.data));
  }

  return res;
}

async function launchPhantomV2(argumentsObject) {
  const argString = JSON.stringify(argumentsObject);

  // Variant A: id + argument (singular)
  const vA = {
    id: PHANTOM_AGENT_ID,
    argument: argString,
    output: 'json'
  };
  let res = await tryV2Launch(vA, 'A');
  if (res.data?.containerId) return res.data.containerId;

  // Variant B: id + arguments (plural)
  const vB = {
    id: PHANTOM_AGENT_ID,
    arguments: argString,
    output: 'json'
  };
  res = await tryV2Launch(vB, 'B');
  if (res.data?.containerId) return res.data.containerId;

  // Variant C: super defensive – duplicate id fields
  const vC = {
    id: PHANTOM_AGENT_ID,
    id2: PHANTOM_AGENT_ID,
    argument: argString,
    output: 'json'
  };
  res = await tryV2Launch(vC, 'C');
  if (res.data?.containerId) return res.data.containerId;

  const err = new Error('All v2 launch variants failed');
  err.v2A = res.data;
  throw err;
}

async function launchPhantomV1(argumentsObject) {
  const payload = {
    output: 'json',
    argument: JSON.stringify(argumentsObject) // v1 wants "argument" stringified
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
    console.log('[V1] SENT:', JSON.stringify(payload));
    console.log('[V1] STATUS:', res.status);
    console.log('[V1] RESP:', JSON.stringify(res.data));
  }

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

// --------------------------- BUSINESS ROUTE ---------------------------------

app.post('/get_linkedin_profiles', async (req, res) => {
  try {
    assertEnv();

    const { role, industry, organisation } = req.body;
    if (!role || !organisation) {
      return res.status(400).send('Missing role or organisation');
    }

    if (DEBUG) {
      console.log('[REQ BODY]', req.body);
      console.log('Agent ID:', PHANTOM_AGENT_ID);
      console.log('API Key (first 6):', mask(PHANTOM_API_KEY));
    }

    const args = { role, industry, organisation, numberOfProfiles: 10 };

    let containerId;
    try {
      containerId = await launchPhantomV2(args);
    } catch (e) {
      if (DEBUG) console.log('[V2 FAILED] Falling back to v1');
      containerId = await launchPhantomV1(args);
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

// ----------------------------- DIAGNOSTICS ----------------------------------

app.get('/debug_phantom', async (_req, res) => {
  try {
    assertEnv();
    const testArgs = { ping: true };

    let v2Result, v1Result, error;
    try {
      v2Result = await launchPhantomV2(testArgs);
    } catch (e) {
      v2Result = { error: e.message, v2A: e.v2A };
      try {
        v1Result = await launchPhantomV1(testArgs);
      } catch (e2) {
        v1Result = { error: e2.message, v1Response: e2.v1Response };
      }
    }

    res.json({
      env: {
        PHANTOMBUSTER_AGENT_ID: PHANTOMBUSTER_AGENT_ID,
        PHANTOMBUSTER_API_KEY_first6: mask(PHANTOMBUSTER_API_KEY)
      },
      v2Result,
      v1Result,
      error
    });
  } catch (err) {
    res.status(500).json({ error: err?.response?.data || err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log('Agent ID:', PHANTOM_AGENT_ID);
  console.log('API key (first 6):', mask(PHANTOMBUSTER_API_KEY));
});
