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

// Launch Phantom via v1
async function launchViaV1(args) {
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
  const containerId = resp.data?.data?.containerId || resp.data?.containerId;
  if (!containerId) throw new Error(`Launch failed: ${JSON.stringify(resp.data)}`);
  return containerId;
}

// Poll status using v2
async function pollUntilDoneV2(containerId) {
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
    if (status === 'failed') {
      throw new Error(`PhantomBuster execution failed: ${JSON.stringify(statusRes.data)}`);
    }
    if (status !== 'finished' && status !== 'done') {
      await sleep(POLL_INTERVAL);
    }
  } while (status !== 'finished' && status !== 'done');
}

// Fetch output using v2
async function fetchOutputV2(containerId) {
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
  const data = outputRes.data;
  if (Array.isArray(data)) return data;
  if (data && data.profiles) return data.profiles;
  return data || [];
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
    const containerId = await launchViaV1(args);

    await pollUntilDoneV2(containerId);
    const profiles = await fetchOutputV2(containerId);

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
  console.log('Launching via v1, polling/output via v2 (hybrid mode)');
});
