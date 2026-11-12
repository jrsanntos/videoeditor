import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "videoeditor — a IA que dirige a edição do seu vídeo",
  description:
    "Envie o vídeo bruto: a IA corta erros e pausas, planeja o ritmo e aplica zooms, legendas e motion design. Você ajusta na timeline e exporta no navegador.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
