export const prerender = false;

import mysql from "mysql2/promise";

type DFReq = {
  queryResult?: {
    intent?: { displayName?: string };
    parameters?: Record<string, any>;
  };
};

const pool = mysql.createPool({
  host: process.env.DB_HOST!,
  user: process.env.DB_USER!,
  password: process.env.DB_PASS!,
  database: process.env.DB_NAME!,
  connectionLimit: 10
});

const ok = (text: string) =>
  new Response(JSON.stringify({ fulfillmentText: text }), {
    headers: { "Content-Type": "application/json" },
    status: 200
  });

function toDateTime(d?: string, t?: string) {
  if (!d && !t) return null;
  const day = d ?? new Date().toISOString().slice(0, 10);
  const time = t ?? "23:59:00";
  return `${day} ${time.length === 5 ? time + ":00" : time}`;
}

export async function POST({ request }: { request: Request }) {
  const body = (await request.json()) as DFReq;
  const intent = body?.queryResult?.intent?.displayName || "";
  const p = body?.queryResult?.parameters || {};
  const userId = "demo";

  try {
    if (intent === "add_task") {
      const title = p.title || "Tanpa Judul";
      const course = p.course || "Umum";
      const dueAt = toDateTime(p.due_date, p.due_time);
      const priority = p.priority || "medium";

      await pool.execute(
        `INSERT INTO tasks (user_id, title, course, due_at, priority, status)
         VALUES (?, ?, ?, ?, ?, 'todo')`,
        [userId, title, course, dueAt, priority]
      );

      return ok(`Tugas "${title}" berhasil disimpan.`);
    }

    if (intent === "list_tasks_by_course") {
      const course = String(p.course || "").toLowerCase();
      const [rows]: any = await pool.execute(
        `SELECT title, DATE_FORMAT(due_at,'%Y-%m-%d %H:%i') AS due_at
         FROM tasks WHERE user_id=? AND LOWER(course)=?
         ORDER BY due_at`,
        [userId, course]
      );

      if (!rows.length) return ok(`Tidak ada tugas untuk ${course}.`);

      const list = rows
        .map((r: any) => `• ${r.title} — ${r.due_at}`)
        .join("\n");

      return ok(`Tugas ${course}:\n${list}`);
    }

    if (intent === "list_tasks_by_date") {
      const date = p.date || p.due_date;
      const d = new Date(date);

      const yyyy = d.getFullYear();
      const mm = d.getMonth() + 1;
      const dd = d.getDate();

      const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);

      const start = `${yyyy}-${pad(mm)}-${pad(dd)} 00:00:00`;
      const end = `${yyyy}-${pad(mm)}-${pad(dd)} 23:59:59`;

      const [rows]: any = await pool.execute(
        `SELECT title, course,
                DATE_FORMAT(due_at,'%Y-%m-%d %H:%i') AS due_at
         FROM tasks
         WHERE user_id=? AND due_at BETWEEN ? AND ?
         ORDER BY due_at`,
        [userId, start, end]
      );

      if (!rows.length) return ok("Tidak ada tugas di tanggal itu.");

      const list = rows
        .map((r: any) => `• ${r.title} (${r.course}) — ${r.due_at}`)
        .join("\n");

      return ok(`Tugas pada tanggal tersebut:\n${list}`);
    }

    if (intent === "update_status") {
      const title = String(p.title || "").toLowerCase();
      const status = p.status || "todo";

      const [res]: any = await pool.execute(
        `UPDATE tasks SET status=? WHERE user_id=? AND LOWER(title)=?`,
        [status, userId, title]
      );

      if (!res.affectedRows)
        return ok(`Tugas "${title}" tidak ditemukan.`);

      return ok(`Status tugas "${title}" telah diperbarui.`);
    }

    return ok("Webhook menerima request.");
  } catch (err) {
    console.error(err);
    return ok("Terjadi error pada server.");
  }
}
