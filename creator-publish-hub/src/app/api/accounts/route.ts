import { handle, json } from "@/lib/api";
import { listAccounts, toPublic } from "@/lib/accounts";

export const dynamic = "force-dynamic";
export const GET = handle(async () => json(listAccounts().map(toPublic)));
