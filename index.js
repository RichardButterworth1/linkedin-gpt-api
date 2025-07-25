require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PHANTOM_API_KEY  = process.env.PHANTOMBUSTER_API_KEY?.trim();
const PHANTOM_AGENT_ID = process.env.PHANTOMBUSTER_AGENT_ID?.trim();
const PORT             = process.env.PORT || 3000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function assertEnv() {
  if (!PHANTOM_API_KEY)  throw new Error('Missing PHANTOMBUSTER_API_KEY');
  if (!PHANTOM_AGENT_ID) throw new Error('Missing PHANTOMBUSTER_AGENT_ID');
}

// Health
app.get('/', (_req, res) => res.send('LinkedIn Profile API is running.'));
app.get('/get_linkedin_profiles', (_req, res) => res.status(405).send('Use POST'));

/**
 * Launch agent (v1 **only**)
 * Endpoint: POST /api/v1/agent/:id/launch
 * Body: { output: "json", argument: "<stringified JSON>" }
 */
async function launchV1(args) {
  const resp = await axios.post(
    `https://api.phantombuster.com/api/v1/agent/${PHANTOM_AGENT_ID}/launch`,
    {
      output: 'json',
      argument: JSON.stringify(args)
    },
    {
      headers: {
        'X-Phantombuster-Key-1': PHANTOM_API_KEY,
        'Content-Type': 'application/json'
      }
    }
  );

  const containerId = resp?.data?.data?.containerId || resp?.data?.containerId;
  if (!containerId) {
    throw new Error(`v1 launch failed: ${JSON.stringify(resp.data)}`);
  }
  return containerId;
}

/**
 * Poll container status (v1 **only**)
 * Endpoint: GET /api/v1/containers/fetch?id=<containerId>
 * Returns status: running|finished|failed
 */
async function pollUntilDoneV1(containerId) {
  const POLL_INTERVAL = 5000;
  let status;
  do {
    const statusRes = await axios.get(
      'https://api.phantombuster.com/api/v1/containers/fetch',
      {
        params: { id: containerId },
        headers: { 'X-Phantombuster-Key-1': PHANTOM_API_KEY }
      }
    );

    status = statusRes.data?.data?.status || statusRes.data?.status;
    if (status === 'failed') {
      throw new Error(`PhantomBuster execution failed: ${JSON.stringify(statusRes.data)}`);
    }
    if (status !== 'finished' && status !== 'done') {
      await sleep(POLL_INTERVAL);
    }
  } while (status !== 'finished' && status !== 'done');
}

/**
 * Fetch output (v1 **only**)
 * Endpoint: GET /api/v1/containers/fetch-output?id=<containerId>&output=json
 */
async function fetchOutputV1(containerId) {
  const outputRes = await axios.get(
    'https://api.phantombuster.com/api/v1/containers/fetch-output',
    {
      params: { id: containerId, output: 'json' },
      headers: {
        'X-Phantombuster-Key-1': PHANTOM_API_KEY,
        'Accept': 'application/json'
      }
    }
  );

  // v1 wraps payload in data
  const payload = outputRes.data?.data ?? outputRes.data;

  if (Array.isArray(payload)) return payload;
  if (payload && payload.profiles) return payload.profiles;
  return payload || [];
}

// Main endpoint
app.post('/get_linkedin_profiles', async (req, res) => {
  try {
    assertEnv();

    const { role, industry, organisation } = req.body;
    if (!role || !organisation) {
      return res.status(400).send('Missing role or organisation');
    }

    const args = { role, industry, organisation, numberOfProfiles: 10 };

    const containerId = await launchV1(args);
    await pollUntilDoneV1(containerId);
    const profiles = await fetchOutputV1(containerId);

    res.json({ profiles });
  } catch (error) {
    console.error(error?.response?.data || error.message);
    res.status(500).json({
      message: 'Error retrieving profiles',
      detail: error?.response?.data || error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log('Agent ID:', PHANTOM_AGENT_ID);
  console.log('API key present:', !!PHANTOM_API_KEY);
  console.log('** THIS BUILD USES PHANTOMBUSTER API v1 ONLY (no v2 launch) **');
});
