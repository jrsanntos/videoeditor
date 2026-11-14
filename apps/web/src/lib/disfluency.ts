"use client";

import { energyEnvelope, falseStart, speechRate, splitFalseStart, splitHesitations, stretchedWords, type Transcript, type Word } from "@videoeditor/core";
import { encodeWav } from "./media";

/** Folga em volta da palavra reouvida e limites do pedido (só as palavras suspeitas). */
const PAD = 0.25;
const MAX_SPANS = 24;
const MAX_SPAN_SEC = 10;

/**
 * Acha as hesitações que a transcrição escondeu dentro de palavras esticadas:
 * tentativa abandonada (pausa no meio de uma palavra longa, medida no áudio) e
 * sons como "hum" e "é…" (segunda escuta só daquele trecho). Conservador: na
 * dúvida a palavra fica como veio. Qualquer falha devolve a transcrição intacta.
 */
export async function refineDisfluencies(transcript: Transcript, samples: Float32Array, sampleRate: number): Promise<Transcript> {
  try {
    const words = transcript.words;
    const rate = speechRate(words);
    const suspects = stretchedWords(words, rate);
    if (!suspects.length) return transcript;
    const replaced = new Map<string, Word[]>();
    const listen: Word[] = [];
    for (const w of suspects) {
      const cut = falseStart(w, energyEnvelope(samples, sampleRate, w.start, w.end), rate);
      if (cut) replaced.set(w.id, splitFalseStart(w, cut));
      else listen.push(w);
    }
    // As mais esticadas primeiro: é onde mais provavelmente há um "hum".
    const batch = listen.sort((a, b) => b.end - b.start - (a.end - a.start)).slice(0, MAX_SPANS);
    if (batch.length) {
      const body = new FormData();
      const starts = batch.map((w) => Math.max(0, w.start - PAD));
      batch.forEach((w, i) => {
        const end = Math.min(samples.length / sampleRate, w.end + PAD, starts[i]! + MAX_SPAN_SEC);
        body.append("span", encodeWav(samples.subarray(Math.floor(starts[i]! * sampleRate), Math.ceil(end * sampleRate)), sampleRate), `span${i}.wav`);
      });
      body.append("language", transcript.language ?? "pt");
      const res = await fetch("/api/transcribe/spans", { method: "POST", body }).catch(() => null);
      const data = res?.ok ? ((await res.json().catch(() => null)) as { spans?: { words: { text: string; start: number; end: number }[] }[] } | null) : null;
      data?.spans?.forEach((span, i) => {
        const w = batch[i];
        if (!w || !span) return;
        const parts = splitHesitations(w, span.words, starts[i]!);
        if (parts.length > 1) replaced.set(w.id, parts);
      });
    }
    if (!replaced.size) return transcript;
    return { ...transcript, words: words.flatMap((w) => replaced.get(w.id) ?? [w]) };
  } catch (e) {
    console.warn("revisão de hesitações indisponível", e);
    return transcript;
  }
}
