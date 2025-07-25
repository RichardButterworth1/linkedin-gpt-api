const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();
const app = express();
app.use(express.json());

const PHANTOM_API_KEY = process.env.PHANTOMBUSTER_API_KEY;
const PHANTOM_AGENT_ID = process.env.PHANTOMBUSTER_AGENT_ID;

app.get('/get_linkedin_profiles', (req, res) => {
  res.status(405).send('Use POST');
});

app.post('/get_linkedin_profiles', async (req, res) => {
  try {
    const { role, industry, organisation } = req.body;
    if (!role || !organisation) {
      return res.status(400).send("Missing role or organisation");
    }

    // launch your PhantomBuster agent…
const launch = await axios.post(
'https://api.phantombuster.com/api/v2/agents/launch?id=${PHANTOM_AGENT_ID}',
{
  argument: {
    role,
    industry,
    organisation,
    numberOfProfiles: 10
  }
},
{
  headers: {
    'X-Phantombuster-Key-1': PHANTOM_API_KEY,
    'Content-Type': 'application/json'
  }
});
    const containerId = launch.data.containerId;

    // ————— Poll until the container is finished —————
    const POLL_INTERVAL = 5000;  // every 5s
    let finished = false;
    while (!finished) {
      const statusRes = await axios.get(
        'https://api.phantombuster.com/api/v2/containers/fetch-status?id=${containerId}',
        { headers: { 'X-Phantombuster-Key-1': PHANTOM_API_KEY } }
      );

      const status = statusRes.data.status;
      if (status === 'finished' || status === 'done') {
        finished = true;
      } else if (status === 'failed') {
        throw new Error('PhantomBuster execution failed');
      } else {
        // not done yet → wait then re‑check
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
      }
    }  // ← closes 'while'

    // Once done, fetch the real output
    const result = await axios.get(
      'https://api.phantombuster.com/api/v2/containers/fetch-output?id=${containerId}',
      { headers: { 'X-Phantombuster-Key-1': PHANTOM_API_KEY } }
    );
    const profiles = result.data.profiles || [];
    res.json({ profiles });

  } catch (error) {
    console.error(error?.response?.data || error.message);
    res.status(500).send("Error retrieving profiles");
  }
});  // ← closes app.post

// …then your other routes…
app.get('/', (req, res) => {
  res.send("LinkedIn Profile API is running.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server listening on port ${PORT}'));