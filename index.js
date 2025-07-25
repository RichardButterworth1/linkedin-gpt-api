require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PHANTOM_API_KEY  = process.env.PHANTOMBUSTER_API_KEY?.trim();
const PHANTOM_AGENT_ID = process.env.PHANTOMBUSTER_AGENT_ID?.trim();
const PORT             = process.env.PORT || 3000;

app.get('/', (_req, res) => {
  res.send('LinkedIn Profile API is running.');
});

app.get('/get_linkedin_profiles', (_req, res) => {
  res.status(405).send('Use POST');
});

app.post('/get_linkedin_profiles', async (req, res) => {
  try {
    const { role, industry, organisation } = req.body;
    if (!role || !organisation) {
      return res.status(400).send('Missing role or organisation');
    }

    if (!PHANTOM_API_KEY || !PHANTOM_AGENT_ID) {
      return res.status(500).json({ message: 'Server misconfiguration: missing PHANTOMBUSTER env vars' });
    }

// Launch the PhantomBuster agent
const launchRes = await axios.post(
  'https://api.phantombuster.com/api/v2/agents/launch',
  {
    id: PHANTOM_AGENT_ID,
    argument: JSON.stringify({ role, industry, organisation, numberOfProfiles: 10 })
  },
  {
    params: { id: PHANTOM_AGENT_ID },
    headers: {
      'X-Phantombuster-Key-1': PHANTOM_API_KEY,
      'Content-Type': 'application/json'
    }
  }
);
    const containerId = launchRes.data?.containerId;
    if (!containerId) {
      throw new Error(`Launch failed: ${JSON.stringify(launchRes.data)}`);
    }

    // --- 2) Poll until finished
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
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
      }
    } while (status !== 'finished' && status !== 'done');

    // --- 3) Fetch output
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
    let profiles = [];
    if (Array.isArray(data)) {
      profiles = data;
    } else if (data && data.profiles) {
      profiles = data.profiles;
    }

    res.json({ profiles });

  } catch (error) {
    console.error(error?.response?.data || error.message);
    res.status(500).json({
      message: 'Error retrieving profiles',
      detail: error?.response?.data || error.message
    });
  }
});

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
