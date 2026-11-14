import "server-only";
import { projectDuration, ProjectSchema, type Project } from "@videoeditor/core";
import { db, tx } from "./db";
import { HttpError } from "./errors";

/**
 * Projetos salvos na conta. Guarda só o JSON da edição (timeline, transcrição,
 * medições do vídeo): é o trabalho do usuário e o que custou créditos. O
 * arquivo de vídeo não sobe; fica no navegador e é religado pelo hash quando o
 * projeto abre em outro aparelho.
 */
export const MAX_PROJECTS = 100;
/** Teto do JSON de um projeto (a transcrição de um vídeo longo é o que mais pesa). */
export const MAX_PROJECT_BYTES = 4 * 1024 * 1024;

export type ProjectSummary = { id: string; name: string; duration: number; updatedAt: string; createdAt: string };
type Row = { id: string; name: string; duration: number; updated_at: string; created_at: string };

const summary = (r: Row): ProjectSummary => ({ id: r.id, name: r.name, duration: r.duration, updatedAt: r.updated_at, createdAt: r.created_at });

export async function listProjects(userId: string): Promise<ProjectSummary[]> {
  return (await db.query<Row>("SELECT id, name, duration, updated_at, created_at FROM projects WHERE user_id = $1 ORDER BY updated_at DESC, id", [userId])).map(summary);
}

export async function getProject(userId: string, id: string): Promise<Project> {
  const row = await db.one<{ data: unknown }>("SELECT data FROM projects WHERE user_id = $1 AND id = $2", [userId, id]);
  if (!row) throw new HttpError(404, "Projeto não encontrado.");
  const parsed = ProjectSchema.safeParse(row.data);
  if (!parsed.success) throw new HttpError(500, "Este projeto está num formato que não conseguimos abrir.");
  return parsed.data;
}

/** Cria ou atualiza. O id é o do próprio projeto: salvar duas vezes não duplica. */
export async function saveProject(userId: string, id: string, raw: unknown, bytes: number): Promise<ProjectSummary> {
  if (bytes > MAX_PROJECT_BYTES) throw new HttpError(413, "Este projeto ficou grande demais para salvar na conta.");
  const parsed = ProjectSchema.safeParse(raw);
  if (!parsed.success || parsed.data.id !== id) throw new HttpError(400, "Projeto inválido.");
  const project = parsed.data;
  const name = project.name.trim().slice(0, 120) || "Sem título";
  return tx(async () => {
    // Bloqueia a conta: dois salvamentos simultâneos não passam do limite.
    await db.one("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [userId]);
    const exists = await db.one("SELECT 1 FROM projects WHERE user_id = $1 AND id = $2", [userId, id]);
    if (!exists) {
      const count = (await db.one<{ n: number }>("SELECT COUNT(*) AS n FROM projects WHERE user_id = $1", [userId]))?.n ?? 0;
      if (count >= MAX_PROJECTS) throw new HttpError(403, `Você chegou ao limite de ${MAX_PROJECTS} projetos salvos. Apague os que não usa mais.`);
    }
    const row = await db.one<Row>(
      `INSERT INTO projects (user_id, id, name, duration, data) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, id) DO UPDATE SET name = EXCLUDED.name, duration = EXCLUDED.duration, data = EXCLUDED.data, updated_at = now()
       RETURNING id, name, duration, updated_at, created_at`,
      [userId, id, name, projectDuration(project), JSON.stringify(project)],
    );
    return summary(row!);
  });
}

export async function deleteProject(userId: string, id: string) {
  if (!(await db.run("DELETE FROM projects WHERE user_id = $1 AND id = $2", [userId, id]))) throw new HttpError(404, "Projeto não encontrado.");
}
