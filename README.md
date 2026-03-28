# Orca

Orca is an open-source collaborative platform for academic researchers to build shared concept hierarchies and annotate research documents.

Users organize concepts into hierarchical graphs, annotate uploaded documents against those concept structures, and curate quality through transparent community voting. All activity is public and attributed — Orca emphasizes productive contestation over forced consensus.

## Tech Stack

- **Frontend:** React, Vite
- **Backend:** Node.js, Express
- **Database:** PostgreSQL

## Getting Started

### Prerequisites

- Node.js (v18+)
- PostgreSQL (v16+)
- A Twilio account (for phone OTP authentication)

### Setup

1. Clone this repository
2. Copy `backend/.env.example` to `backend/.env` and fill in your database credentials, JWT secret, and Twilio API keys
3. Install dependencies:
   ```
   cd backend && npm install
   cd ../frontend && npm install
   ```
4. Run the database migration:
   ```
   cd backend && npm run migrate
   ```
5. Start the backend and frontend dev servers in separate terminals:
   ```
   cd backend && npm run dev
   cd frontend && npm run dev
   ```

## Documentation

See [ORCA_STATUS.md](ORCA_STATUS.md) for detailed technical documentation including database schema, API endpoints, architecture decisions, and development history.

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).

This means you are free to use, modify, and distribute this software, but if you run a modified version as a network service, you must make your source code available to users of that service under the same license.

## Contributing

Orca is in active early development. If you're interested in contributing, please open an issue to discuss your idea before submitting a pull request.
