"use server";

import { neon } from "@neondatabase/serverless";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";

const sql = neon(process.env.DATABASE_URL!);

function refreshAll() {
  revalidatePath("/", "layout");
}

export async function createEvent(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  await sql`INSERT INTO events (event_date, city, venue, title, lineup, district) VALUES (${String(formData.get("date"))}, ${String(formData.get("city"))}, ${String(formData.get("venue"))}, ${String(formData.get("title"))}, ${String(formData.get("lineup"))}, ${String(formData.get("district"))})`;
  refreshAll();
}

export async function updateEvent(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  await sql`UPDATE events SET event_date = ${String(formData.get("date"))}, city = ${String(formData.get("city"))}, venue = ${String(formData.get("venue"))}, title = ${String(formData.get("title"))}, lineup = ${String(formData.get("lineup"))}, district = ${String(formData.get("district"))} WHERE id = ${Number(formData.get("id"))}`;
  refreshAll();
}

export async function deleteEvent(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  await sql`DELETE FROM events WHERE id = ${Number(formData.get("id"))}`;
  refreshAll();
}

export async function createNews(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  await sql`INSERT INTO news (tag, news_date, title, excerpt) VALUES (${String(formData.get("tag"))}, ${String(formData.get("date"))}, ${String(formData.get("title"))}, ${String(formData.get("excerpt"))})`;
  refreshAll();
}

export async function updateNews(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  await sql`UPDATE news SET tag = ${String(formData.get("tag"))}, news_date = ${String(formData.get("date"))}, title = ${String(formData.get("title"))}, excerpt = ${String(formData.get("excerpt"))} WHERE id = ${Number(formData.get("id"))}`;
  refreshAll();
}

export async function deleteNews(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  await sql`DELETE FROM news WHERE id = ${Number(formData.get("id"))}`;
  refreshAll();
}
