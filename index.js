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

app.post('/get_linkedin_profiles', async (req, res) => {
  const { role, industry, organisation } = req.body;
  if (!role || !organisation) return res.status(400).send("Missing role or organisation");

  const queryParts = [role];
  if (industry) queryParts.push(industry);
  if (organisation) queryParts.push(`"${organisation}"`);

  const query = encodeURIComponent(queryParts.join(' '));
  const linkedinSearchUrl = `https://www.linkedin.com/search/results/people/?keywords=${query}`;

  try {
    const launch = await axios.post(
      `https://api.phantombuster.com/api/v2/agents/launch`,
      {
        id: PHANTOM_AGENT_ID,
        arguments: {
          linkedinSearchUrl,
          numberOfProfiles: 10
        }
      },
      {
        headers: {
          'X-Phantombuster-Key-1': PHANTOM_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    const containerId = launch.data.containerId;

// Poll the container status until it's finished (or error)
const POLL_INTERVAL = 5000;  // ms
let finished = false;
while (!finished) {
  const statusRes = await axios.get(
    `https://api.phantombuster.com/api/v2/containers/fetch-status?id=${containerId}`,
    { headers: { 'X-Phantombuster-Key-1': PHANTOM_API_KEY } }
  );
  const { status } = statusRes.data;
  if (status === 'finished' || status === 'done') {
    finished = true;
  } else if (status === 'failed') {
    throw new Error('PhantomBuster agent execution failed');
  } else {
    // not done yet → wait and try again
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
}


    const result = await axios.get(
      `https://api.phantombuster.com/api/v2/containers/fetch-output?id=${containerId}`,
      {
        headers: { 'X-Phantombuster-Key-1': PHANTOM_API_KEY }
      }
    );

    const output = result.data.output || [];
    const profiles = output.slice(0, 5).map(p => ({
      name: p.name,
      job: p.jobTitle,
      company: p.companyName,
      location: p.location,
      profileUrl: p.profileUrl
    }));

    res.json({ profiles });
  } catch (error) {
    console.error(error?.response?.data || error.message);
    res.status(500).send("Error retrieving profiles");
  }
});

app.get('/', (req, res) => {
  res.send("LinkedIn Profile API is running.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
