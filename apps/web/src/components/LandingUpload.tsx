"use client";

import { useEffect, useRef, useState } from "react";
import { creditCost, PLANS, SIGNUP_CREDITS, silencesFromAudio, type SkillId, type TimeRange } from "@videoeditor/core";
import { assertDecodable, decodeBlobMono, probeVideo, SPEECH_RATE } from "@/lib/media";
import { savePending } from "@/lib/pending";
import { GoogleButton, OrDivider } from "./GoogleButton";
import { Icon } from "./icons";
import { Reel } from "./LandingReel";

/** Os estilos na ordem da página, com o nome curto e a promessa em uma linha. */
const STYLES: { id: SkillId; name: string; hint: string }[] = [
  { id: "viral", name: "Retenção Viral", hint: "Gancho forte, legenda pop e zooms a cada corte" },
  { id: "autoridade", name: "Autoridade", hint: "Ritmo sóbrio, dados em cartões e tom quente" },
  { id: "acao", name: "Ação & Cinema", hint: "Câmera lenta, cor de cinema e impactos" },
  { id: "limpeza", name: "Só limpeza", hint: "Tira erros, muletas e pausas; o acabamento fica com você" },
];

const FREE_MAX_SEC = PLANS.free.maxUploadMinutes * 60;
/** Acima disso a análise local de pausas na página inicial não compensa (memória do navegador). */
const ANALYZE_MAX_SEC = 15 * 60;

type Loaded = {
  file: File;
  url: string;
  duration: number;
  width: number;
  height: number;
};
type Analysis = { pauses: TimeRange[]; cutSec: number; peaks: number[] } | "working" | "failed";

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

/**
 * Estúdio da página inicial: a pessoa envia o vídeo e vê, na hora e sem
 * custo, o vídeo dela no estilo escolhido e as pausas que a limpeza vai
 * cortar (análise de áudio feita no próprio navegador). Para a IA processar
 * é preciso ter conta: o vídeo e o estilo ficam guardados no navegador e o
 * editor retoma tudo assim que a conta entra, gastando os créditos dela.
 */
export function LandingUpload({ loggedIn, google }: { loggedIn: boolean; google: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [video, setVideo] = useState<Loaded | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [style, setStyle] = useState<SkillId>("viral");
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [gate, setGate] = useState(false);
  const [going, setGoing] = useState(false);
  const [pendingStyle, setPendingStyle] = useState<SkillId | null>(null);
  // Tarja do estilo Autoridade: só aparece (na prévia e no vídeo) se a pessoa disser quem é.
  const [who, setWho] = useState({ name: "", credential: "" });

  useEffect(() => () => {
    if (video) URL.revokeObjectURL(video.url);
  }, [video]);

  async function pick(file?: File | null) {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("video/") && !/\.(mp4|mov|webm|m4v|mkv)$/i.test(file.name)) return setError("Escolha um arquivo de vídeo (MP4, MOV ou WebM).");
    setReading(true);
    try {
      const meta = await probeVideo(file);
      await assertDecodable(file);
      const url = URL.createObjectURL(file);
      setVideo({ file, url, ...meta });
      setAnalysis(null);
      void analyze(file, meta.duration);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading(false);
    }
  }

  async function analyze(file: File, duration: number) {
    if (duration > ANALYZE_MAX_SEC) return;
    setAnalysis("working");
    try {
      const samples = await decodeBlobMono(file);
      const pauses = silencesFromAudio(samples, SPEECH_RATE);
      const cutSec = pauses.reduce((s, r) => s + (r.end - r.start), 0);
      // Envelope de áudio em 120 colunas para o desenho da faixa.
      const cols = 120;
      const step = Math.max(1, Math.floor(samples.length / cols));
      const peaks: number[] = [];
      let max = 0;
      for (let c = 0; c < cols; c++) {
        let sum = 0;
        const from = c * step;
        for (let i = from; i < Math.min(samples.length, from + step); i += 8) sum += samples[i]! * samples[i]!;
        const rms = Math.sqrt(sum / Math.max(1, step / 8));
        peaks.push(rms);
        max = Math.max(max, rms);
      }
      setAnalysis({ pauses, cutSec, peaks: peaks.map((p) => (max ? p / max : 0)) });
    } catch {
      setAnalysis("failed");
    }
  }

  function reset() {
    setVideo(null);
    setAnalysis(null);
    setError(null);
    if (input.current) input.current.value = "";
  }

  async function proceed(chosen: SkillId | null) {
    if (!video) return;
    setGoing(true);
    const identity = chosen === "autoridade" && who.name.trim() ? { name: who.name.trim(), credential: who.credential.trim() } : undefined;
    const saved = await savePending(video.file, chosen, identity);
    if (!saved) {
      setGoing(false);
      return setError("Seu navegador não deixou guardar o vídeo (janela anônima ou sem espaço). Entre na conta e envie o vídeo pelo editor.");
    }
    if (loggedIn) {
      window.location.href = "/app";
      return;
    }
    setGoing(false);
    setPendingStyle(chosen);
    setGate(true);
  }

  const tooLong = !!video && !loggedIn && video.duration > FREE_MAX_SEC + 1;
  const cost = video ? creditCost({ type: "ingest", durationSec: video.duration }) + creditCost({ type: "agent", tier: "full", durationSec: video.duration }) : 0;

  return (
    <div id="enviar" className="scroll-mt-28">
      <input ref={input} type="file" accept="video/*" className="hidden" data-testid="landing-file-input" onChange={(e) => void pick(e.target.files?.[0])} />

      {!video ? (
        <div className="lp-studio grid overflow-hidden rounded-[28px] lg:grid-cols-[1.2fr_1fr]">
          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={(e) => (e.preventDefault(), setOver(true))}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              void pick(e.dataTransfer.files[0]);
            }}
            disabled={reading}
            data-testid="landing-dropzone"
            className={`group m-3 flex min-h-[340px] flex-col items-center justify-center gap-5 rounded-[22px] border-2 border-dashed p-8 text-center transition sm:m-4 sm:min-h-[400px] ${
              over ? "border-neon-mint bg-neon-mint/10" : "border-white/20 bg-white/[0.025] hover:border-neon-pink/70 hover:bg-neon-pink/[0.05]"
            }`}
          >
            <span className="flex h-[72px] w-[72px] items-center justify-center rounded-[22px] bg-[linear-gradient(135deg,#f64cff,#59ffcd)] text-night-950 shadow-[0_18px_40px_-12px_rgba(246,76,255,0.7)] transition group-hover:scale-105">
              <UploadGlyph />
            </span>
            <span>
              <span className="lp-display block text-[24px] font-semibold leading-tight sm:text-[28px]">{reading ? "Lendo o vídeo…" : "Arraste seu vídeo aqui"}</span>
              <span className="mt-2 block text-[15.5px] text-haze">ou clique para escolher do computador ou do celular</span>
            </span>
            <span className="lp-btn lp-btn-primary pointer-events-none text-[15.5px]">Escolher vídeo</span>
            <span className="text-[13px] text-haze">
              MP4, MOV ou WebM · até {PLANS.free.maxUploadMinutes} min no plano grátis · o arquivo não sai do seu navegador
            </span>
            {error && (
              <span className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-[13.5px] text-rose-200" role="alert">
                {error}
              </span>
            )}
          </button>
          <div className="relative hidden flex-col justify-center gap-5 p-8 pl-4 lg:flex" aria-hidden>
            <p className="lp-overline">O que acontece em seguida</p>
            <ol className="space-y-4 text-[15.5px] text-haze">
              {[
                ["Você vê o seu vídeo no estilo escolhido", "na hora, aqui mesmo"],
                ["Encontramos as pausas", "análise grátis, no seu navegador"],
                ["A IA edita tudo", `com os ${SIGNUP_CREDITS} créditos grátis da sua conta`],
              ].map(([title, sub], i) => (
                <li key={title} className="flex gap-4">
                  <span className="lp-display flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/20 text-[14px] font-semibold text-white">{i + 1}</span>
                  <span>
                    <span className="block font-semibold text-white">{title}</span>
                    {sub}
                  </span>
                </li>
              ))}
            </ol>
            <div className="mt-2 grid grid-cols-3 gap-2.5">
              {(["viral", "autoridade", "limpeza"] as const).map((s) => (
                <Reel key={s} style={s} className="shadow-[0_14px_30px_rgba(0,0,0,0.45)]" />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="lp-studio pop-in grid gap-6 rounded-[28px] p-4 sm:p-6 lg:grid-cols-[minmax(0,330px)_1fr] lg:gap-10 lg:p-8" data-testid="landing-studio">
          <div className="mx-auto w-full max-w-[330px]">
            <StylePreview url={video.url} style={style} who={who} />
            <p className="mt-3 text-center text-[12.5px] text-haze">Prévia do estilo no seu vídeo · o resultado final é montado pela IA a partir da sua fala</p>
          </div>

          <div className="flex min-w-0 flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="lp-overline">Passo 2 · Escolha o estilo</p>
              <button type="button" onClick={reset} className="text-[14px] text-haze underline-offset-4 hover:text-white hover:underline" data-testid="landing-change">
                Trocar vídeo
              </button>
            </div>
            <h3 className="lp-display mt-3 truncate text-[26px] font-semibold leading-tight sm:text-[32px]" title={video.file.name}>
              {video.file.name.replace(/\.[^.]+$/, "")}
            </h3>

            <AnalysisStrip video={video} analysis={analysis} />

            <div className="mt-6 grid gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label="Estilo da edição">
              {STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={style === s.id}
                  onClick={() => setStyle(s.id)}
                  data-testid={`landing-style-${s.id}`}
                  className={`rounded-2xl border p-4 text-left transition ${style === s.id ? "border-neon-pink bg-neon-pink/[0.12] shadow-[0_0_0_4px_rgba(246,76,255,0.14)]" : "border-white/12 bg-white/[0.03] hover:border-white/30"}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="lp-display text-[17px] font-semibold text-white">{s.name}</span>
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${style === s.id ? "border-neon-pink bg-neon-pink text-night-950" : "border-white/30"}`}>{style === s.id && <Icon.check size={12} />}</span>
                  </span>
                  <span className="mt-1 block text-[14px] leading-snug text-haze">{s.hint}</span>
                </button>
              ))}
            </div>

            {style === "autoridade" && (
              <div className="mt-4 rounded-2xl border border-white/12 bg-white/[0.03] p-4" data-testid="landing-identity">
                <p className="text-[14px] font-semibold text-white">
                  Tarja com seu nome <span className="font-normal text-haze">(opcional)</span>
                </p>
                <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                  <input
                    value={who.name}
                    maxLength={40}
                    onChange={(e) => setWho({ ...who, name: e.target.value })}
                    placeholder="Dra. Ana Silva"
                    aria-label="Seu nome na tarja"
                    className="rounded-xl border border-white/12 bg-night-950/80 px-3.5 py-2.5 text-[15px] text-white outline-none placeholder:text-white/30 focus:border-neon-mint"
                  />
                  <input
                    value={who.credential}
                    maxLength={60}
                    onChange={(e) => setWho({ ...who, credential: e.target.value })}
                    placeholder="Cardiologista · CRM 12345"
                    aria-label="Sua credencial"
                    className="rounded-xl border border-white/12 bg-night-950/80 px-3.5 py-2.5 text-[15px] text-white outline-none placeholder:text-white/30 focus:border-neon-mint"
                  />
                </div>
                <p className="mt-2 text-[12.5px] text-haze">Aparece no começo do vídeo para apresentar você. Sem nome, o vídeo sai sem tarja.</p>
              </div>
            )}

            {tooLong && (
              <p className="mt-5 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-[14px] text-amber-100" role="alert">
                Este vídeo tem {fmt(video.duration)}. No plano grátis a IA edita vídeos de até {PLANS.free.maxUploadMinutes} minutos: envie um trecho mais curto ou{" "}
                <a href="#planos" className="font-semibold underline underline-offset-2">
                  veja os planos
                </a>
                .
              </p>
            )}
            {error && (
              <p className="mt-5 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-[14px] text-rose-200" role="alert">
                {error}
              </p>
            )}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button type="button" className="lp-btn lp-btn-primary !py-4 text-[16.5px] disabled:opacity-50" disabled={tooLong || going} onClick={() => void proceed(style)} data-testid="landing-process">
                <Icon.sparkles size={18} /> Editar meu vídeo com IA
              </button>
              <button type="button" className="lp-btn lp-btn-outline !py-4 text-[15.5px] disabled:opacity-50" disabled={tooLong || going} onClick={() => void proceed(null)} data-testid="landing-manual">
                Prefiro editar sozinho
              </button>
            </div>
            <p className="mt-3 text-[13.5px] text-haze">
              {loggedIn ? (
                <>Usa cerca de {cost} créditos da sua conta. A edição manual no editor é sempre grátis.</>
              ) : (
                <>
                  Para processar, crie sua conta grátis: você ganha <b className="font-semibold text-white">{SIGNUP_CREDITS} créditos</b> e este vídeo usa cerca de {cost}. Sem cartão.
                </>
              )}
            </p>
          </div>
        </div>
      )}

      {gate && <AuthGate google={google} style={pendingStyle} onClose={() => setGate(false)} />}
    </div>
  );
}

/** O próprio vídeo da pessoa, enquadrado em 9:16, com o "look" do estilo por cima. */
function StylePreview({ url, style, who }: { url: string; style: SkillId; who: { name: string; credential: string } }) {
  const [muted, setMuted] = useState(true);
  return (
    <div className={`lp-preview lp-preview-${style} relative aspect-[9/16] overflow-hidden rounded-[22px] border border-white/15 bg-black shadow-[0_30px_60px_-20px_rgba(0,0,0,0.8)] [container-type:inline-size]`}>
      <video key={url} src={url} autoPlay loop muted={muted} playsInline className="lp-preview-video absolute inset-0 h-full w-full object-cover" data-testid="landing-preview" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.35)_0%,transparent_22%,transparent_55%,rgba(0,0,0,0.75)_100%)]" />
      {style === "acao" && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[9%] bg-black" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[9%] bg-black" />
        </>
      )}
      <span className="absolute left-[5cqw] top-[5cqw] rounded-full bg-black/55 px-[3.5cqw] py-[1.6cqw] text-[3.8cqw] font-semibold uppercase tracking-[0.12em] text-white/90 backdrop-blur">
        {STYLES.find((s) => s.id === style)?.name}
      </span>
      <button
        type="button"
        onClick={() => setMuted((m) => !m)}
        className="absolute right-[4cqw] top-[4cqw] flex h-[10cqw] w-[10cqw] items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition hover:bg-black/75"
        aria-label={muted ? "Ativar o som" : "Silenciar"}
      >
        <SpeakerGlyph muted={muted} />
      </button>
      {PREVIEW_LAYERS[style]}
      {style === "autoridade" && who.name.trim() && (
        <div className="pointer-events-none absolute bottom-[22%] left-[6cqw] max-w-[80%] border-l-[0.9cqw] border-[#e8d5a8] bg-black/60 py-[2.2cqw] pl-[3.2cqw] pr-[5cqw] backdrop-blur">
          <div className="truncate text-[5.4cqw] font-bold leading-tight text-white">{who.name}</div>
          {who.credential.trim() && <div className="truncate text-[4.2cqw] leading-tight text-white/70">{who.credential}</div>}
        </div>
      )}
    </div>
  );
}

const Words = ({ text, hi }: { text: string; hi: string }) => (
  <>
    {text.split(" ").map((w, i) => (
      <span key={i} className="lp-word mx-[1.1cqw]" style={{ "--i": i, "--hi": hi } as React.CSSProperties}>
        {w}
      </span>
    ))}
  </>
);

/** O que cada estilo põe na tela, com textos neutros (o texto real vem da fala). */
const PREVIEW_LAYERS: Record<SkillId, React.ReactNode> = {
  viral: (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-[16%] text-center font-['LP_Anton'] text-[13cqw] uppercase leading-[0.9] text-white [text-shadow:0_0.8cqw_3cqw_rgba(0,0,0,0.7)]">
        Seu gancho
        <div className="text-[#facc15]">em 2 segundos</div>
      </div>
      <div className="pointer-events-none absolute inset-x-[4cqw] bottom-[9%] text-center font-['LP_Anton'] text-[8.6cqw] uppercase leading-none text-white [text-shadow:0_0.6cqw_0_#000]">
        <Words text="assim fica sua legenda" hi="#facc15" />
      </div>
    </>
  ),
  autoridade: (
    <>
      <div className="pointer-events-none absolute inset-x-[5cqw] bottom-[8%] text-center text-[6.2cqw] font-semibold leading-tight text-white/70 [text-shadow:0_0.4cqw_2cqw_rgba(0,0,0,0.8)]">
        <Words text="legenda editorial na base" hi="#ffffff" />
      </div>
    </>
  ),
  acao: (
    <>
      <div className="pointer-events-none absolute right-[5cqw] top-[13%] rounded-md bg-[#59ffcd] px-[2.4cqw] py-[1cqw] text-[3.8cqw] font-bold uppercase tracking-[0.1em] text-night-950">0.5× slow-mo</div>
      <div className="pointer-events-none absolute inset-x-[4cqw] bottom-[13%] text-center text-[7.4cqw] font-extrabold uppercase leading-none text-white [text-shadow:0_0.5cqw_0_#000]">
        <Words text="impacto no ponto exato" hi="#59ffcd" />
      </div>
    </>
  ),
  limpeza: (
    <div className="pointer-events-none absolute inset-x-[6cqw] bottom-[8%] text-white">
      <div className="text-[4.4cqw] font-semibold uppercase tracking-[0.14em] text-white/70">Decupagem automática</div>
      <div className="mt-[1.5cqw] text-[5.4cqw] font-medium leading-tight">Erros, recomeços, muletas e pausas longas saem; a fala fica contínua.</div>
    </div>
  ),
};

/** Faixa com o áudio do vídeo e as pausas que a limpeza vai cortar: resultado real, calculado no navegador. */
function AnalysisStrip({ video, analysis }: { video: Loaded; analysis: Analysis | null }) {
  const ready = analysis && typeof analysis === "object" ? analysis : null;
  return (
    <div className="mt-5 rounded-2xl border border-white/12 bg-night-950/60 p-4" data-testid="landing-analysis">
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-[14px]">
        <Stat label="Duração" value={fmt(video.duration)} />
        <Stat label="Formato" value={`${video.width}×${video.height}`} />
        {ready ? (
          <>
            <Stat label="Pausas encontradas" value={String(ready.pauses.length)} accent />
            <Stat label="Tempo a cortar" value={ready.cutSec >= 1 ? `−${Math.round(ready.cutSec)} s` : "quase nada"} accent />
          </>
        ) : analysis === "working" ? (
          <span className="flex items-center gap-2 text-haze">
            <span className="h-2 w-2 animate-ping rounded-full bg-neon-mint" /> Ouvindo o áudio para achar as pausas…
          </span>
        ) : null}
      </div>
      {ready && (
        <div className="relative mt-4 flex h-12 items-center gap-[2px] overflow-hidden rounded-lg bg-white/[0.04] px-1" aria-label={`${ready.pauses.length} pausas marcadas para corte`}>
          {ready.peaks.map((p, i) => (
            <span key={i} className="flex-1 rounded-sm bg-white/45" style={{ height: `${Math.max(6, p * 100)}%` }} />
          ))}
          {ready.pauses.map((r, i) => (
            <span
              key={i}
              className="absolute inset-y-0 border-x border-[#ff6b8b]/70 bg-[#ff6b8b]/30"
              style={{ left: `${(r.start / video.duration) * 100}%`, width: `${Math.max(0.6, ((r.end - r.start) / video.duration) * 100)}%` }}
            />
          ))}
        </div>
      )}
      {ready && <p className="mt-2 text-[12.5px] text-haze">Em vermelho, os trechos sem fala que a IA remove. A análise foi feita no seu navegador, sem custo.</p>}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <span>
      <span className="block text-[11px] uppercase tracking-[0.16em] text-haze">{label}</span>
      <span className={`lp-display text-[19px] font-semibold ${accent ? "text-neon-mint" : "text-white"}`}>{value}</span>
    </span>
  );
}

/** Cadastro antes de processar: Google em um clique ou e-mail e senha, sem sair da página. */
function AuthGate({ google, style, onClose }: { google: boolean; style: SkillId | null; onClose: () => void }) {
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const styleName = STYLES.find((s) => s.id === style)?.name;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(form: HTMLFormElement) {
    setBusy(true);
    setError(null);
    const body = Object.fromEntries(new FormData(form));
    const res = await fetch(mode === "signup" ? "/api/auth/signup" : "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = ((await res?.json().catch(() => null)) ?? {}) as { error?: string; verify?: boolean; email?: string };
    setBusy(false);
    if (!res?.ok) return setError(data.error ?? "Não foi possível conectar. Tente de novo.");
    if (data.verify) return setPending(data.email ?? String(body.email ?? ""));
    window.location.href = "/app";
  }

  const field = "mt-1.5 w-full rounded-xl border border-white/12 bg-night-950/80 px-3.5 py-3 text-[15px] text-white outline-none transition placeholder:text-white/30 focus:border-neon-mint focus:ring-4 focus:ring-neon-mint/10";

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-night-950/80 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-label="Crie sua conta para processar o vídeo" data-testid="landing-auth">
      <div className="lp-studio pop-in relative max-h-[calc(100vh-2rem)] w-full max-w-[440px] overflow-y-auto rounded-[26px] p-6 sm:p-8">
        <button type="button" onClick={onClose} className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full text-haze transition hover:bg-white/10 hover:text-white" aria-label="Fechar">
          <Icon.x size={18} />
        </button>
        {pending ? (
          <div className="text-center" role="status">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-neon-mint/15 text-neon-mint">
              <Icon.mail size={24} />
            </span>
            <h2 className="lp-display mt-5 text-[26px] font-semibold leading-tight">Confirme seu e-mail</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-haze">
              Enviamos um link para <b className="text-white">{pending}</b>. Abra-o neste mesmo navegador: o editor abre com o seu vídeo{styleName ? ` e a IA começa a edição no estilo ${styleName}` : ""}.
            </p>
            <p className="mt-3 text-[13px] text-haze">Não chegou? Veja o spam. O vídeo fica guardado aqui por 24 horas.</p>
          </div>
        ) : (
          <>
            <p className="lp-overline">Último passo</p>
            <h2 className="lp-display mt-3 pr-8 text-[27px] font-semibold leading-[1.1]">{mode === "signup" ? "Crie sua conta grátis para processar" : "Entre para processar o vídeo"}</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-haze">
              {mode === "signup" ? (
                <>
                  Você ganha <b className="text-white">{SIGNUP_CREDITS} créditos</b>, sem cartão. {styleName ? `Assim que a conta entrar, a IA começa a editar no estilo ${styleName}.` : "Assim que a conta entrar, o editor abre com o seu vídeo."}
                </>
              ) : (
                <>Seu vídeo e o estilo escolhido estão guardados neste navegador e abrem no editor assim que você entrar.</>
              )}
            </p>

            <div className="mt-6 space-y-4">
              {google && (
                <>
                  <GoogleButton className="!py-3 !text-[15px]" label="Continuar com Google" />
                  <OrDivider />
                </>
              )}
              <form
                className="space-y-3.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit(e.currentTarget);
                }}
              >
                {mode === "signup" && (
                  <label className="block text-[13px] font-medium text-haze">
                    Nome
                    <input name="name" required autoComplete="name" className={field} />
                  </label>
                )}
                <label className="block text-[13px] font-medium text-haze">
                  E-mail
                  <input name="email" type="email" required autoComplete="email" className={field} />
                </label>
                <label className="block text-[13px] font-medium text-haze">
                  Senha
                  <input name="password" type="password" required minLength={mode === "signup" ? 8 : undefined} autoComplete={mode === "signup" ? "new-password" : "current-password"} className={field} />
                </label>
                {error && (
                  <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-[13.5px] text-rose-200" role="alert">
                    {error}
                  </p>
                )}
                <button type="submit" disabled={busy} className="lp-btn lp-btn-primary w-full !py-3.5 text-[15.5px] disabled:opacity-60" data-testid="landing-auth-submit">
                  {busy ? "Aguarde…" : mode === "signup" ? "Criar conta e processar" : "Entrar e processar"}
                </button>
              </form>
            </div>
            <p className="mt-5 text-center text-[14px] text-haze">
              {mode === "signup" ? "Já tem conta? " : "Ainda não tem conta? "}
              <button
                type="button"
                className="font-semibold text-neon-mint underline-offset-4 hover:underline"
                onClick={() => {
                  setMode(mode === "signup" ? "login" : "signup");
                  setError(null);
                }}
              >
                {mode === "signup" ? "Entrar" : "Criar conta grátis"}
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function UploadGlyph() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 16V4" />
      <path d="m6.5 9.5 5.5-5.5 5.5 5.5" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function SpeakerGlyph({ muted }: { muted: boolean }) {
  return (
    <svg width="55%" height="55%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor" />
      {muted ? (
        <>
          <path d="m22 9-6 6" />
          <path d="m16 9 6 6" />
        </>
      ) : (
        <>
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M19 5a10 10 0 0 1 0 14" />
        </>
      )}
    </svg>
  );
}
