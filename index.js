require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// Trim environment variables to avoid stray whitespace
const PHANTOM_API_KEY   = process.env.PHANTOMBUSTER_API_KEY?.trim();
const PHANTOM_AGENT_ID  = process.env.PHANTOMBUSTER_AGENT_ID?.trim();
const PORT              = process.env.PORT || 3000;

// Health check endpoint
app.get('/', (req, res) => {
  res.send('LinkedIn Profile API is running.');
});

// Disallow GET on the main connector path
app.get('/get_linkedin_profiles', (req, res) => {
  res.status(405).send('Use POST');
});

// Main POST endpoint to retrieve LinkedIn profiles
app.post('/get_linkedin_profiles', async (req, res) => {
  try {
    const { role, industry, organisation } = req.body;
    if (!role || !organisation) {
      return res.status(400).send('Missing role or organisation');
    }

    // Launch the PhantomBuster agent
    const launchRes = await axios.post(
      `https://api.phantombuster.com/api/v2/agents/${PHANTOM_AGENT_ID}/launch`,
      {
        argument: { role, industry, organisation, numberOfProfiles: 10 }
      },
      {
        headers: {
          'X-Phantombuster-Key-1': PHANTOM_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    const containerId = launchRes.data.containerId;

    // Poll the container status until finished
    const POLL_INTERVAL = 5000;
    let finished = false;
    while (!finished) {
      const statusRes = await axios.get(
        `https://api.phantombuster.com/api/v2/containers/fetch?id=${containerId}`,
        { headers: { 'X-Phantombuster-Key-1': PHANTOM_API_KEY } }
      );
      const status = statusRes.data.status;
      if (status === 'finished' || status === 'done') {
        finished = true;
      } else if (status === 'failed') {
        throw new Error('PhantomBuster execution failed');
      } else {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
      }
    }

    // Fetch the real output once the run is complete
    const outputRes = await axios.get(
      `https://api.phantombuster.com/api/v2/containers/fetch-output?id=${containerId}`,
      {
        headers: {
          'X-Phantombuster-Key-1': PHANTOM_API_KEY,
          Accept: 'application/json'
        }
      }
    );
    const profiles = outputRes.data.profiles || [];
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
