require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// Trim environment variables to avoid stray whitespace
const PHANTOM_API_KEY  = process.env.PHANTOMBUSTER_API_KEY?.trim();
const PHANTOM_AGENT_ID = process.env.PHANTOMBUSTER_AGENT_ID?.trim();
const PORT             = process.env.PORT || 3000;

// Health check
app.get('/', (_req, res) => {
  res.send('LinkedIn Profile API is running.');
});

// Disallow GET on main path
app.get('/get_linkedin_profiles', (_req, res) => {
  res.status(405).send('Use POST');
});

// Main POST endpoint
app.post('/get_linkedin_profiles', async (req, res) => {
  try {
    const { role, industry, organisation } = req.body;
    if (!role || !organisation) {
      return res.status(400).send('Missing role or organisation');
    }

    // 1. Launch the PhantomBuster agent using correct v2 endpoint and payload
    const launchRes = await axios.post(
      'https://api.phantombuster.com/api/v2/agents/launch',
      { 
        id: PHANTOM_AGENT_ID,                     // provide agent ID in payload
        argument: { role, industry, organisation, numberOfProfiles: 10 } 
      },
      { headers: { 
          'X-Phantombuster-Key-1': PHANTOM_API_KEY, 
          'Content-Type': 'application/json' 
        } 
      }
    );
    const containerId = launchRes.data.containerId;
    if (!containerId) {
      throw new Error('Failed to launch PhantomBuster agent');
    }

    // 2. Poll the container status until finished
    const POLL_INTERVAL = 5000;
    let status;
    do {
      const statusRes = await axios.get(
        `https://api.phantombuster.com/api/v2/containers/fetch?containerId=${containerId}`,
        { headers: { 'X-Phantombuster-Key-1': PHANTOM_API_KEY } }
      );
      status = statusRes.data.status;
      if (status === 'failed') {
        throw new Error('PhantomBuster execution failed');
      }
      if (status !== 'finished' && status !== 'done') {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
      }
    } while (status !== 'finished' && status !== 'done');

    // 3. Fetch the output data as JSON
    const outputRes = await axios.get(
      `https://api.phantombuster.com/api/v2/containers/fetch-output?containerId=${containerId}&output=json`,
      { headers: { 
          'X-Phantombuster-Key-1': PHANTOM_API_KEY,
          'Accept': 'application/json' 
        } 
      }
    );
    const outputData = outputRes.data;
    // Support both array or object output:
    let profiles = [];
    if (Array.isArray(outputData)) {
      profiles = outputData;
    } else if (outputData && outputData.profiles) {
      profiles = outputData.profiles;
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

// Start the server
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
