# Concept Hierarchy Application

A web application for creating and navigating hierarchical concept graphs with voting functionality.

## Features

- **User Authentication**: Register and login with secure JWT tokens
- **Root Concepts**: Create and view top-level concepts
- **Hierarchical Navigation**: Click through concept hierarchies with breadcrumb navigation
- **Context-Aware Children**: Each concept can have different children depending on its parent path
- **Voting System**: Vote on child concepts to rank them
- **DAG Structure**: Prevents cycles within individual graphs

## Technology Stack

### Backend
- Node.js with Express
- PostgreSQL database
- JWT authentication
- bcrypt for password hashing

### Frontend
- React 18
- React Router for navigation
- Axios for API calls
- Vite for development and building

## Prerequisites

- Node.js (v16 or higher)
- PostgreSQL (v12 or higher)
- npm or yarn

## Installation

### 1. Clone or Download the Project

Navigate to the project directory:
```bash
cd concept-hierarchy-app
```

### 2. Set Up PostgreSQL Database

First, make sure PostgreSQL is installed and running on your system.

Create a new database:
```bash
# On macOS/Linux with PostgreSQL installed:
psql -U postgres

# In the PostgreSQL prompt:
CREATE DATABASE concept_hierarchy;
\q
```

Or use a GUI tool like pgAdmin to create the database.

### 3. Backend Setup

Navigate to the backend directory:
```bash
cd backend
```

Install dependencies:
```bash
npm install
```

Create a `.env` file by copying the example:
```bash
cp .env.example .env
```

Edit the `.env` file with your database credentials:
```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=concept_hierarchy
DB_USER=postgres
DB_PASSWORD=your_postgres_password

PORT=5000
NODE_ENV=development

JWT_SECRET=your-secret-key-here-change-this
JWT_EXPIRES_IN=7d
```

Run the database migration to create tables:
```bash
npm run migrate
```

You should see: "Database tables created successfully!"

### 4. Frontend Setup

Open a new terminal and navigate to the frontend directory:
```bash
cd frontend
```

Install dependencies:
```bash
npm install
```

## Running the Application

### Start the Backend Server

In the backend directory:
```bash
npm run dev
```

The server will start on `http://localhost:5000`

You should see:
```
Server is running on port 5000
Environment: development
```

### Start the Frontend Development Server

In a new terminal, from the frontend directory:
```bash
npm run dev
```

The frontend will start on `http://localhost:3000`

You should see:
```
  VITE v5.x.x  ready in xxx ms

  ➜  Local:   http://localhost:3000/
```

## Using the Application

1. **Register**: Navigate to `http://localhost:3000` and click "Register here" to create an account
2. **Login**: After registration, you'll be automatically logged in
3. **Create Root Concepts**: Click the "+ Add Root Concept" button to create your first concepts
4. **Navigate**: Click on any concept to view its children
5. **Add Children**: Within a concept, click "+ Add Child Concept" to add children in that context
6. **Vote**: Click the vote button (▲) to vote for child concepts
7. **Navigate with Breadcrumbs**: Use the breadcrumb trail at the top to navigate back through the hierarchy

## Project Structure

```
concept-hierarchy-app/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   ├── database.js          # PostgreSQL connection
│   │   │   └── migrate.js           # Database schema migration
│   │   ├── controllers/
│   │   │   ├── authController.js    # Authentication logic
│   │   │   ├── conceptsController.js # Concepts CRUD
│   │   │   └── votesController.js   # Voting logic
│   │   ├── middleware/
│   │   │   └── auth.js              # JWT authentication middleware
│   │   ├── routes/
│   │   │   ├── auth.js              # Auth routes
│   │   │   ├── concepts.js          # Concept routes
│   │   │   └── votes.js             # Vote routes
│   │   └── server.js                # Express server setup
│   ├── .env.example
│   └── package.json
│
└── frontend/
    ├── src/
    │   ├── components/
    │   │   ├── AddConceptModal.jsx  # Modal for adding concepts
    │   │   ├── Breadcrumb.jsx       # Navigation breadcrumb
    │   │   ├── ConceptGrid.jsx      # Grid display for concepts
    │   │   └── ProtectedRoute.jsx   # Route protection
    │   ├── contexts/
    │   │   └── AuthContext.jsx      # Authentication state management
    │   ├── pages/
    │   │   ├── Concept.jsx          # Concept view with children
    │   │   ├── Login.jsx            # Login page
    │   │   ├── Register.jsx         # Registration page
    │   │   └── Root.jsx             # Root concepts page
    │   ├── services/
    │   │   └── api.js               # API service layer
    │   ├── App.jsx                  # Main app component
    │   ├── main.jsx                 # Entry point
    │   └── index.css                # Global styles
    ├── index.html
    ├── vite.config.js
    └── package.json
```

## Database Schema

### Users Table
- `id`: Primary key
- `username`: Unique username
- `email`: Unique email
- `password_hash`: Bcrypt hashed password
- `created_at`: Timestamp

### Concepts Table
- `id`: Primary key
- `name`: Concept name
- `created_by`: User who created it
- `created_at`: Timestamp

### Edges Table
- `id`: Primary key
- `parent_id`: References concepts(id)
- `child_id`: References concepts(id)
- `graph_path`: Array of concept IDs representing the path from root
- `created_by`: User who created the edge
- `created_at`: Timestamp
- Unique constraint on (parent_id, child_id, graph_path)

### Votes Table
- `id`: Primary key
- `user_id`: References users(id)
- `edge_id`: References edges(id)
- `created_at`: Timestamp
- Unique constraint on (user_id, edge_id)

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user (protected)

### Concepts
- `GET /api/concepts/root` - Get all root concepts (protected)
- `GET /api/concepts/:id?path=...` - Get concept with children (protected)
- `POST /api/concepts/root` - Create root concept (protected)
- `POST /api/concepts/child` - Create child concept (protected)

### Votes
- `POST /api/votes/add` - Add vote to edge (protected)
- `POST /api/votes/remove` - Remove vote from edge (protected)

## Development Notes

### Current MVP Features
✅ User authentication
✅ Root concept management
✅ Hierarchical navigation with breadcrumbs
✅ Context-aware children
✅ Voting system
✅ DAG cycle prevention

### Future Enhancements (Planned)
- Flip view (see all parent contexts for a concept)
- Search functionality
- Vote removal UI
- Enhanced breadcrumb with concept names
- Improved error handling and user feedback
- Flip view voting
- Advanced cycle detection

## Troubleshooting

### Database Connection Issues
- Make sure PostgreSQL is running
- Check your `.env` file credentials
- Verify the database exists: `psql -U postgres -l`

### Port Already in Use
- Backend: Change `PORT` in `.env`
- Frontend: Change port in `vite.config.js`

### Authentication Issues
- Clear localStorage in browser dev tools
- Check that JWT_SECRET is set in `.env`
- Verify the backend is running

## License

MIT

## Contributing

This is a personal project, but suggestions and improvements are welcome!
