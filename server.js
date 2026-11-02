import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pg from "pg";
import Groq from "groq-sdk";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

/* ===========================
   GROQ CONFIG
=========================== */
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const LLM_MODEL = "openai/gpt-oss-20b";

/* ===========================
   POSTGRES CONFIG
=========================== */
const pool = new pg.Pool({
  connectionString: process.env.STAGING_DB_URL,
  ssl: false,
});

/* ===========================
   SQL SAFETY GUARD
=========================== */
function isSafeQuery(query) {
  const lower = query.toLowerCase();
  const hasDangerousKeyword = /\b(insert|update|delete|drop|alter|truncate|create)\b/.test(lower);
  return lower.startsWith("select") && !hasDangerousKeyword;
}

/* ===========================
   SCHEMA CACHE
=========================== */
let cachedSchema = "";
let cachedTableNames = "";

async function loadSchema() {
  try {
    const tables = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    const schemaInfo = [];
    for (const table of tables.rows) {
      const columns = await pool.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = $1
        ORDER BY ordinal_position
      `, [table.table_name]);

      schemaInfo.push(
        `${table.table_name}(${columns.rows.map(c => c.column_name).join(", ")})`
      );
    }

    cachedSchema = schemaInfo.join("\n");
    cachedTableNames = tables.rows.map(t => t.table_name).join(", ");
    console.log(`✅ Schema loaded: ${tables.rows.length} tables, ${cachedSchema.length} chars`);
  } catch (err) {
    console.error("❌ Schema load failed:", err.message);
  }
}

await loadSchema();

/* ===========================
   STEP 1: PICK BEST TABLE
   (uses only table names to stay under token limits)
=========================== */
async function pickRelevantTables(userMessage) {
  const response = await groq.chat.completions.create({
    model: LLM_MODEL,
    messages: [
      {
        role: "system",
        content: `You are a database expert. Given a user question and a list of table names, identify the 1-3 most relevant tables to answer the question.

Tables: ${cachedTableNames}

Known mappings:
- "live sessions" → live_sessions (use scheduled_at for dates)
- "signups" or "users" → users (use created_at for dates)
- "weekly winners" or "winner" or "score" → weekly_winners (full name in first_name, score in score column)
- "teachers" → teachers
- "batches" → batches
- "classes" → classes
- "quizzes" → quizzes
- "payments" → payments

Reply with ONLY a comma-separated list of table names. Nothing else. Example: weekly_winners,users`
      },
      { role: "user", content: userMessage }
    ]
  });

  const raw = response.choices[0].message.content.trim();
  const tables = raw.split(",").map(t => t.trim()).filter(Boolean);
  console.log("📌 Relevant tables:", tables);
  return tables;
}

/* ===========================
   STEP 2: GENERATE SQL
   (uses only focused schema for selected tables)
=========================== */
async function generateSQL(userMessage, relevantTables) {
  // Get focused schema for just the relevant tables
  const focusedSchema = cachedSchema
    .split("\n")
    .filter(line => relevantTables.some(t => line.startsWith(t + "(")))
    .join("\n");

  const response = await groq.chat.completions.create({
    model: LLM_MODEL,
    messages: [
      {
        role: "system",
        content: `You are a PostgreSQL SQL generator for an edtech app called Instapreps.

Tables and columns for this query:
${focusedSchema || cachedSchema}

Rules:
- Only generate SELECT queries
- ONLY use tables and columns that exist in the schema above
- Add LIMIT 20 unless user asks for a count or aggregate
- If user asks for count/total/how many, use COUNT(*) with no LIMIT
- No markdown, no backticks, no explanation
- Start directly with SELECT
- Return SQL only
- In ALL tables, full name is stored in first_name column only — never use last_name for name searches
- For name searches always use: first_name ILIKE '%name%'
- For date filtering use: EXTRACT(YEAR FROM col) = 2025 or col >= '2025-01-01' AND col < '2026-01-01'
- Never use NOW() - INTERVAL for year/month filtering
- For weekly_winners: score is in score column, name is in first_name, date is created_at`
      },
      { role: "user", content: userMessage }
    ]
  });

  let sql = response.choices[0].message.content.trim();
  sql = sql.replace(/```sql/gi, "").replace(/```/g, "").trim();
  return sql;
}

/* ===========================
   CHAT ENDPOINT
=========================== */
app.post("/chat", async (req, res) => {
  try {
    const userMessage = req.body.message;

    if (!cachedSchema) {
      return res.status(500).json({ error: "Schema not loaded. Check DB connection." });
    }

    // Step 1: Pick relevant tables
    const relevantTables = await pickRelevantTables(userMessage);

    // Step 2: Generate SQL with focused context
    const sqlQuery = await generateSQL(userMessage, relevantTables);

    console.log("Generated SQL:", sqlQuery);

    if (!isSafeQuery(sqlQuery)) {
      console.warn("Blocked SQL:", sqlQuery);
      return res.status(400).json({ error: "Unsafe query blocked.", sql: sqlQuery });
    }

    // Step 3: Execute Query
    const result = await pool.query(sqlQuery);

    // Step 4: Summarize Result
    const summary = await groq.chat.completions.create({
      model: LLM_MODEL,
      messages: [
        {
          role: "system",
          content: "Summarize database query results clearly and concisely for a business user. Be direct and specific with numbers and names.",
        },
        {
          role: "user",
          content: `Question: ${userMessage}\nSQL: ${sqlQuery}\nResult: ${JSON.stringify(result.rows)}`,
        },
      ],
    });

    res.json({
      sql: sqlQuery,
      answer: summary.choices[0].message.content,
      rows: result.rows,
    });

  } catch (err) {
    console.error("Request error:", err.message);
    res.status(500).json({ error: err.message || "Something broke." });
  }
});

/* ===========================
   DEBUG: VIEW SCHEMA
=========================== */
app.get("/schema", (req, res) => {
  res.send(`<pre>${cachedSchema}</pre>`);
});

/* ===========================
   START SERVER
=========================== */
app.listen(5000, () => {
  console.log("🚀 Server running on port 5000");
});
