const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();
const app = express();
app.use(express.json());

const PHANTOM_API_KEY = process.env.PHANTOMBUSTER_API_KEY;
const PHANTOM_AGENT_ID = process.env.PHANTOMBUSTER_AGENT_ID;

app.post('/get_linkedin_profiles', async (req, res) => {
  const { role, industry } = req.body;

  if (!role) return res.status(400).send("Missing role");

  const query = encodeURIComponent(`${role} ${industry || ''}`);
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

    // Wait for the phantom to finish
    await new Promise(resolve => setTimeout(resolve, 12000));

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
