import { Landing } from "@/components/Landing";
import { googleEnabled } from "@/server/google";
import { currentUser } from "@/server/users";

export const dynamic = "force-dynamic";

/** Página inicial pública: envio do vídeo com prévia na hora, apresentação do produto e planos. */
export default async function Home() {
  // Sem banco configurado a página de vendas continua no ar; só o botão muda.
  const user = await currentUser().catch(() => null);
  return <Landing loggedIn={!!user} google={await googleEnabled()} />;
}
