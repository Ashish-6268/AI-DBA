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
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

/* ===========================
   POSTGRES CONFIG
   (Use SSL for Neon/Supabase/Railway)
=========================== */
const pool = new pg.Pool({
  connectionString: process.env.STAGING_DB_URL,
  ssl: false
});

/* ===========================
   SQL SAFETY GUARD
=========================== */
function isSafeQuery(query) {
  const lower = query.toLowerCase();
  return (
    lower.startsWith("select") &&
    !lower.includes("insert") &&
    !lower.includes("update") &&
    !lower.includes("delete") &&
    !lower.includes("drop") &&
    !lower.includes("alter") &&
    !lower.includes("truncate") &&
    !lower.includes("create") &&
    !lower.includes(";")
  );
}

/* ===========================
   CHAT ENDPOINT
=========================== */
app.post("/chat", async (req, res) => {
  try {
    const userMessage = req.body.message;

    /* 1️⃣ Generate SQL */
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: `
You are a Postgres SQL expert.

Rules:
- Only generate SELECT queries
- Always add LIMIT 20
- Never modify data
- No markdown
- No backticks
- No explanation
- Start directly with SELECT
`,
        },
        { role: "user", content: userMessage },
      ],
    });

    let sqlQuery = completion.choices[0].message.content.trim();
    sqlQuery = sqlQuery
      .replace(/```sql/gi, "")
      .replace(/```/g, "")
      .trim();

    console.log("Generated SQL:", sqlQuery);

    if (!isSafeQuery(sqlQuery)) {
      return res.status(400).json({
        error: "Unsafe query blocked.",
        sql: sqlQuery,
      });
    }

    /* 2️⃣ Execute Query */
    const result = await pool.query(sqlQuery);

    /* 3️⃣ Summarize Result */
    const summary = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: "Summarize database results clearly for a business user.",
        },
        {
          role: "user",
          content: `SQL: ${sqlQuery}\n\nResult: ${JSON.stringify(
            result.rows
          )}`,
        },
      ],
    });

    res.json({
      sql: sqlQuery,
      answer: summary.choices[0].message.content,
      rows: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something broke." });
  }
});

/* ===========================
   START SERVER
=========================== */
app.listen(5000, () => {
  console.log("🚀 Server running on port 5000");
});