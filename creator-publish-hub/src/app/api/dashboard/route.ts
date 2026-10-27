import { handle, json } from "@/lib/api";
import { dashboard } from "@/lib/views";

export const dynamic = "force-dynamic";
export const GET = handle(async () => json(dashboard()));
