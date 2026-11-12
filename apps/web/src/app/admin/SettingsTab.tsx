"use client";

import { useState } from "react";
import { api, Badge, btn, btnDanger, btnPrimary, card, dateTime, ErrorBox, input, useApi } from "./ui";

type Setting = {
  key: string;
  label: string;
  secret: boolean;
  source: "painel" | "ambiente" | "não definida";
  preview: string | null;
  updatedAt: string | null;
};

export function SettingsTab() {
  const { data, error, setData } = useApi<{ settings: Setting[] }>("/api/admin/settings");
  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-400">
        As chaves salvas aqui ficam cifradas no banco e valem na hora, com prioridade sobre as variáveis de ambiente. Remover uma chave do painel volta a
        usar a do ambiente, se existir. O valor salvo nunca é exibido de novo, só os 4 últimos caracteres.
      </p>
      <ErrorBox message={error} />
      {data?.settings.map((s) => <SettingRow key={s.key} setting={s} onSaved={(settings) => setData({ settings })} />)}
    </div>
  );
}

function SettingRow({ setting, onSaved }: { setting: Setting; onSaved: (s: Setting[]) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(next: string | null) {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ settings: Setting[] }>("/api/admin/settings", { method: "PUT", json: { key: setting.key, value: next } });
      setValue("");
      onSaved(res.settings);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const tone = setting.source === "painel" ? "good" : setting.source === "ambiente" ? "info" : "bad";
  return (
    <div className={card}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium text-zinc-100">{setting.label}</h3>
        <code className="text-xs text-zinc-500">{setting.key}</code>
        <span className="ml-auto">
          <Badge tone={tone}>{setting.source === "painel" ? "definida no painel" : setting.source === "ambiente" ? "do ambiente" : "não definida"}</Badge>
        </span>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        Atual: <span className="font-mono text-zinc-300">{setting.preview ?? "—"}</span>
        {setting.updatedAt && ` · alterada em ${dateTime(setting.updatedAt)}`}
      </p>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save(value);
        }}
      >
        <input
          className={`${input} min-w-0 flex-1 font-mono`}
          type={setting.secret ? "password" : "text"}
          autoComplete="off"
          placeholder={setting.secret ? "Cole a nova chave" : setting.key === "AGENT_MODEL" ? "claude-sonnet-5-5" : "5.40"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button className={btnPrimary} disabled={busy || !value.trim()}>
          Salvar
        </button>
        {setting.source === "painel" && (
          <button type="button" className={btnDanger} disabled={busy} onClick={() => confirm("Remover o valor salvo no painel?") && void save(null)}>
            Remover
          </button>
        )}
      </form>
      {setting.key === "AGENT_MODEL" && (
        <div className="mt-2 flex flex-wrap gap-1">
          {["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"].map((m) => (
            <button key={m} type="button" className={`${btn} px-2 py-0.5 text-xs`} onClick={() => setValue(m)}>
              {m}
            </button>
          ))}
        </div>
      )}
      <div className="mt-2">
        <ErrorBox message={error} />
      </div>
    </div>
  );
}
