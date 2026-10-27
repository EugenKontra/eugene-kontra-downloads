"use client";
import { useState } from "react";
import PostEditor from "@/components/PostEditor";
import PublishAllButton from "@/components/PublishAllButton";
import Uploader from "@/components/Uploader";

export default function NewPostPage() {
  const [posts, setPosts] = useState<any[]>([]);
  return (
    <div className="space-y-6">
      <h1>Новая публикация</h1>
      <Uploader onPost={(p) => setPosts((xs) => (xs.some((x) => x.id === p.id) ? xs : [...xs, p]))} />
      {posts.length > 0 && (
        <>
          <div className="space-y-4">
            {posts.map((p) => <PostEditor key={p.id} postId={p.id} />)}
          </div>
          <div className="sticky bottom-0 -mx-4 border-t border-zinc-800 bg-zinc-950/95 p-4 backdrop-blur md:mx-0 md:rounded-xl md:border">
            <PublishAllButton postIds={posts.map((p) => p.id)} />
          </div>
        </>
      )}
    </div>
  );
}
