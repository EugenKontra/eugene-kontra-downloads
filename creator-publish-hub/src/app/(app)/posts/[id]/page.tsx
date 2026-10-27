"use client";
import Link from "next/link";
import { use } from "react";
import PostEditor from "@/components/PostEditor";

export default function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <div className="space-y-4">
      <Link href="/posts" className="text-sm text-zinc-400 hover:text-zinc-200">← Все публикации</Link>
      <h1>Редактор публикации</h1>
      <PostEditor postId={id} />
    </div>
  );
}
