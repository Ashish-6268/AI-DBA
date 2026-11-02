# 🤖 AI-DBA — AI Database Agent

An AI-powered natural-language interface to a PostgreSQL database. Ask questions in plain English and get back answers, generated SQL, and raw query results — all through a simple chat UI.

Built for **Instapreps** (an edtech platform), AI-DBA lets non-technical users query production data without writing SQL. It uses a **3-stage LLM pipeline** powered by Groq (`openai/gpt-oss-20b`) to translate questions into safe, read-only SQL queries and summarise the results.

---

## ✨ Key Features

- **Natural-language querying** — ask questions like *"How many users signed up in 2025?"* and get instant answers.
- **3-stage LLM pipeline** — table selection → SQL generation → result summarisation (details below).
- **SQL safety guard** — only `SELECT` queries are executed; any `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, or `CREATE` is blocked automatically.
- **Schema auto-discovery** — the database schema is introspected and cached on startup so the LLM always has accurate table/column information.
- **Chat UI** — a lightweight, self-contained HTML/CSS/JS frontend with a chat interface (no build step required).
- **Debug endpoint** — visit `/schema` to inspect the cached database schema.

---

## 🔁 The 3-Stage LLM Pipeline

Every user question flows through three sequential LLM calls:

```
User Question
     │
     ▼
┌──────────────────────┐
│ Stage 1: Table Picker│  Identifies the 1–3 most relevant tables
│ (Groq LLM)           │  from the schema's table names.
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Stage 2: SQL Generator│  Generates a read-only SELECT query using
│ (Groq LLM)            │  the focused schema of the selected tables.
└──────────┬────────────┘
           │  SQL is validated by the safety guard,
           │  then executed against PostgreSQL.
           ▼
┌──────────────────────┐
│ Stage 3: Summariser  │  Summarises the query results into a concise,
│ (Groq LLM)           │  business-friendly answer.
└──────────────────────┘
           │
           ▼
   JSON response: { sql, answer, rows }
```

---

## 🛠 Tech Stack

| Layer       | Technology                                |
| ----------- | ----------------------------------------- |
| **Backend** | Node.js, Express 5                        |
| **LLM**     | Groq API (`groq-sdk`) — `openai/gpt-oss-20b` |
| **Database**| PostgreSQL (`pg`)                          |
| **Frontend**| Vanilla HTML / CSS / JavaScript           |
| **Config**  | `dotenv` for environment variables         |
| **Other**   | `cors` for cross-origin requests           |

---

## 📁 Project Structure

```
ai-dba/
├── server.js        # Express backend — LLM pipeline, DB queries, API endpoints
├── index.html       # Chat UI frontend (open directly in a browser)
├── package.json     # npm dependencies and project metadata
├── .env             # Environment variables (GROQ_API_KEY, STAGING_DB_URL) — not committed
├── .gitignore       # Ignores .env and node_modules/
└── README.md        # This file
```

| File             | Purpose |
| ---------------- | ------- |
| `server.js`      | The entire backend: connects to PostgreSQL, caches the schema, defines the 3-stage LLM pipeline (`pickRelevantTables` → `generateSQL` → summarise), exposes `POST /chat` and `GET /schema` endpoints, and runs the Express server on port **5000**. |
| `index.html`     | Self-contained chat UI that sends user messages to `http://localhost:5000/chat` and displays the answer, generated SQL, and any errors. No build step needed. |
| `package.json`   | Declares the project as an ES module (`"type": "module"`) and lists six dependencies: `express`, `cors`, `dotenv`, `pg`, `groq-sdk`, and `openai`. |
| `.env`           | Stores `GROQ_API_KEY` and `STAGING_DB_URL`. **Must be created manually; never commit this file.** |

---

## 📋 Prerequisites

- **Node.js** — v18 or later (the project uses top-level `await` and ES modules)
- **npm** — comes with Node.js
- **PostgreSQL** — a running instance with an accessible database
- **Groq API key** — sign up at [console.groq.com](https://console.groq.com) to get a free API key

---

## ⚙️ Environment Variables

Create a `.env` file in the project root with the following variables:

```env
GROQ_API_KEY=your_groq_api_key_here
STAGING_DB_URL=postgresql://username:password@host:port/database
```

| Variable         | Description |
| ---------------- | ----------- |
| `GROQ_API_KEY`   | Your Groq API key (starts with `gsk_`). Get one from [console.groq.com](https://console.groq.com). |
| `STAGING_DB_URL` | PostgreSQL connection string. Format: `postgresql://user:password@host:port/dbname`. SSL is disabled in the code (`ssl: false`). |

> [!CAUTION]
> Never commit your `.env` file. It is already listed in `.gitignore`.

---

## 🐘 PostgreSQL Configuration

The server connects to PostgreSQL using the `STAGING_DB_URL` connection string via the `pg` library. On startup it:

1. Queries `information_schema.tables` for all tables in the `public` schema.
2. Queries `information_schema.columns` for each table to get column names.
3. Caches the schema in memory as a compact string (e.g. `users(id, first_name, email, created_at)`).

**What you need:**
- A PostgreSQL server accessible from where you run the app.
- A database with tables in the `public` schema.
- A user with at least `SELECT` privileges on those tables and `information_schema`.

If you're testing locally, you can set up a local PostgreSQL database:

```bash
# Example: create a local test database
psql -U postgres -c "CREATE DATABASE testdb;"
```

Then set `STAGING_DB_URL=postgresql://postgres:yourpassword@localhost:5432/testdb` in `.env`.

---

## 🚀 Setup & Run

### 1. Clone the repository

```bash
git clone https://gitlab.com/ananyasamadhiya9/ai-dba.git
cd ai-dba
```

### 2. Install dependencies

```bash
npm install
```

This installs: `express`, `cors`, `dotenv`, `pg`, `groq-sdk`, and `openai`.

### 3. Create the `.env` file

```bash
# Linux / macOS
cp .env.example .env   # or create manually

# Windows (PowerShell)
New-Item .env
```

Edit `.env` and fill in your `GROQ_API_KEY` and `STAGING_DB_URL` (see [Environment Variables](#️-environment-variables)).

### 4. Start the server

```bash
node server.js
```

You should see:

```
✅ Schema loaded: <N> tables, <N> chars
🚀 Server running on port 5000
```

### 5. Open the chat UI

Open `index.html` directly in your browser (double-click the file, or use a local file server). The frontend sends requests to `http://localhost:5000/chat`.

---

## 💬 Sample Interaction

**You type:** *"How many users signed up in 2025?"*

The 3-stage pipeline runs:

1. **Table Picker** → selects `users`
2. **SQL Generator** → produces:
   ```sql
   SELECT COUNT(*) FROM users WHERE EXTRACT(YEAR FROM created_at) = 2025
   ```
3. **Safety Guard** → passes (it's a `SELECT` with no dangerous keywords)
4. **Query Execution** → runs against PostgreSQL
5. **Summariser** → returns something like: *"A total of 1,234 users signed up in 2025."*

**Response in the chat UI:**

> **Answer:** A total of 1,234 users signed up in 2025.
>
> **SQL:**
> ```sql
> SELECT COUNT(*) FROM users WHERE EXTRACT(YEAR FROM created_at) = 2025
> ```

---

## 🔗 API Reference

### `POST /chat`

Send a natural-language question and receive the generated SQL, query results, and a summary.

**Request:**
```json
{
  "message": "Who are the top 5 weekly winners?"
}
```

**Response:**
```json
{
  "sql": "SELECT first_name, score FROM weekly_winners ORDER BY score DESC LIMIT 5",
  "answer": "The top 5 weekly winners are ...",
  "rows": [
    { "first_name": "Alice", "score": 98 },
    { "first_name": "Bob", "score": 95 }
  ]
}
```

### `GET /schema`

Returns the cached database schema as preformatted HTML. Useful for debugging.

---

## 📝 Notes

- The LLM model is configured via `LLM_MODEL` in `server.js` (currently set to **`openai/gpt-oss-20b`** via the Groq API). Stage 1 optimizes token usage by supplying table names only, and Stage 2 injects the focused schema for only the matched tables to stay safely within free-tier token-per-minute (TPM) limits on large schemas (180+ tables).
- The `openai` package is listed in `package.json` as a dependency but is **not used** in the current `server.js` code. It may have been used during development or kept for future use.
- The server listens on **port 5000** (hardcoded in `server.js`).
- The frontend is a static HTML file that communicates with the backend at `http://localhost:5000/chat` — if you change the port, update the `fetch` URL in `index.html` as well.
- The SQL safety guard is a regex-based allowlist — it only permits queries that start with `SELECT` and don't contain write keywords. It is not a substitute for proper database-level access controls.
