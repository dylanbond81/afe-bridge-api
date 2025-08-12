# AFE Bridge API

Node.js Express API for accessing AFE (Authorization for Expenditure) data from SQL Server.

## Environment Variables

Set these in your deployment platform:

```
PORT=4000
SQL_USER=afe_app
SQL_PASSWORD=StrongPassword!123
SQL_SERVER_HOST=calsqld02
SQL_INSTANCE_NAME=SQLDEV
SQL_DATABASE=AFENexus
SQL_ENCRYPT=false
SQL_TRUST_SERVER_CERTIFICATE=true
API_KEY=YourRandom32CharKeyHere
```

## Endpoints

- `GET /afe/` - Health check
- `GET /afe/list` - List AFEs (table view)
- `GET /afe/search-text?q=query` - Text search AFEs
- `POST /afe/search` - Get detailed AFE data

## Deploy to Railway

1. Fork/upload this repo to GitHub
2. Connect to Railway
3. Set environment variables
4. Deploy
