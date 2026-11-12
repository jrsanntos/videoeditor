import { redirect } from "next/navigation";
import { currentUser } from "@/server/users";
import { AdminPanel } from "./AdminPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Administração — videoeditor" };

export default async function AdminPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/app");
  return <AdminPanel me={{ id: user.id, name: user.name, email: user.email }} />;
}
