import type { Transcript } from "@videoeditor/core";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Limite do endpoint de transcrição por arquivo. 16 kHz mono WAV ≈ 1,9 MB/min → ~13 min. */
const MAX_BYTES = 25 * 1024 * 1024;

type GroqVerbose = {
  language?: string;
  words?: { word: string; start: number; end: number }[];
};

/**
 * Transcrição com timestamps por palavra via Groq Whisper (~US$ 0,004/min).
 * Recebe apenas o áudio leve extraído no navegador — o vídeo bruto não sobe.
 */
export async function POST(req: Request) {
  const key = process.env.GROQ_API_KEY;
  if (!key)
    return Response.json(
      {
        error:
          "A transcrição não está configurada neste servidor (defina GROQ_API_KEY em apps/web/.env.local). Sem ela, use a remoção local de silêncios e a edição manual.",
      },
      { status: 503 },
    );

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob)) return Response.json({ error: "Áudio ausente." }, { status: 400 });
  if (file.size > MAX_BYTES)
    return Response.json(
      { error: "Áudio acima de 25 MB (~13 min). Vídeos mais longos serão suportados com o proxy de ingestão." },
      { status: 413 },
    );

  const body = new FormData();
  body.append("file", file, "audio.wav");
  body.append("model", "whisper-large-v3-turbo");
  body.append("response_format", "verbose_json");
  body.append("timestamp_granularities[]", "word");

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body,
  }).catch((e: unknown) => {
    console.error("transcribe network error", e);
    return null;
  });
  if (!res)
    return Response.json({ error: "Não foi possível conectar ao serviço de transcrição." }, { status: 502 });
  if (!res.ok) {
    console.error("transcribe error", res.status, await res.text().catch(() => ""));
    return Response.json({ error: "O serviço de transcrição falhou. Tente novamente." }, { status: 502 });
  }
  const data = (await res.json()) as GroqVerbose;
  if (!data.words?.length)
    return Response.json({ error: "Nenhuma fala foi detectada no áudio." }, { status: 422 });

  const transcript: Transcript = {
    language: data.language,
    words: data.words.map((w, i) => ({ id: `w${i}`, text: w.word.trim(), start: w.start, end: w.end })),
  };
  return Response.json({ transcript });
}
