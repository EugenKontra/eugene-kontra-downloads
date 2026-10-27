import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { UploadError } from "./videos";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function error(message: string, status = 400) {
  return json({ error: message }, status);
}

/** Wraps a route handler: converts known errors to JSON responses without leaking internals. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e: any) {
      if (e instanceof ZodError) return error(`Неверные данные: ${e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      if (e instanceof UploadError) return error(e.message);
      console.error(e);
      return error("Внутренняя ошибка сервера", 500);
    }
  };
}
