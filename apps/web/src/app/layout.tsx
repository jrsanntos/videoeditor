import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "videoeditor — edição de vídeo com IA",
  description: "Envie o vídeo bruto, diga o que quer e a IA monta a edição. Ajuste na timeline sem gastar créditos.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
