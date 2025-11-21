// Supaya route ini hanya dijalankan di server
export const prerender = false;

import mysql from "mysql2/promise";

// Bentuk body dari Dialogflow
type DFParameters = { [key: string]: any };

interface DFRequestBody {
  queryResult?: {
    intent?: { displayName?: string };
    parameters?: DFParameters;
  };
}

// Pool koneksi MySQL (pakai .env)
const pool = mysql.createPool({
  host: import.meta.env.DB_HOST,
  user: import.meta.env.DB_USER,
  password: import.meta.env.DB_PASS,
  database: import.meta.env.DB_NAME,
  connectionLimit: 10,
});

// Helper untuk balasan ke Dialogflow
const ok = (text: string) =>
  new Response(JSON.stringify({ fulfillmentText: text }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });

// --------- Helper kecil-kecil ---------

function normalizeIntent(name?: string | null): string {
  return (name ?? "").trim().toLowerCase();
}

function asString(v: any, fallback = ""): string {
  if (v === undefined || v === null) return fallback;
  return String(v);
}

// Parsel @sys.date jadi "YYYY-MM-DD"
function parseDate(date?: string): string | null {
  if (!date) return null;
  // Dialogflow sering kirim "2025-11-21" atau "2025-11-21T00:00:00+07:00"
  return date.split("T")[0];
}

// Parsel @sys.time jadi "HH:MM:SS"
function parseTime(time?: string): string | null {
  if (!time) return null;
  const match = time.match(/(\d{2}:\d{2}(:\d{2})?)/);
  if (!match) return null;
  let t = match[1]; // "HH:MM" atau "HH:MM:SS"
  if (t.length === 5) t += ":00";
  return t;
}

// Gabung date + time jadi "YYYY-MM-DD HH:MM:SS"
function buildDateTime(date?: string, time?: string): string {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const d = parseDate(date) ?? today;
  const t = parseTime(time) ?? "23:59:00";
  return `${d} ${t}`;
}

// --------- Handler utama webhook ---------

export async function POST({ request }: { request: Request }) {
  const body = (await request.json()) as DFRequestBody;

  const intentName = normalizeIntent(body.queryResult?.intent?.displayName);
  const params = body.queryResult?.parameters ?? {};
  const userId = "demo"; // kalau nanti ada multi user, ini bisa diganti

  try {
    // =======================
    // 1) INTENT: ADD TASK
    // Display name di Dialogflow disarankan: "add_task"
    // =======================
    if (
      intentName === "add_task" ||
      intentName === "tambah_tugas" ||
      intentName === "tambah tugas"
    ) {
      const title = asString(params.title, "Tanpa judul").trim();
      const course = asString(params.course, "Umum").trim();
      const dueDate = asString(params.due_date, "");
      const dueTime = asString(params.due_time, "");
      const priorityRaw = asString(params.priority, "medium").toLowerCase();

      const mapPriority: Record<string, string> = {
        rendah: "low",
        low: "low",
        sedang: "medium",
        medium: "medium",
        tinggi: "high",
        high: "high",
        urgent: "high",
      };

      const priority = mapPriority[priorityRaw] ?? "medium";
      const dueAt = buildDateTime(dueDate, dueTime);

      await pool.execute(
        `
        INSERT INTO tasks (user_id, title, course, due_at, priority, status)
        VALUES (?, ?, ?, ?, ?, 'todo')
      `,
        [userId, title, course, dueAt, priority]
      );

      return ok(
        `Siap! Tugas "${title}" untuk ${course} sudah disimpan dengan deadline ${dueAt}.`
      );
    }

    // ==============================================
    // 2) INTENT: LIST TASKS BY COURSE (YANG BELUM SELESAI)
    // Display name disarankan: "list_tasks_by_course"
    // ==============================================
    if (
      intentName === "list_tasks_by_course" ||
      intentName === "course" ||
      intentName === "tugas_per_mata_kuliah"
    ) {
      const courseParam = asString(params.course, "").trim();
      if (!courseParam) {
        return ok("Mata kuliahnya apa? Misalnya: Kalkulus, Fisika Dasar, dst.");
      }

      const course = courseParam.toLowerCase();

      const [rows] = await pool.execute(
        `
        SELECT 
          title,
          DATE_FORMAT(due_at, '%Y-%m-%d %H:%i') AS due_at,
          priority,
          status
        FROM tasks
        WHERE user_id = ?
          AND LOWER(course) = ?
          AND status <> 'done'
        ORDER BY due_at ASC
      `,
        [userId, course]
      );

      const list = Array.isArray(rows) ? (rows as any[]) : [];

      if (!list.length) {
        return ok(
          `Belum ada tugas (atau semua sudah selesai) untuk mata kuliah ${courseParam}.`
        );
      }

      const text = list
        .map(
          (r) =>
            `• ${r.title} — ${r.due_at} (prioritas: ${r.priority}, status: ${r.status})`
        )
        .join("\n");

      return ok(`Tugas ${courseParam} yang belum selesai:\n${text}`);
    }

    // ==============================================
    // 3) INTENT: LIST TASKS BY DATE (HARI INI / BESOK / TANGGAL TERTENTU)
    // Display name disarankan: "list_tasks_by_date"
    // Parameter: date / due_date (@sys.date)
    // ==============================================
    if (
      intentName === "list_tasks_by_date" ||
      intentName === "tugas_per_tanggal" ||
      intentName === "tugas_hari_ini"
    ) {
      const rawDate = (params.date ?? params.due_date) as string | undefined;
      const dateOnly = parseDate(rawDate) ?? new Date().toISOString().slice(0, 10);

      const from = `${dateOnly} 00:00:00`;
      const to = `${dateOnly} 23:59:59`;

      const [rows] = await pool.execute(
        `
        SELECT 
          title,
          course,
          DATE_FORMAT(due_at, '%Y-%m-%d %H:%i') AS due_at,
          priority,
          status
        FROM tasks
        WHERE user_id = ?
          AND due_at BETWEEN ? AND ?
          AND status <> 'done'
        ORDER BY due_at ASC
      `,
        [userId, from, to]
      );

      const list = Array.isArray(rows) ? (rows as any[]) : [];

      if (!list.length) {
        return ok(`Tidak ada tugas yang belum selesai pada tanggal ${dateOnly}.`);
      }

      const text = list
        .map(
          (r) =>
            `• ${r.title} [${r.course}] — ${r.due_at} (prioritas: ${r.priority})`
        )
        .join("\n");

      return ok(`Tugas yang belum selesai pada ${dateOnly}:\n${text}`);
    }

    // ==============================================
    // 4) INTENT: UPDATE STATUS TUGAS
    // Display name disarankan: "update_status"
    // Parameter: title (@sys.any), status (@status / @sys.any)
    // ==============================================
    if (
      intentName === "update_status" ||
      intentName === "ubah_status_tugas" ||
      intentName === "ubah status tugas"
    ) {
      const titleParam = asString(params.title, "").trim();
      if (!titleParam) {
        return ok(
          "Tolong sebutkan judul tugas yang ingin diubah statusnya, misalnya: laporan praktikum."
        );
      }

      const statusRaw = asString(params.status, "todo").toLowerCase();
      const mapStatus: Record<string, string> = {
        todo: "todo",
        "to do": "todo",
        belum: "todo",
        "in progress": "in_progress",
        progres: "in_progress",
        proses: "in_progress",
        in_progress: "in_progress",
        done: "done",
        selesai: "done",
        beres: "done",
      };

      const status = mapStatus[statusRaw] ?? "todo";

      const [result] = (await pool.execute(
        `
        UPDATE tasks 
        SET status = ?
        WHERE user_id = ?
          AND LOWER(title) = ?
      `,
        [status, userId, titleParam.toLowerCase()]
      )) as any[];

      if (!result.affectedRows) {
        return ok(
          `Tugas dengan judul "${titleParam}" tidak ditemukan di database.`
        );
      }

      return ok(
        `Status tugas "${titleParam}" sudah diubah menjadi ${status}.`
      );
    }

    // ==============================================
    // 5) DEFAULT: kalau intent tidak dikenali di webhook
    // ==============================================
    return ok(
      "Webhook sudah menerima pesan, tapi intent ini belum di-handle di server."
    );
  } catch (err: any) {
    console.error("Webhook error:", err);
    return ok("Terjadi error di server: " + (err?.message ?? "unknown error"));
  }
}
