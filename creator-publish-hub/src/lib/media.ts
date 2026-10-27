import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export type VideoMeta = {
  container: string;
  durationSec: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string | null;
  fps: number;
  bitrate: number;
  rotation: number;
};

/** Reads metadata with ffprobe without re-encoding. */
export async function probeVideo(file: string): Promise<VideoMeta> {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-print_format", "json", "-show_format", "-show_streams", file,
  ], { maxBuffer: 10 * 1024 * 1024, timeout: 60_000 });
  const info = JSON.parse(stdout);
  const v = info.streams?.find((s: any) => s.codec_type === "video");
  const a = info.streams?.find((s: any) => s.codec_type === "audio");
  if (!v) throw new Error("В файле не найдена видеодорожка");
  const rotation = Math.abs(Number(
    v.tags?.rotate ?? v.side_data_list?.find((s: any) => s.rotation !== undefined)?.rotation ?? 0,
  ));
  let width = Number(v.width), height = Number(v.height);
  if (rotation === 90 || rotation === 270) [width, height] = [height, width];
  const [n, d] = String(v.avg_frame_rate || v.r_frame_rate || "0/1").split("/").map(Number);
  return {
    container: String(info.format?.format_name ?? ""),
    durationSec: Number(info.format?.duration ?? v.duration ?? 0),
    width, height,
    videoCodec: String(v.codec_name),
    audioCodec: a ? String(a.codec_name) : null,
    fps: d ? n / d : 0,
    bitrate: Number(info.format?.bit_rate ?? 0),
    rotation,
  };
}

export const ALLOWED_EXTENSIONS = [".mp4", ".mov", ".m4v", ".webm"];
