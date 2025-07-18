# LinkedIn GPT API (via Phantombuster)

This API receives a job role and industry, searches LinkedIn using Phantombuster, and returns summarized profiles for use in a Custom GPT.

## Setup

1. Clone the project in Replit.
2. Set `.env` with your:
   - `PHANTOMBUSTER_API_KEY`
   - `PHANTOMBUSTER_AGENT_ID` (LinkedIn Search Export)
3. Click "Run" to start your server.

Use the POST endpoint:  
`/get_linkedin_profiles`  
with a JSON body:
```json
{
  "role": "sustainability director",
  "industry": "chemicals"
}
