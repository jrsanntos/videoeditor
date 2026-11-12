import { Landing } from "@/components/Landing";
import { currentUser } from "@/server/users";

export const dynamic = "force-dynamic";

/** Página inicial pública: apresentação do produto, planos e chamada para criar conta. */
export default async function Home() {
  // Sem banco configurado a página de vendas continua no ar; só o botão muda.
  const user = await currentUser().catch(() => null);
  return <Landing loggedIn={!!user} />;
}
